"""
subtitle_model.py — Model Layer (MVC)
─────────────────────────────────────
Chịu trách nhiệm:
  • Kết nối & giao tiếp với Colab (ASR + MT)
  • Xử lý audio cục bộ: FFmpeg extract + Silero VAD
  • Tạo file SRT từ word-list
  • Quản lý trạng thái job (in-memory + disk)
"""

import os
import uuid
import time
import json
import base64
import threading
import queue
from pathlib import Path
from typing import Iterator, Optional

import numpy as np
import requests
import torch
import ffmpeg
import subprocess as _sp
import shutil
import websocket as _ws_lib


# ─────────────────────────────────────────────────────────────────
# PATHS
# ─────────────────────────────────────────────────────────────────

UPLOAD_DIR = Path("uploads")
OUTPUT_DIR = Path("outputs")
JOBS_DIR   = Path("jobs")

for _d in [UPLOAD_DIR, OUTPUT_DIR, JOBS_DIR]:
    _d.mkdir(exist_ok=True)


# ─────────────────────────────────────────────────────────────────
# JOB STATUS CONSTANTS
# ─────────────────────────────────────────────────────────────────

class JobStatus:
    QUEUED       = "queued"
    EXTRACTING   = "extracting"
    VAD          = "vad"
    TRANSCRIBING = "transcribing"
    GENERATING   = "generating"
    DONE         = "done"
    ERROR        = "error"


# ─────────────────────────────────────────────────────────────────
# JOB STORE  (in-memory + JSON on disk)
# ─────────────────────────────────────────────────────────────────

_jobs: dict = {}
_jobs_lock  = threading.Lock()
_job_event_queues: dict[str, queue.Queue] = {}
_job_event_lock = threading.Lock()


def create_job(filename: str, translation_mode: str, video_path: str, user_id: str | None = None, source_lang: str = "en") -> dict:
    """Create a new job record and persist it."""
    job = {
        "job_id":           str(uuid.uuid4()),
        "user_id":          user_id,
        "filename":         filename,
        "status":           JobStatus.QUEUED,
        "progress":         0,
        "translation_mode": translation_mode,
        "source_lang":      source_lang,
        "video_path":       video_path,
        "created_at":       time.time(),
        "error":            None,
        # Populated when done:
        "english_words":    [],
        "vietnamese_words": [],
        "english_text":     "",
        "vietnamese_text":  "",
        "en_srt_path":      None,
        "vi_srt_path":      None,
    }
    _persist_job(job)
    with _job_event_lock:
        _job_event_queues[job["job_id"]] = queue.Queue()
    return job


def get_job(job_id: str) -> Optional[dict]:
    with _jobs_lock:
        if job_id in _jobs:
            return dict(_jobs[job_id])
    job_file = JOBS_DIR / f"{job_id}.json"
    if job_file.exists():
        with open(job_file, encoding="utf-8") as f:
            return json.load(f)
    return None


def update_job(job_id: str, **fields) -> dict:
    """Merge fields into an existing job and persist."""
    job = get_job(job_id) or {}
    job.update(fields)
    _persist_job(job)
    return job


def _persist_job(job: dict):
    with _jobs_lock:
        _jobs[job["job_id"]] = dict(job)
    path = JOBS_DIR / f"{job['job_id']}.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(job, f, ensure_ascii=False, indent=2)


def get_job_event_queue(job_id: str) -> queue.Queue:
    with _job_event_lock:
        return _job_event_queues.setdefault(job_id, queue.Queue())


def emit_job_event(job_id: str, event: dict) -> None:
    q = get_job_event_queue(job_id)
    q.put(dict(event))


# ─────────────────────────────────────────────────────────────────
# VAD MODEL  (loaded once at module import)
# ─────────────────────────────────────────────────────────────────

_vad_model = None
_vad_utils = None


def load_vad() -> bool:
    """Load Silero VAD. Returns True on success."""
    global _vad_model, _vad_utils
    try:
        print("⏳ Loading Silero VAD...")
        _vad_model, _vad_utils = torch.hub.load(
            repo_or_dir="snakers4/silero-vad",
            model="silero_vad",
            force_reload=False,
        )
        print("✅ Silero VAD loaded.")
        return True
    except Exception as exc:
        print(f"❌ VAD load failed: {exc}")
        return False


def is_vad_ready() -> bool:
    return _vad_model is not None and _vad_utils is not None


# ─────────────────────────────────────────────────────────────────
# COLAB CLIENT
# ─────────────────────────────────────────────────────────────────

