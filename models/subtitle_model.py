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
import asyncio
import websockets


# ─────────────────────────────────────────────────────────────────
# PATHS
# ─────────────────────────────────────────────────────────────────

UPLOAD_DIR = Path("uploads")
OUTPUT_DIR = Path("outputs")

for _d in [UPLOAD_DIR, OUTPUT_DIR]:
    _d.mkdir(exist_ok=True)


# ─────────────────────────────────────────────────────────────────
# JOB STATUS CONSTANTS
# ─────────────────────────────────────────────────────────────────

class JobStatus:
    QUEUED         = "queued"
    EXTRACTING     = "extracting"
    TRANSCRIBING   = "transcribing"
    TRANSLATING    = "translating"
    ALIGNING       = "aligning"
    GENERATING_SRT = "generating_srt"
    DONE           = "done"
    ERROR          = "error"


# ─────────────────────────────────────────────────────────────────
# JOB STORE  (delegated to jobs_repo — Postgres-backed)
# ─────────────────────────────────────────────────────────────────

from models.jobs_repo import (  # noqa: E402
    create_job,
    get_job,
    update_job,
    get_job_event_queue,
    emit_job_event,
)
from models.storage_repo import upload_file


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


class AudioStreamProducer:
    """Read a video file via FFmpeg and yield PCM frames at real-time pace.

    EN path: sample_rate=24000, frame_duration=0.08  → 1920 samples/frame (Kyutai)
    VI path: sample_rate=16000, frame_duration=0.032 → 512 samples/frame  (Silero VAD)
    """

    def __init__(self, video_path: str, sample_rate: int = 24000, frame_duration: float = 0.08):
        self.video_path = video_path
        self.sample_rate = sample_rate
        self.frame_duration = frame_duration
        self.frame_samples = int(sample_rate * frame_duration)
        self.frame_bytes = self.frame_samples * 4  # float32

    def iter_frames(self) -> Iterator[dict]:
        """Yield frame dicts throttled to real-time, then a sentinel {"type": "END"}."""
        cmd = [
            "ffmpeg", "-i", self.video_path,
            "-vn",
            "-ar", str(self.sample_rate),
            "-ac", "1",
            "-f", "f32le",
            "pipe:1",
        ]
        proc = _sp.Popen(cmd, stdout=_sp.PIPE, stderr=_sp.DEVNULL)
        start_time = time.time()
        frame_index = 0
        try:
            while True:
                raw = proc.stdout.read(self.frame_bytes)
                if len(raw) < self.frame_bytes:
                    break
                pcm_b64 = base64.b64encode(raw).decode("utf-8")
                yield {
                    "pcm_base64": pcm_b64,
                    "frame_index": frame_index,
                }
                # Throttle to real-time using absolute deadline
                deadline = start_time + (frame_index + 1) * self.frame_duration
                frame_index += 1
                sleep_for = deadline - time.time()
                if sleep_for > 0:
                    time.sleep(sleep_for)
        finally:
            proc.stdout.close()
            if proc.poll() is None:  # only kill if still running
                proc.kill()
            proc.wait()

        if proc.returncode not in (0, -9):
            raise RuntimeError(
                f"FFmpeg exited with code {proc.returncode} for {self.video_path}"
            )
        yield {"type": "END"}


