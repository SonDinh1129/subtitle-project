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
import uuid as _uuid
from pathlib import Path

# In-memory export registry: export_id → {"status": "pending"|"done"|"error", "user_id": str, "filename"?: str, "error"?: str}
_exports: dict[str, dict] = {}
_exports_lock = threading.Lock()
_export_timestamps: dict[str, float] = {}
_EXPORT_CACHE_TTL = 3600  # 1 hour


def _evict_stale_exports() -> None:
    """Remove exports older than _EXPORT_CACHE_TTL. Must be called with _exports_lock held."""
    import time as _t
    cutoff = _t.monotonic() - _EXPORT_CACHE_TTL
    stale = [eid for eid, ts in _export_timestamps.items() if ts < cutoff]
    for eid in stale:
        _exports.pop(eid, None)
        _export_timestamps.pop(eid, None)

from flask import (
    Blueprint, request, jsonify,
    send_file, send_from_directory, current_app,
    Response, stream_with_context, g,
)
from werkzeug.utils import secure_filename

from models.subtitle_model import (
    create_job, get_job, run_pipeline,
    run_pipeline_realtime,
    export_burned_video,
    JobStatus, UPLOAD_DIR,
    OUTPUT_DIR,
    get_job_event_queue,
)
from models.jobs_repo import set_video_path
from models.storage_repo import signed_url
from middleware.auth import require_auth, require_premium, get_profile, is_premium, needs_reset, reset_usage, _get_supabase_service
from extensions import limiter
from models.subtitle_optimizer import (
    parse_srt, write_srt, optimize_subtitles, get_optimization_stats,
)
from models.subtitle_quality import analyze_srt_file
import urllib.error as _urllib_error
from models.translation_quality import evaluate_translation, words_to_sentences as _words_to_sentences, ALLOWED_MODELS as _ALLOWED_TQ_MODELS

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
    try:
        profile = get_profile(g.user_id)
    except RuntimeError:
        return jsonify({"error": "Service temporarily unavailable"}), 503
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

    # Gate: free tier video limit — atomic check+increment in Postgres
    if not premium:
        try:
            result = _get_supabase_service().rpc(
                "check_and_increment_video_count",
                {"uid": g.user_id, "lim": 5},
            ).execute()
            if not result.data:
                return jsonify({"error": "Monthly video limit reached (5/month)", "code": "LIMIT_REACHED"}), 403
        except Exception:
            current_app.logger.exception("check_and_increment_video_count failed for user %s", g.user_id)
            return jsonify({"error": "Service temporarily unavailable"}), 503

    safe_name  = secure_filename(file.filename)[:200]
    job        = create_job(
        filename         = safe_name,
        translation_mode = translation_mode,
        user_id          = g.user_id,
        source_lang      = source_lang,
    )
    job_id     = job["job_id"]
    video_path = str(UPLOAD_DIR / f"{job_id}_{safe_name}")

    file.save(video_path)
    # video_path is ephemeral (local pipeline only); store in memory cache, not Postgres
    set_video_path(job_id, video_path)

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
    if job.get("user_id") != g.user_id:
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
@limiter.exempt
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
    if job.get("user_id") != g.user_id:
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