class ColabClient:
    def __init__(self, colab_url: str):
        self.base_url = colab_url.rstrip("/")
        self.headers = {
            "ngrok-skip-browser-warning": "true",
            "Content-Type": "application/json",
        }

    def health(self) -> dict:
        resp = requests.get(
            f"{self.base_url}/health",
            headers=self.headers,
            timeout=10,
        )
        resp.raise_for_status()
        return resp.json()

    def transcribe_translate(
        self,
        segments_data: list[dict],
        translation_mode: str = "segment",
        source_lang: str = "en",
        timeout: int = 600,
        max_retries: int = 3,       # ← thêm retry
    ) -> dict:
        payload = {
            "segments":         segments_data,
            "translation_mode": translation_mode,
            "source_lang":      source_lang,
        }
        
        last_error = None
        for attempt in range(max_retries):
            try:
                resp = requests.post(
                    f"{self.base_url}/transcribe_translate",
                    json=payload,
                    headers=self.headers,
                    timeout=timeout,
                )
                if resp.status_code != 200:
                    raise RuntimeError(f"Colab {resp.status_code}: {resp.text}")
                return resp.json()
                
            except (requests.exceptions.SSLError, 
                    requests.exceptions.ConnectionError) as e:
                last_error = e
                wait = 5 * (attempt + 1)  # 5s, 10s, 15s
                print(f"⚠️ Attempt {attempt+1} failed: {e}. Retrying in {wait}s...")
                time.sleep(wait)
                continue
                
        raise RuntimeError(f"Failed after {max_retries} attempts: {last_error}")

    def transcribe_translate_stream(
        self,
        segments_data: list[dict],
        translation_mode: str = "segment",
        source_lang: str = "en",
        timeout: int = 1200,
    ):
        """
        Stream segment results from Colab SSE endpoint.
        Yields dict events and ends when [DONE] is received.
        """
        payload = {
            "segments": segments_data,
            "translation_mode": translation_mode,
            "source_lang": source_lang,
        }

        with requests.post(
            f"{self.base_url}/transcribe_translate_stream",
            json=payload,
            headers=self.headers,
            timeout=timeout,
            stream=True,
        ) as resp:
            if resp.status_code != 200:
                raise RuntimeError(f"Colab stream {resp.status_code}: {resp.text}")

            for raw in resp.iter_lines(decode_unicode=True):
                if not raw:
                    continue
                line = raw.strip()
                if not line.startswith("data:"):
                    continue

                body = line[5:].strip()
                if body == "[DONE]":
                    yield {"type": "done"}
                    return

                try:
                    data = json.loads(body)
                except Exception as exc:
                    raise RuntimeError(f"Invalid stream payload: {body}") from exc

                if isinstance(data, dict):
                    yield data


class ColabWsClient:
    """WebSocket client for chunked realtime streaming to Colab."""

    BACKOFF = [2, 5, 10]  # retry delays in seconds
    MAX_RETRIES = 3

    def __init__(self, colab_url: str):
        base = colab_url.rstrip("/")
        self.ws_url = base.replace("https://", "wss://").replace("http://", "ws://") + "/ws/transcribe_stream"
        self.headers = {"ngrok-skip-browser-warning": "true"}

    def transcribe_stream_ws(
        self,
        chunks_iter: Iterator[dict],
        source_lang: str,
        translation_mode: str,
    ) -> Iterator[dict]:
        """
        Send chunks over WebSocket, yield result dicts.
        Auto-reconnects on failure and retries the failed chunk.
        """
        retry_count = 0
        ws: _ws_lib.WebSocket | None = None

        try:
            ws = self._connect()

            for chunk in chunks_iter:
                if chunk.get("skipped"):
                    yield chunk
                    continue

                payload = {**chunk, "source_lang": source_lang, "translation_mode": translation_mode}

                while True:
                    try:
                        if ws is None:
                            ws = self._connect()
                            retry_count = 0

                        ws.send(json.dumps(payload))
                        raw = ws.recv()
                        result = json.loads(raw)
                        retry_count = 0
                        yield result
                        break

                    except (_ws_lib.WebSocketException, ConnectionError, OSError) as exc:
                        if ws:
                            try:
                                ws.close()
                            except Exception:
                                pass
                            ws = None

                        if retry_count >= self.MAX_RETRIES:
                            raise RuntimeError(
                                f"WebSocket failed after {self.MAX_RETRIES} retries: {exc}"
                            ) from exc

                        delay = self.BACKOFF[min(retry_count, len(self.BACKOFF) - 1)]
                        print(f"⚠️ WS error (retry {retry_count + 1}/{self.MAX_RETRIES}): {exc}. "
                              f"Reconnecting in {delay}s...")
                        time.sleep(delay)
                        retry_count += 1

        finally:
            if ws:
                try:
                    ws.close()
                except Exception:
                    pass

    def _connect(self) -> _ws_lib.WebSocket:
        """Open a new WebSocket connection to Colab."""
        ws = _ws_lib.WebSocket()
        ws.connect(self.ws_url, header=self.headers, timeout=120)
        return ws


