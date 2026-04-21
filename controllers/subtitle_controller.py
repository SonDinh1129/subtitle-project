"""
subtitle_controller.py — Controller Layer (MVC)
────────────────────────────────────────────────
Chịu trách nhiệm:
  • Nhận HTTP request, validate input
  • Gọi Model để xử lý business logic
  • Trả về JSON response phù hợp cho View / Frontend
  • KHÔNG chứa logic AI, KHÔNG trực tiếp xử lý file audio
"""

import os
import threading
import json
import queue
from pathlib import Path

from flask import (
    Blueprint, request, jsonify,
    send_file, send_from_directory, current_app,
    Response, stream_with_context, g,
)
from werkzeug.utils import secure_filename

from models.subtitle_model import (
    create_job, get_job, update_job, run_pipeline,
    run_pipeline_realtime,
    export_burned_video,
    JobStatus, UPLOAD_DIR,
    OUTPUT_DIR,
    get_job_event_queue,
)
from middleware.auth import require_auth, require_premium, get_profile, is_premium, needs_reset, reset_usage, _get_supabase_service
from extensions import limiter
from models.subtitle_optimizer import (
    parse_srt, write_srt, optimize_subtitles, get_optimization_stats,
)

# ─────────────────────────────────────────────────────────────────
# Blueprint
# ─────────────────────────────────────────────────────────────────

subtitle_bp = Blueprint("subtitle", __name__)

ALLOWED_EXTENSIONS = {"mp4", "mov", "mkv", "avi", "webm"}
MAX_CONTENT_MB     = 2048          # 2 GB