@subtitle_bp.get("/jobs/<job_id>/srt-url")
@require_auth
def get_srt_url(job_id: str):
    """
    Return a short-lived signed URL for downloading the SRT from Supabase Storage.

    Query param: lang=en|vi (required)

    Response 200:
        { "url": "https://...", "expires_in": 3600 }
    Response 404:
        { "error": "SRT not available yet" }
    """
    lang = request.args.get("lang", "")
    if lang not in ("en", "vi"):
        return jsonify({"error": "lang must be 'en' or 'vi'"}), 400

    job = get_job(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    if job.get("user_id") != g.user_id:
        return jsonify({"error": "Forbidden"}), 403

    path_key = "en_srt_storage_path" if lang == "en" else "vi_srt_storage_path"
    storage_path = job.get(path_key)
    if not storage_path:
        return jsonify({"error": "SRT not available yet"}), 404

    try:
        url = signed_url(storage_path)
    except Exception as exc:
        return jsonify({"error": f"Failed to generate download URL: {exc}"}), 503
    return jsonify({"url": url, "expires_in": 3600}), 200


@subtitle_bp.route('/video/<filename>')
@require_auth
def serve_video(filename):
    # filename format: {job_id}_{original_name} — extract job_id prefix
    job_id_candidate = filename.split("_", 1)[0]
    job = get_job(job_id_candidate)
    if job and job.get("user_id") != g.user_id:
        return jsonify({"error": "Forbidden"}), 403
    return send_from_directory(str(UPLOAD_DIR), filename)


@subtitle_bp.post("/export")
@require_auth
@limiter.limit("10/minute")
def export_video():
    """Start async export. Returns 202 with export_id; poll GET /export-status/<export_id>."""
    payload = request.get_json(silent=True) or {}
    job_id = payload.get("job_id", "")
    resolution = payload.get("resolution", "720p")
    lang = payload.get("lang", "vi")
    subtitles = payload.get("subtitles")  # optional: user-edited blocks

    if not job_id:
        return jsonify({"error": "job_id is required"}), 400
    if resolution not in ("360p", "720p", "1080p"):
        return jsonify({"error": "resolution must be one of: 360p, 720p, 1080p"}), 400
    if lang not in ("en", "vi", "dual"):
        return jsonify({"error": "lang must be 'en', 'vi' or 'dual'"}), 400
    if subtitles is not None and not isinstance(subtitles, dict):
        return jsonify({"error": "subtitles must be an object"}), 400

    job = get_job(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    if job.get("user_id") != g.user_id:
        return jsonify({"error": "Forbidden"}), 403
    if job.get("status") != JobStatus.DONE:
        return jsonify({"error": f"Job not ready (status: {job.get('status')})"}), 409

    import time as _t
    export_id = str(_uuid.uuid4())
    with _exports_lock:
        _exports[export_id] = {"status": "pending", "user_id": g.user_id}
        _export_timestamps[export_id] = _t.monotonic()
        _evict_stale_exports()

    def _run(app, eid, j, res, lng, subs):
        with app.app_context():
            try:
                output_path = export_burned_video(j, resolution=res, lang=lng, subtitles=subs)
                filename = Path(output_path).name
                with _exports_lock:
                    _exports[eid].update({"status": "done", "filename": filename})
            except Exception as exc:
                current_app.logger.exception("Export %s failed", eid)
                with _exports_lock:
                    _exports[eid].update({"status": "error", "error": "Export failed"})

    threading.Thread(
        target=_run,
        args=(current_app._get_current_object(), export_id, job, resolution, lang, subtitles),
        daemon=True,
    ).start()

    return jsonify({"export_id": export_id, "status": "pending"}), 202


@subtitle_bp.get("/export-status/<export_id>")
@require_auth
def get_export_status(export_id: str):
    """Poll async export status. Returns status + download_url when done."""
    with _exports_lock:
        entry = _exports.get(export_id)
    if not entry:
        return jsonify({"error": "Export not found"}), 404
    if entry.get("user_id") != g.user_id:
        return jsonify({"error": "Forbidden"}), 403
    if entry["status"] == "done":
        return jsonify({
            "export_id": export_id,
            "status": "done",
            "filename": entry["filename"],
            "download_url": f"/api/exports/{entry['filename']}",
        }), 200
    if entry["status"] == "error":
        return jsonify({"export_id": export_id, "status": "error", "error": entry["error"]}), 200
    return jsonify({"export_id": export_id, "status": "pending"}), 200


@subtitle_bp.get("/exports/<path:filename>")
@require_auth
def download_exported_video(filename: str):
    """Download an exported burned-subtitle video."""
    safe_name = Path(filename).name
    # safe_name format: {job_id}_{lang}_{resolution}.mp4 — extract job_id prefix
    parts = safe_name.split("_", 1)
    if parts:
        job_id_candidate = parts[0]
        job = get_job(job_id_candidate)
        if job and job.get("user_id") != g.user_id:
            return jsonify({"error": "Forbidden"}), 403

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
    if job.get("user_id") != g.user_id:
        return jsonify(error="Forbidden"), 403

    vi_srt_path = str(OUTPUT_DIR / f"{job_id}_vi.srt")
    if not os.path.exists(vi_srt_path):
        return jsonify(error="Vietnamese SRT not found"), 404

    with open(vi_srt_path, "r", encoding="utf-8") as f:
        content = f.read()

    blocks = parse_srt(content)
    optimized = optimize_subtitles(blocks)
    result_srt = write_srt(optimized)

    # Write optimized file (safe filename via pathlib).
    # Path stays consistent with quality_report's lookup: {job_id}_vi_optimized.srt
    # No update_job() here — the optimized path is derived from disk on read, and
    # vi_srt_optimized_path is not a Postgres column (would fail the UPDATE).
    p = Path(vi_srt_path)
    opt_path = str(p.with_stem(p.stem + "_optimized"))
    with open(opt_path, "w", encoding="utf-8") as f:
        f.write(result_srt)

    return jsonify(
        message="Optimized successfully",
        stats=get_optimization_stats(blocks, optimized),
    )


# ─────────────────────────────────────────────────────────────────
# QUALITY REPORT
# ─────────────────────────────────────────────────────────────────

@subtitle_bp.get("/jobs/<job_id>/report")
@require_auth
def quality_report(job_id: str):
    """
    Phân tích chất lượng SRT của một job.

    Query params:
        lang: "en" | "vi" (default: "vi")
        srt:  "original" | "optimized" (default: "original")
              "optimized" chỉ hoạt động nếu đã chạy /optimize trước đó

    Response: QualityReport JSON với per-block metrics và summary stats.
    """
    job = get_job(job_id)
    if not job:
        return jsonify(error="Job not found"), 404
    if job.get("user_id") != g.user_id:
        return jsonify(error="Forbidden"), 403

    lang = request.args.get("lang", "vi")
    if lang not in ("en", "vi"):
        return jsonify(error="lang must be 'en' or 'vi'"), 400

    srt_variant = request.args.get("srt", "original")

    if lang == "en":
        srt_path = str(OUTPUT_DIR / f"{job_id}_en.srt")
    elif srt_variant == "optimized":
        # Optimized path is derived from disk (not stored in Postgres).
        # Must match the filename written by /optimize: {job_id}_vi_optimized.srt
        srt_path = str(OUTPUT_DIR / f"{job_id}_vi_optimized.srt")
        if not os.path.exists(srt_path):
            return jsonify(error="Optimized SRT not found — run /optimize first"), 404
    else:
        srt_path = str(OUTPUT_DIR / f"{job_id}_vi.srt")

    if not srt_path or not os.path.exists(srt_path):
        return jsonify(error=f"{lang.upper()} SRT not found"), 404

    report = analyze_srt_file(srt_path, lang=lang)
    return jsonify(report.to_dict())


# ─────────────────────────────────────────────────────────────────
# TRANSLATION QUALITY (LLM-as-judge via ChatGPT)
# ─────────────────────────────────────────────────────────────────

@subtitle_bp.get("/jobs/<job_id>/translation-quality")
@require_auth
@limiter.limit("10/minute")
def translation_quality(job_id: str):
    """
    Đánh giá chất lượng bản dịch EN→VI bằng ChatGPT (LLM-as-judge).
    Gửi toàn bộ cặp EN/VI trong job lên ChatGPT để đánh giá.

    Query params:
        model: OpenAI model — gpt-4o-mini (default) hoặc gpt-4o

    Yêu cầu: OPENAI_API_KEY env var phải được set.

    Response: TranslationQualityReport JSON với điểm trung bình + chi tiết từng cặp.
    """
    job = get_job(job_id)
    if not job:
        return jsonify(error="Job not found"), 404
    if job.get("user_id") != g.user_id:
        return jsonify(error="Forbidden"), 403
    if job.get("status") != JobStatus.DONE:
        return jsonify(error="Job not done yet"), 400

    en_words = job.get("english_words") or []
    vi_words = job.get("vietnamese_words") or []
    if not en_words or not vi_words:
        return jsonify(error="No translation data found for this job"), 400

    # Validate model trước khi gọi bất kỳ thứ gì tốn tiền
    model = request.args.get("model", "gpt-4o-mini")
    if model not in _ALLOWED_TQ_MODELS:
        return jsonify(error=f"model must be one of: {sorted(_ALLOWED_TQ_MODELS)}"), 400

    en_sentences = _words_to_sentences(en_words)
    vi_sentences = _words_to_sentences(vi_words)

    if abs(len(en_sentences) - len(vi_sentences)) > 5:
        current_app.logger.warning(
            "Sentence count mismatch for job %s: EN=%d VI=%d — some pairs will be skipped",
            job_id, len(en_sentences), len(vi_sentences),
        )

    try:
        report = evaluate_translation(en_sentences, vi_sentences, model=model)
    except EnvironmentError as e:
        return jsonify(error=str(e)), 503
    except _urllib_error.HTTPError as e:
        if e.code == 429:
            return jsonify(error="OpenAI rate limit reached, please retry later"), 429
        current_app.logger.error("OpenAI HTTP error %s for job %s", e.code, job_id)
        return jsonify(error=f"OpenAI API error ({e.code})"), 502
    except _urllib_error.URLError as e:
        current_app.logger.error("OpenAI network error for job %s: %s", job_id, e.reason)
        return jsonify(error="Could not reach OpenAI API"), 502
    except ValueError as e:
        return jsonify(error=str(e)), 422
    except Exception:
        current_app.logger.exception("Translation quality evaluation failed for job %s", job_id)
        return jsonify(error="Evaluation failed — see server logs"), 502

    return jsonify(report.to_dict())