# ─────────────────────────────────────────────────────────────────
# AUDIO PROCESSING
# ─────────────────────────────────────────────────────────────────

def extract_audio(video_path: str, output_wav: str) -> str:
    """
    Extract mono 16 kHz WAV from video using FFmpeg.
    Raises on failure.
    """
    (
        ffmpeg
        .input(video_path)
        .output(output_wav, acodec="pcm_s16le", ac=1, ar="16000")
        .run(overwrite_output=True, quiet=True)
    )
    return output_wav


def extract_audio_chunked(
    video_path: str,
    chunks_dir: Path,
    chunk_seconds: int = 5,
    done_event: threading.Event | None = None,
) -> None:
    """
    Extract audio from video as progressive WAV chunks.
    Uses FFmpeg -f segment. Designed to run in a background thread.
    Sets done_event when FFmpeg finishes (success or failure).
    """
    cmd = [
        "ffmpeg", "-i", str(video_path),
        "-f", "segment",
        "-segment_time", str(chunk_seconds),
        "-acodec", "pcm_s16le", "-ac", "1", "-ar", "16000",
        "-y",
        str(chunks_dir / "chunk_%04d.wav"),
    ]
    try:
        _sp.run(cmd, capture_output=True, text=True, check=True)
    except _sp.CalledProcessError as e:
        raise RuntimeError(f"FFmpeg chunked extraction failed: {e.stderr[:500]}") from e
    finally:
        if done_event:
            done_event.set()


class ChunkProducer:
    """Watch chunks_dir for completed WAV chunks, run VAD, yield encoded dicts."""

    def __init__(self, chunks_dir: Path, done_event: threading.Event, chunk_seconds: int = 5):
        self.chunks_dir = chunks_dir
        self.done_event = done_event
        self.chunk_seconds = chunk_seconds

    def iter_chunks(self) -> Iterator[dict]:
        """Yield chunk dicts as they become available on disk."""
        next_idx = 0
        while True:
            chunk_files = sorted(self.chunks_dir.glob("chunk_*.wav"))
            # Chunk N is closed when chunk N+1 exists OR when FFmpeg is done
            ffmpeg_finished = self.done_event.is_set()
            closed_count = len(chunk_files) if ffmpeg_finished else max(0, len(chunk_files) - 1)

            for i in range(next_idx, closed_count):
                chunk_path = self.chunks_dir / f"chunk_{i:04d}.wav"
                if not chunk_path.exists():
                    break
                yield self._process_chunk(chunk_path, i)
                next_idx = i + 1

            if ffmpeg_finished and next_idx >= len(chunk_files):
                break

            time.sleep(0.5)

    def _process_chunk(self, chunk_path: Path, chunk_index: int) -> dict:
        """Run VAD on a single chunk, return encoded dict."""
        start_offset = round(chunk_index * self.chunk_seconds, 2)

        _, _, read_audio, _, _ = _vad_utils
        wav = read_audio(str(chunk_path), sampling_rate=16000)
        end_offset = round(start_offset + len(wav) / 16000.0, 2)

        segments, _ = detect_speech_segments(str(chunk_path))
        if not segments:
            return {
                "index": chunk_index,
                "skipped": True,
                "start_offset": start_offset,
                "end_offset": end_offset,
            }

        audio_b64 = base64.b64encode(
            wav.numpy().astype(np.float32).tobytes()
        ).decode("utf-8")

        return {
            "index": chunk_index,
            "audio_base64": audio_b64,
            "start_offset": start_offset,
            "end_offset": end_offset,
            "skipped": False,
        }