class RealtimeStreamClient:
    """Generic WebSocket client for frame-based real-time streaming ASR.

    EN path: ws_path="/ws/transcribe_kyutai"       (VM1, Kyutai)
    VI path: ws_path="/ws/transcribe_vi_realtime"  (VM2, Silero VAD + PhoWhisper)
    """

    BACKOFF = [2, 5, 10]
    MAX_RETRIES = 3

    def __init__(self, colab_url: str, ws_path: str):
        base = colab_url.rstrip("/")
        self.ws_url = (
            base.replace("https://", "wss://").replace("http://", "ws://") + ws_path
        )
        self.headers = {"ngrok-skip-browser-warning": "true"}

    def stream(self, producer: AudioStreamProducer) -> Iterator[dict]:
        """
        Stream frames from producer to Kyutai WebSocket endpoint.
        Yields result dicts as they arrive from the server in real-time.
        Reconnects up to MAX_RETRIES times on disconnection.
        """
        result_queue: queue.Queue = queue.Queue()
        _DONE = object()  # sentinel

        async def _run():
            retry_count = 0
            while retry_count <= self.MAX_RETRIES:
                try:
                    async with websockets.connect(
                        self.ws_url,
                        additional_headers=self.headers,
                        open_timeout=30,
                        ping_interval=20,
                        ping_timeout=30,
                    ) as ws:
                        async def sender():
                            loop = asyncio.get_running_loop()
                            frame_iter = producer.iter_frames()
                            while True:
                                frame = await loop.run_in_executor(None, next, frame_iter, None)
                                if frame is None:
                                    break
                                if frame.get("type") == "END":
                                    await ws.send(json.dumps({"type": "END"}))
                                    break
                                await ws.send(json.dumps({
                                    "pcm_base64": frame["pcm_base64"],
                                    "frame_index": frame["frame_index"],
                                }))

                        async def receiver():
                            async for raw in ws:
                                try:
                                    result_queue.put(json.loads(raw))
                                except Exception as e:
                                    print(f"[RealtimeStreamClient] Failed to parse server message: {e!r}")

                        await asyncio.gather(sender(), receiver())
                        break  # success, exit retry loop
                except Exception as exc:
                    if retry_count >= self.MAX_RETRIES:
                        break
                    delay = self.BACKOFF[min(retry_count, len(self.BACKOFF) - 1)]
                    print(
                        f"⚠️ Realtime WS error (retry {retry_count + 1}/{self.MAX_RETRIES}): "
                        f"{exc}. Reconnecting in {delay}s..."
                    )
                    await asyncio.sleep(delay)
                    retry_count += 1
            if retry_count >= self.MAX_RETRIES:
                result_queue.put(RuntimeError(
                    f"Realtime WS failed after {self.MAX_RETRIES} retries"
                ))
            result_queue.put(_DONE)

        t = threading.Thread(target=lambda: asyncio.run(_run()), daemon=True)
        t.start()

        while True:
            result = result_queue.get()
            if isinstance(result, Exception):
                raise result
            if result is _DONE:
                break
            yield result

        t.join()


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

    # Construct local SRT path from job_id (video_path is local-only, not in DB)
    srt_path = str(OUTPUT_DIR / f"{job['job_id']}_{lang}.srt")
    if not os.path.exists(srt_path):
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

    translation_mode = job["translation_mode"]
    source_lang      = job.get("source_lang", "en")
    audio_path       = str(UPLOAD_DIR / f"{job_id}_audio.wav")
    video_path       = None  # populated inside try block

    try:
        video_path = job.get("video_path")
        if not video_path:
            raise RuntimeError("video_path not found in job cache — server may have restarted")

        # ── Step 1: Extract audio ──────────────────────────────────
        update_job(job_id, status=JobStatus.EXTRACTING, progress=5)
        extract_audio(video_path, audio_path)

        # ── Step 2: VAD (collapsed into EXTRACTING) ───────────────
        update_job(job_id, status=JobStatus.EXTRACTING, progress=20)

        # ── Step 3: Encode + send to Colab ─────────────────────────
        update_job(job_id, status=JobStatus.TRANSCRIBING, progress=40)
        segments_data = _prepare_segments(audio_path, min_duration=2.0)

        client = ColabClient(colab_url)
        result = client.transcribe_translate(segments_data, translation_mode, source_lang=source_lang)

        english_words    = result["english_words"]
        vietnamese_words = result["vietnamese_words"]

        # ── Step 4: Generate SRT files locally ────────────────────
        update_job(job_id, status=JobStatus.GENERATING_SRT, progress=80)

        en_srt_content = words_to_srt_string(english_words)
        vi_srt_content = words_to_srt_string(vietnamese_words)

        en_srt_path = str(OUTPUT_DIR / f"{job_id}_en.srt")
        vi_srt_path = str(OUTPUT_DIR / f"{job_id}_vi.srt")

        save_srt(en_srt_content, en_srt_path)
        save_srt(vi_srt_content, vi_srt_path)

        # ── Step 5: Upload SRT to Storage, then mark done ─────────
        # Atomicity: status='done' is only written after both uploads succeed.
        user_id = job.get("user_id", "unknown")
        en_storage_path = f"{user_id}/{job_id}/en.srt"
        vi_storage_path = f"{user_id}/{job_id}/vi.srt"

        upload_file(en_srt_path, en_storage_path)
        upload_file(vi_srt_path, vi_storage_path)

        update_job(
            job_id,
            status               = JobStatus.DONE,
            progress             = 100,
            english_words        = english_words,
            vietnamese_words     = vietnamese_words,
            english_text         = result.get("english_text", ""),
            vietnamese_text      = result.get("vietnamese_text", ""),
            en_srt_storage_path  = en_storage_path,
            vi_srt_storage_path  = vi_storage_path,
            completed_at         = "now()",
        )

    except Exception as exc:
        import traceback
        print(f"[pipeline ERROR] job={job_id}: {exc}")
        traceback.print_exc()
        update_job(job_id, status=JobStatus.ERROR, error=str(exc))

    finally:
        # Keep video for Editor playback; cleanup daemon removes it after 7 days.
        # Only delete the intermediate audio WAV which is not needed after pipeline.
        if audio_path and os.path.exists(audio_path):
            os.remove(audio_path)