def _allowed(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def _validate_video_magic(file_stream) -> bool:
    """Check file magic bytes to verify it's actually a video."""
    header = file_stream.read(64)
    file_stream.seek(0)
    if len(header) < 4:
        return False

    # MP4/MOV files are ISO-BMFF; many valid files include "ftyp" near the start.
    if b"ftyp" in header[:32]:
        return True
    if header[:4] == b"\x1a\x45\xdf\xa3":
        return True  # MKV/WebM
    if header[:4] == b"RIFF" and b"AVI " in header[8:16]:
        return True
    return False


# ─────────────────────────────────────────────────────────────────
# ROUTES
# ─────────────────────────────────────────────────────────────────

@subtitle_bp.get("/health")
def health():
    """
    Kiểm tra trạng thái server + Colab connection.
    """
    from models.subtitle_model import ColabClient, is_vad_ready

    colab_url = current_app.config["COLAB_URL"]
    colab_info = {}
    colab_ok   = False

    try:
        client     = ColabClient(colab_url)
        colab_info = client.health()
        colab_ok   = True
    except Exception as exc:
        colab_info = {"error": str(exc)}

    return jsonify({
        "status":      "ok",
        "vad_loaded":  is_vad_ready(),
        "colab_ok":    colab_ok,
        "colab_info":  colab_info,
        "colab_url":   colab_url,
    })


@subtitle_bp.post("/upload")
@require_auth
@limiter.limit("5/minute")
def upload_video():  # noqa: C901
    """
    Upload video → tạo job → chạy pipeline trong background.

    Form-data:
        file             : video file  (required)
        translation_mode : "segment" | "sentence"  (optional, default "segment")
        process_mode     : "normal" | "realtime"   (optional, default "normal")

    Response 200:
        { job_id, status }
    """
    # ── Free tier checks ───────────────────────────────────────────
    profile = get_profile(g.user_id)
    if not profile:
        return jsonify({"error": "Profile not found"}), 404

    premium = is_premium(profile)

    # Lazy reset monthly counter if new month
    if needs_reset(profile):
        reset_usage(g.user_id)
        profile = get_profile(g.user_id) or profile  # re-fetch after reset

    # ── Validate file ──────────────────────────────────────────────
    if "file" not in request.files:
        return jsonify({"error": "No file field in request"}), 400

    file = request.files["file"]
    if file.filename == "":
        return jsonify({"error": "Empty filename"}), 400

    if not _allowed(file.filename):
        return jsonify({
            "error": f"Unsupported format. Allowed: {', '.join(ALLOWED_EXTENSIONS).upper()}"
        }), 415

    if not _validate_video_magic(file.stream):
        return jsonify({"error": "File content does not match a supported video format"}), 415

    # ── Save video to disk ─────────────────────────────────────────
    translation_mode = request.form.get("translation_mode", "segment")
    if translation_mode not in ("segment", "sentence"):
        translation_mode = "segment"
    process_mode = request.form.get("process_mode", "normal")
    if process_mode not in ("normal", "realtime"):
        process_mode = "normal"

    source_lang = request.form.get("source_lang", "en")
    if source_lang not in ("en", "vi"):
        source_lang = "en"

    # Gate: realtime requires premium
    if process_mode == "realtime" and not premium:
        return jsonify({"error": "Realtime mode requires premium", "code": "PREMIUM_REQUIRED"}), 403

    # Gate: free tier video limit (5/month)
    videos_used = profile.get("videos_used_this_month", 0)
    if not premium and videos_used >= 5:
        return jsonify({"error": "Monthly video limit reached (5/month)", "code": "LIMIT_REACHED"}), 403

    safe_name  = secure_filename(file.filename)[:200]
    job        = create_job(
        filename         = safe_name,
        translation_mode = translation_mode,
        video_path       = "",            # will be updated below
        user_id          = g.user_id,
        source_lang      = source_lang,
    )
    job_id     = job["job_id"]
    video_path = str(UPLOAD_DIR / f"{job_id}_{safe_name}")

    file.save(video_path)
    update_job(job_id, video_path=video_path)

    # Increment usage counter atomically
    try:
        _get_supabase_service().rpc("increment_video_count", {"uid": g.user_id}).execute()
    except Exception:
        pass  # Non-fatal

    # ── Start pipeline in background thread ───────────────────────
    colab_url = current_app.config["COLAB_URL"]
    if process_mode == "realtime":
        colab_realtime_url = current_app.config.get("COLAB_REALTIME_URL", colab_url)
        t = threading.Thread(
            target=run_pipeline_realtime,
            args=(job_id, colab_url, colab_realtime_url),
            daemon=True,
        )
    else:
        t = threading.Thread(target=run_pipeline, args=(job_id, colab_url), daemon=True)
    t.start()

    return jsonify({
        "job_id": job_id,
        "status": JobStatus.QUEUED,
        "process_mode": process_mode,
        "video_filename": f"{job_id}_{safe_name}",
    }), 200


@subtitle_bp.get("/jobs/<job_id>/stream")
@require_auth
def stream_job_realtime(job_id: str):
    """Server-Sent Events stream for realtime subtitle segments."""
    job = get_job(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    if job.get("user_id") and job["user_id"] != g.user_id:
        return jsonify({"error": "Forbidden"}), 403

    def _event(data: dict) -> str:
        return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"

    @stream_with_context
    def generate():
        q = get_job_event_queue(job_id)
        snapshot = get_job(job_id)
        if snapshot:
            yield _event({
                "type": "snapshot",
                "status": snapshot.get("status", JobStatus.QUEUED),
                "progress": snapshot.get("progress", 0),
                "english_words": snapshot.get("english_words", []),
                "vietnamese_words": snapshot.get("vietnamese_words", []),
            })
            if snapshot.get("status") == JobStatus.DONE:
                yield _event({"type": "done", "progress": 100})
                return
            if snapshot.get("status") == JobStatus.ERROR:
                yield _event({"type": "error", "message": snapshot.get("error", "Pipeline error")})
                return

        while True:
            try:
                payload = q.get(timeout=20)
            except queue.Empty:
                current = get_job(job_id)
                if not current:
                    yield _event({"type": "error", "message": "Job not found"})
                    return
                if current.get("status") == JobStatus.DONE:
                    yield _event({"type": "done", "progress": 100})
                    return
                if current.get("status") == JobStatus.ERROR:
                    yield _event({"type": "error", "message": current.get("error", "Pipeline error")})
                    return
                yield ": keepalive\n\n"
                continue

            yield _event(payload)
            if payload.get("type") in ("done", "error"):
                return

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@subtitle_bp.get("/jobs/<job_id>")
@require_auth
def get_job_status(job_id: str):
    """
    Poll trạng thái và tiến trình của một job.

    Response 200:
        {
          job_id, filename, status, progress,
          error?,
          # chỉ có khi status == "done":
          english_words, vietnamese_words,
          english_text, vietnamese_text
        }
    """
    job = get_job(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    if job.get("user_id") and job["user_id"] != g.user_id:
        return jsonify({"error": "Forbidden"}), 403

    # Chỉ trả về những field an toàn (không expose đường dẫn nội bộ)
    payload = {
        "job_id":   job["job_id"],
        "filename": job.get("filename"),
        "status":   job["status"],
        "progress": job.get("progress", 0),
        "error":    job.get("error"),
    }

    if job["status"] == JobStatus.DONE:
        payload.update({
            "english_words":    job.get("english_words",    []),
            "vietnamese_words": job.get("vietnamese_words", []),
            "english_text":     job.get("english_text",     ""),
            "vietnamese_text":  job.get("vietnamese_text",  ""),
        })

    return jsonify(payload), 200


@subtitle_bp.get("/jobs/<job_id>/download/<lang>")
@require_auth
def download_srt(job_id: str, lang: str):
    """
    Tải file SRT đã tạo.

    lang: "en" | "vi"

    Response: SRT file download
    """
    if lang not in ("en", "vi"):
        return jsonify({"error": "lang must be 'en' or 'vi'"}), 400

    job = get_job(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    if job.get("user_id") and job["user_id"] != g.user_id:
        return jsonify({"error": "Forbidden"}), 403
    if job["status"] != JobStatus.DONE:
        return jsonify({"error": f"Job not ready (status: {job['status']})"}), 409

    key  = "en_srt_path" if lang == "en" else "vi_srt_path"
    path = job.get(key)

    if not path or not os.path.exists(path):
        return jsonify({"error": "SRT file not found on server"}), 404

    return send_file(
        path,
        mimetype="text/plain",
        as_attachment=True,
        download_name=f"subtitles_{lang}.srt",
    )

@subtitle_bp.route('/video/<filename>')
@require_auth
def serve_video(filename):
    return send_from_directory(str(UPLOAD_DIR), filename)


@subtitle_bp.post("/export")
@require_auth
def export_video():
    """Export a burned-subtitle video in selected resolution."""
    payload = request.get_json(silent=True) or {}
    job_id = payload.get("job_id", "")
    resolution = payload.get("resolution", "720p")
    lang = payload.get("lang", "vi")

    if not job_id:
        return jsonify({"error": "job_id is required"}), 400
    if resolution not in ("360p", "720p", "1080p"):
        return jsonify({"error": "resolution must be one of: 360p, 720p, 1080p"}), 400
    if lang not in ("en", "vi"):
        return jsonify({"error": "lang must be 'en' or 'vi'"}), 400

    job = get_job(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    if job.get("user_id") and job["user_id"] != g.user_id:
        return jsonify({"error": "Forbidden"}), 403
    if job.get("status") != JobStatus.DONE:
        return jsonify({"error": f"Job not ready (status: {job.get('status')})"}), 409

    try:
        output_path = export_burned_video(job, resolution=resolution, lang=lang)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500

    filename = Path(output_path).name
    return jsonify({
        "job_id": job_id,
        "resolution": resolution,
        "lang": lang,
        "filename": filename,
        "download_url": f"/api/exports/{filename}",
    }), 200


@subtitle_bp.get("/exports/<path:filename>")
def download_exported_video(filename: str):
    """Download an exported burned-subtitle video."""
    safe_name = Path(filename).name
    full_path = OUTPUT_DIR / safe_name
    if not full_path.exists():
        return jsonify({"error": "Exported file not found"}), 404
    return send_file(
        str(full_path),
        mimetype="video/mp4",
        as_attachment=True,
        download_name=safe_name,
    )


# ─────────────────────────────────────────────────────────────────
# OPTIMIZE (Premium feature)
# ─────────────────────────────────────────────────────────────────

@subtitle_bp.route("/jobs/<job_id>/optimize", methods=["POST"])
@require_auth
@require_premium
def optimize_job_subtitles(job_id):
    """Premium feature: optimize Vietnamese SRT to broadcast standards."""
    job = get_job(job_id)
    if not job:
        return jsonify(error="Job not found"), 404
    if job.get("user_id") and job["user_id"] != g.user_id:
        return jsonify(error="Forbidden"), 403

    vi_srt_path = job.get("vi_srt_path")
    if not vi_srt_path or not os.path.exists(vi_srt_path):
        return jsonify(error="Vietnamese SRT not found"), 404

    with open(vi_srt_path, "r", encoding="utf-8") as f:
        content = f.read()

    blocks = parse_srt(content)
    optimized = optimize_subtitles(blocks)
    result_srt = write_srt(optimized)

    # Write optimized file (safe filename via pathlib)
    p = Path(vi_srt_path)
    opt_path = str(p.with_stem(p.stem + "_optimized"))
    with open(opt_path, "w", encoding="utf-8") as f:
        f.write(result_srt)

    update_job(job_id, vi_srt_optimized_path=opt_path)

    return jsonify(
        message="Optimized successfully",
        path=opt_path,
        stats=get_optimization_stats(blocks, optimized),
    )