def detect_speech_segments(audio_path: str) -> tuple[list[dict], torch.Tensor]:
    """
    Run Silero VAD on WAV file.
    Returns (segments, wav_tensor).
    Each segment: {start: float, end: float}  (seconds)
    """
    if not is_vad_ready():
        raise RuntimeError("VAD model not loaded. Call load_vad() first.")

    get_speech_timestamps, _, read_audio, _, _ = _vad_utils
    wav = read_audio(audio_path, sampling_rate=16000)

    raw_ts = get_speech_timestamps(
        wav, _vad_model,
        threshold=0.5,
        min_speech_duration_ms=250,
        min_silence_duration_ms=500,
        window_size_samples=512,
        speech_pad_ms=100,
    )
    segments = [
        {"start": round(ts["start"] / 16000, 2),
         "end":   round(ts["end"]   / 16000, 2)}
        for ts in raw_ts
    ]
    return segments, wav


def merge_short_segments(segments: list[dict], min_duration: float = 2.0, max_duration: float = 0.0) -> list[dict]:
    """Merge adjacent short segments so each is ≥ min_duration seconds.
    If max_duration > 0, flush the buffer before it would exceed max_duration.
    """
    merged, buffer = [], None
    for seg in segments:
        if buffer is None:
            buffer = seg.copy()
        else:
            if max_duration > 0 and (seg["end"] - buffer["start"]) > max_duration:
                merged.append(buffer)
                buffer = seg.copy()
            else:
                buffer = {**buffer, "end": seg["end"]}
        if buffer["end"] - buffer["start"] >= min_duration:
            merged.append(buffer)
            buffer = None
    if buffer:
        merged.append(buffer)
    return merged


def split_long_segment(seg: dict, max_duration: float = 25.0) -> list[dict]:
    """Split a segment longer than max_duration into equal-duration chunks."""
    duration = seg["end"] - seg["start"]
    if duration <= max_duration:
        return [seg]
    n_chunks = int(duration / max_duration) + 1
    chunk_dur = duration / n_chunks
    result = []
    for i in range(n_chunks):
        chunk_start = round(seg["start"] + i * chunk_dur, 2)
        chunk_end = round(seg["start"] + (i + 1) * chunk_dur, 2)
        if i == n_chunks - 1:
            chunk_end = seg["end"]
        result.append({"start": chunk_start, "end": chunk_end})
    return result


def _prepare_segments(audio_path: str, min_duration: float = 2.0) -> list[dict]:
    """Run VAD → split → merge → encode segments for Colab.

    Raises RuntimeError if no speech is detected.
    """
    segments, wav = detect_speech_segments(audio_path)
    if not segments:
        raise RuntimeError("No speech detected in the video.")
    split_segs: list[dict] = []
    for s in segments:
        split_segs.extend(split_long_segment(s, max_duration=25.0))
    segments = merge_short_segments(split_segs, min_duration=min_duration, max_duration=25.0)
    return encode_segments_for_colab(segments, wav)


def _cleanup_job_queue(job_id: str) -> None:
    """Remove the event queue for a completed/failed job to free memory."""
    with _job_event_lock:
        _job_event_queues.pop(job_id, None)


def encode_segments_for_colab(
    segments: list[dict],
    wav_tensor: torch.Tensor,
    sample_rate: int = 16000,
) -> list[dict]:
    """
    Slice audio tensor per segment and base64-encode.
    Returns list ready to pass to ColabClient.transcribe_translate().
    """
    result = []
    for seg in segments:
        start_s = int(seg["start"] * sample_rate)
        end_s   = int(seg["end"]   * sample_rate)
        if end_s <= start_s:
            continue
        chunk      = wav_tensor[start_s:end_s].numpy().astype(np.float32)
        audio_b64  = base64.b64encode(chunk.tobytes()).decode("utf-8")
        result.append({
            "audio_base64": audio_b64,
            "start_offset": seg["start"],
            "end_offset":   seg["end"],
        })
    return result


# ─────────────────────────────────────────────────────────────────
# SRT GENERATION
# ─────────────────────────────────────────────────────────────────