def run_pipeline_realtime(job_id: str, colab_url: str, colab_realtime_url: str | None = None) -> None:
    """
    Realtime pipeline using frame-by-frame streaming for both EN and VI.

    EN → VM1 Kyutai (24kHz, 80ms frames) via /ws/transcribe_kyutai
    VI → VM2 Silero VAD + PhoWhisper (16kHz, 32ms frames) via /ws/transcribe_vi_realtime
    First subtitle appears in ~1-2s.
    """
    job = get_job(job_id)
    if not job:
        return

    source_lang = job.get("source_lang", "en")
    video_path = None  # populated inside try block

    try:
        video_path = job.get("video_path")
        if not video_path:
            raise RuntimeError("video_path not found in job cache — server may have restarted")

        update_job(job_id, status=JobStatus.TRANSCRIBING, progress=10)
        if source_lang == "en":
            audio_producer = AudioStreamProducer(video_path, sample_rate=24000, frame_duration=0.08)
            client = RealtimeStreamClient(colab_realtime_url or colab_url, "/ws/transcribe_kyutai")
        else:
            audio_producer = AudioStreamProducer(video_path, sample_rate=16000, frame_duration=0.032)
            client = RealtimeStreamClient(colab_url, "/ws/transcribe_vi_realtime")
        event_iter = client.stream(audio_producer)

        english_words: list[dict] = []
        vietnamese_words: list[dict] = []
        english_text_parts: list[str] = []
        vietnamese_text_parts: list[str] = []
        chunk_count = 0

        for event in event_iter:
            ev_type = event.get("type")

            if ev_type == "segment_error":
                emit_job_event(job_id, event)
                continue

            if ev_type == "word_partial":
                emit_job_event(job_id, {
                    "type": "word_partial",
                    "word": event.get("word", ""),
                    "frame_ts": event.get("frame_ts", 0.0),
                })
                continue

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

        # Step 3: Generate SRT files
        if not english_words and not vietnamese_words:
            raise RuntimeError("No speech detected in the video.")

        update_job(job_id, status=JobStatus.GENERATING_SRT, progress=90)

        en_srt_content = words_to_srt_string(english_words)
        vi_srt_content = words_to_srt_string(vietnamese_words)
        en_srt_path = str(OUTPUT_DIR / f"{job_id}_en.srt")
        vi_srt_path = str(OUTPUT_DIR / f"{job_id}_vi.srt")
        save_srt(en_srt_content, en_srt_path)
        save_srt(vi_srt_content, vi_srt_path)

        # Atomicity: status='done' is only written after both uploads succeed.
        user_id = job.get("user_id", "unknown")
        en_storage_path = f"{user_id}/{job_id}/en.srt"
        vi_storage_path = f"{user_id}/{job_id}/vi.srt"

        upload_file(en_srt_path, en_storage_path)
        upload_file(vi_srt_path, vi_storage_path)

        update_job(
            job_id,
            status=JobStatus.DONE,
            progress=100,
            english_words=english_words,
            vietnamese_words=vietnamese_words,
            english_text="\n".join(english_text_parts),
            vietnamese_text="\n".join(vietnamese_text_parts),
            en_srt_storage_path=en_storage_path,
            vi_srt_storage_path=vi_storage_path,
            completed_at="now()",
        )
        emit_job_event(job_id, {"type": "done", "progress": 100})

    except Exception as exc:
        update_job(job_id, status=JobStatus.ERROR, error=str(exc))
        emit_job_event(job_id, {"type": "error", "message": str(exc)})

    finally:
        # Keep video for Editor playback; cleanup daemon removes it after 7 days.
        pass