def _fmt_srt_time(seconds: float) -> str:
    h  = int(seconds // 3600)
    m  = int((seconds % 3600) // 60)
    s  = int(seconds % 60)
    ms = int((seconds % 1) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def words_to_srt_string(words: list[dict], max_chars: int = 42) -> str:
    """Convert word-level timestamps to SRT text."""
    subtitles, current, current_chars, t0 = [], [], 0, None

    for wd in words:
        word = wd["word"]
        if t0 is None:
            t0 = wd["start"]
        wlen = len(word) + 1
        if current_chars + wlen > max_chars and current:
            subtitles.append({"text": " ".join(current), "start": t0, "end": wd["start"]})
            current, current_chars, t0 = [word], len(word), wd["start"]
        else:
            current.append(word)
            current_chars += wlen

    if current:
        subtitles.append({"text": " ".join(current), "start": t0, "end": words[-1]["end"]})

    lines = []
    for i, sub in enumerate(subtitles, 1):
        lines += [
            str(i),
            f"{_fmt_srt_time(sub['start'])} --> {_fmt_srt_time(sub['end'])}",
            sub["text"],
            "",
        ]
    return "\n".join(lines)


def save_srt(content: str, path: str) -> str:
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    return path


def export_burned_video(job: dict, resolution: str, lang: str) -> str:
    """Burn subtitles into source video and scale to target resolution."""
    resolution_map = {
        "360p": "640:360",
        "720p": "1280:720",
        "1080p": "1920:1080",
    }
    if resolution not in resolution_map:
        raise ValueError("resolution must be one of: 360p, 720p, 1080p")
    if lang not in ("en", "vi"):
        raise ValueError("lang must be 'en' or 'vi'")

    video_path = job.get("video_path")
    if not video_path or not os.path.exists(video_path):
        raise FileNotFoundError("Source video not found")

    srt_key = "en_srt_path" if lang == "en" else "vi_srt_path"
    srt_path = job.get(srt_key)
    if not srt_path or not os.path.exists(srt_path):
        raise FileNotFoundError("Subtitle file not found")

    scale = resolution_map[resolution]
    safe_srt = Path(srt_path).as_posix().replace(":", "\\:")
    vf_expr = f"subtitles='{safe_srt}',scale={scale}"

    output_name = f"{job['job_id']}_{lang}_{resolution}.mp4"
    output_path = OUTPUT_DIR / output_name

    (
        ffmpeg
        .input(video_path)
        .output(
            str(output_path),
            vf=vf_expr,
            vcodec="libx264",
            acodec="aac",
            crf=23,
            movflags="+faststart",
            preset="medium",
        )
        .run(overwrite_output=True, quiet=True)
    )

    return str(output_path)


# ─────────────────────────────────────────────────────────────────
# FULL PIPELINE  (called in a background thread by the controller)
# ─────────────────────────────────────────────────────────────────

def run_pipeline(job_id: str, colab_url: str) -> None:
    """
    Complete subtitle generation pipeline.
    Updates job status/progress at each step.
    Designed to run in a background thread.
    """
    job = get_job(job_id)
    if not job:
        return

    video_path       = job["video_path"]
    translation_mode = job["translation_mode"]
    source_lang      = job.get("source_lang", "en")
    audio_path       = str(UPLOAD_DIR / f"{job_id}_audio.wav")

    try:
        # ── Step 1: Extract audio ──────────────────────────────────
        update_job(job_id, status=JobStatus.EXTRACTING, progress=5)
        extract_audio(video_path, audio_path)

        # ── Step 2: VAD ────────────────────────────────────────────
        update_job(job_id, status=JobStatus.VAD, progress=20)

        # ── Step 3: Encode + send to Colab ─────────────────────────
        update_job(job_id, status=JobStatus.TRANSCRIBING, progress=40)
        segments_data = _prepare_segments(audio_path, min_duration=2.0)

        client = ColabClient(colab_url)
        result = client.transcribe_translate(segments_data, translation_mode, source_lang=source_lang)

        english_words    = result["english_words"]
        vietnamese_words = result["vietnamese_words"]

        # ── Step 4: Generate SRT files ─────────────────────────────
        update_job(job_id, status=JobStatus.GENERATING, progress=80)

        en_srt_content = words_to_srt_string(english_words)
        vi_srt_content = words_to_srt_string(vietnamese_words)

        en_srt_path = str(OUTPUT_DIR / f"{job_id}_en.srt")
        vi_srt_path = str(OUTPUT_DIR / f"{job_id}_vi.srt")

        save_srt(en_srt_content, en_srt_path)
        save_srt(vi_srt_content, vi_srt_path)

        # ── Step 5: Done ───────────────────────────────────────────
        update_job(
            job_id,
            status           = JobStatus.DONE,
            progress         = 100,
            english_words    = english_words,
            vietnamese_words = vietnamese_words,
            english_text     = result.get("english_text", ""),
            vietnamese_text  = result.get("vietnamese_text", ""),
            en_srt_path      = en_srt_path,
            vi_srt_path      = vi_srt_path,
        )

    except Exception as exc:
        update_job(job_id, status=JobStatus.ERROR, error=str(exc))

    finally:
        # Clean up temp audio
        if os.path.exists(audio_path):
            os.remove(audio_path)
        _cleanup_job_queue(job_id)


def run_pipeline_realtime(job_id: str, colab_url: str) -> None:
    """
    Realtime pipeline with progressive chunked extraction + WebSocket.
    First subtitle appears in ~7-11 seconds.
    """
    job = get_job(job_id)
    if not job:
        return

    video_path = job["video_path"]
    translation_mode = job["translation_mode"]
    source_lang = job.get("source_lang", "en")

    chunks_dir = UPLOAD_DIR / f"{job_id}_chunks"
    chunks_dir.mkdir(exist_ok=True)
    ffmpeg_done = threading.Event()
    ffmpeg_error: list[Exception] = []

    def _ffmpeg_target():
        try:
            extract_audio_chunked(video_path, chunks_dir, 5, ffmpeg_done)
        except Exception as exc:
            ffmpeg_error.append(exc)

    try:
        # Step 1: Start FFmpeg chunked extraction in background
        update_job(job_id, status=JobStatus.EXTRACTING, progress=5)
        ffmpeg_thread = threading.Thread(target=_ffmpeg_target, daemon=True)
        ffmpeg_thread.start()

        # Step 2: Stream chunks via WebSocket
        update_job(job_id, status=JobStatus.TRANSCRIBING, progress=10)
        producer = ChunkProducer(chunks_dir, ffmpeg_done)
        ws_client = ColabWsClient(colab_url)

        english_words: list[dict] = []
        vietnamese_words: list[dict] = []
        english_text_parts: list[str] = []
        vietnamese_text_parts: list[str] = []
        chunk_count = 0

        for event in ws_client.transcribe_stream_ws(
            producer.iter_chunks(), source_lang, translation_mode,
        ):
            if ffmpeg_error:
                raise ffmpeg_error[0]

            if event.get("skipped"):
                chunk_count += 1
                continue

            seg_en = event.get("english_words", [])
            seg_vi = event.get("vietnamese_words", [])
            english_words.extend(seg_en)
            vietnamese_words.extend(seg_vi)

            if event.get("english_text"):
                english_text_parts.append(event["english_text"])
            if event.get("vietnamese_text"):
                vietnamese_text_parts.append(event["vietnamese_text"])

            chunk_count += 1
            progress = min(90, 10 + chunk_count * 5)

            update_job(
                job_id,
                status=JobStatus.TRANSCRIBING,
                progress=progress,
                english_words=english_words,
                vietnamese_words=vietnamese_words,
                english_text="\n".join(english_text_parts),
                vietnamese_text="\n".join(vietnamese_text_parts),
            )

            emit_job_event(job_id, {
                "type": "segment",
                "index": chunk_count,
                "total": chunk_count,
                "progress": progress,
                "english_words": seg_en,
                "vietnamese_words": seg_vi,
            })

        # Wait for FFmpeg to finish
        ffmpeg_thread.join(timeout=10)
        if ffmpeg_error:
            raise ffmpeg_error[0]

        # Step 3: Generate SRT files
        if not english_words and not vietnamese_words:
            raise RuntimeError("No speech detected in the video.")

        update_job(job_id, status=JobStatus.GENERATING, progress=90)

        en_srt_content = words_to_srt_string(english_words)
        vi_srt_content = words_to_srt_string(vietnamese_words)
        en_srt_path = str(OUTPUT_DIR / f"{job_id}_en.srt")
        vi_srt_path = str(OUTPUT_DIR / f"{job_id}_vi.srt")
        save_srt(en_srt_content, en_srt_path)
        save_srt(vi_srt_content, vi_srt_path)

        update_job(
            job_id,
            status=JobStatus.DONE,
            progress=100,
            english_words=english_words,
            vietnamese_words=vietnamese_words,
            english_text="\n".join(english_text_parts),
            vietnamese_text="\n".join(vietnamese_text_parts),
            en_srt_path=en_srt_path,
            vi_srt_path=vi_srt_path,
        )
        emit_job_event(job_id, {"type": "done", "progress": 100})

    except Exception as exc:
        update_job(job_id, status=JobStatus.ERROR, error=str(exc))
        emit_job_event(job_id, {"type": "error", "message": str(exc)})

    finally:
        if chunks_dir.exists():
            shutil.rmtree(chunks_dir, ignore_errors=True)
        _cleanup_job_queue(job_id)
