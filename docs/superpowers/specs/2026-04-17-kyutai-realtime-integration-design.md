# Kyutai Realtime Integration Design

**Date:** 2026-04-17  
**Branch:** kyutai-model  
**Scope:** Replace faster-whisper with Kyutai DSM for realtime EN→VI mode only

---

## Overview

Replace faster-whisper large-v3 with Kyutai's Delayed Streams Modeling (DSM) 1B model for the realtime EN→VI subtitle pipeline. Normal mode (batch) retains faster-whisper unchanged.

**Key improvement:** First subtitle from ~7–11s → ~1–2s, by switching from 5-second FFmpeg chunks to continuous 80ms audio frame streaming.

---

## Section 1: Architecture

```
LOCAL (Flask app)                    COLAB
─────────────────────────────────    ──────────────────────────────────
FFmpeg pipe (24kHz f32le)
  │
AudioStreamProducer
  │ 80ms frames, throttled 1x
KyutaiStreamClient
  │ JSON WebSocket (ngrok)           Flask /ws/transcribe_kyutai
  │                                    │ localhost WebSocket (MessagePack)
  │                                  Kyutai Rust server (:7860)
  │                                    │ Word + VAD messages
  │                                  WordSegmentAccumulator
  │                                    │ boundary detected → enqueue
  │                                  Translate worker thread (Queue)
  │                                    │ VinAI translate
  │                                    │ align_translation_to_words()
  │ ◄── {en_words, vi_words} JSON ───┘
run_pipeline_realtime()
  │ update_job(), emit_job_event()
Frontend (SSE, unchanged)
```

**Protocol boundary:** JSON WebSocket between local ↔ Colab (via ngrok). MessagePack only internal between Flask ↔ Kyutai Rust (localhost, no overhead).

**Note:** base64 audio payload over ngrok is ~128KB/s at 12.5 frames/s. Acceptable for current usage; monitor for latency spikes under poor ngrok conditions.

---

## Section 2: Audio Streaming Pipeline (Local)

### FFmpeg command

```python
# Before: segment files to disk
ffmpeg -i video.mp4 -f segment -segment_time 5 chunk_%03d.wav

# After: continuous pipe, 24kHz float32 mono
ffmpeg -i video.mp4 -vn -ar 24000 -ac 1 -f f32le pipe:1
```

### AudioStreamProducer

```
FRAME_SAMPLES  = 1920    # 80ms @ 24kHz
FRAME_BYTES    = 7680    # 1920 * 4 (float32)
FRAME_DURATION = 0.08s

Loop:
  read FRAME_BYTES from FFmpeg stdout
  base64 encode
  yield {pcm_base64, frame_index, wall_time}
  sleep max(0, next_frame_deadline - now())   # absolute deadline throttle
```

Absolute deadline throttle (not cumulative sleep) prevents timing drift over long videos.

### KyutaiStreamClient

Two concurrent coroutines inside a daemon thread (`asyncio.run()`):
- **sender**: reads frames from `AudioStreamProducer`, sends JSON to Colab WebSocket
- **receiver**: receives result JSON, yields to `run_pipeline_realtime()` via thread-safe Queue

On disconnect: treat as segment boundary (restart segment, not resume). Reconnect up to 3x with backoff (2s → 5s → 10s).

---

## Section 3: Colab Side

### Kyutai Rust Server Startup

```python
import subprocess, socket, time

KYUTAI_PORT = 7860

rust_proc = subprocess.Popen([
    "./moshi_server", "--port", str(KYUTAI_PORT),
    "--model", "kyutai/stt-1b-en_fr"
])

def wait_for_kyutai(port, timeout=120):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection(("localhost", port), timeout=1):
                return True
        except OSError:
            time.sleep(1)
    raise TimeoutError(f"Kyutai server did not start within {timeout}s")

wait_for_kyutai(KYUTAI_PORT)
```

120s timeout covers first-run model download from HuggingFace.

### Model Loading Strategy (T4 16GB)

- faster-whisper large-v3: loaded at startup (normal mode)
- VinAI EN→VI, VI→EN: loaded at startup
- Kyutai Rust: manages its own VRAM via separate process — no conflict

Do NOT load Kyutai PyTorch model in Flask process — Rust server handles inference.

### `/ws/transcribe_kyutai` Endpoint

```
receive {pcm_base64, frame_index} from local client
  │
  ├─ decode base64 → float32 PCM
  ├─ pack MessagePack → send to Kyutai Rust localhost:7860
  ├─ receive Word/VAD message from Kyutai Rust
  │
  └─ WordSegmentAccumulator.add(message)
       if boundary_detected:
         translate_queue.put(segment)   # non-blocking
         reset accumulator

translate_worker (daemon thread):
  segment = translate_queue.get()
  vi_text = vinai_translate(segment.en_text)
  vi_words = align_translation_to_words(segment.en_words, vi_text)
  ws.send({en_words, vi_words, start, end})

on sentinel "END" frame:
  flush accumulator → translate → send → close
```

### WordSegmentAccumulator

Kyutai Rust VAD message format: `{"type": "Vad", "probability": float}`  
Word message format: `{"type": "Word", "text": str, "start": float, "end": float}`

```python
boundary = (
    (vad_prob < 0.3 and accumulated_duration >= 1.0)  # VAD silence, min 1s
    or (now - last_word_time) > 1.5                    # timeout fallback
    or accumulated_duration > 8.0                      # hard cap
)
```

Minimum `accumulated_duration >= 1.0` prevents flush on hesitation (1–2 words mid-breath).

---

## Section 4: Integration Points & Error Handling

### Routing in `run_pipeline_realtime()`

```python
if source_lang == "en":
    client = KyutaiStreamClient(colab_url)
    producer = AudioStreamProducer(video_path)   # FFmpeg pipe, 24kHz
else:
    client = ColabWsClient(colab_url)
    producer = ChunkProducer(video_path, ...)    # unchanged
```

### Error Handling

| Scenario | Handling |
|---|---|
| Kyutai Rust crash mid-stream | Disconnect = segment boundary; restart fresh; retry 3x with backoff |
| Translate worker exception | `emit_job_event(job_id, {"type": "segment_error", "time_range": [start, end], "message": "Translation unavailable"})` → frontend shows `[...]` |
| FFmpeg pipe EOF (corrupt video) | `AudioStreamProducer` sends sentinel "END" → accumulator flush → close gracefully |
| Kyutai server never starts | `wait_for_kyutai()` raises `TimeoutError` → job status = ERROR |

### Job Metadata (no new state)

```python
update_job(job_id, {
    "status": "TRANSCRIBING",
    "kyutai_retry_count": retry_count,
    "last_frame_index": frame_index
})
```

### Unchanged Components

- Auth middleware
- Job state machine (QUEUED → EXTRACTING → TRANSCRIBING → DONE)
- SSE event format (except new `segment_error` type)
- SRT generation logic
- `align_translation_to_words()` — reused as-is
- Frontend (minor: handle `segment_error` event to show `[...]`)
- All non-realtime endpoints

---

## Open Questions / Future Work

- Kyutai 2.6B (English-only) vs 1B (EN+FR): 1B chosen for T4 VRAM budget. Revisit if A100 available.
- base64 overhead (~128KB/s): acceptable now; consider binary WebSocket frame if ngrok latency becomes an issue.
- Reconnect resume: currently restart-segment on disconnect. If segment loss proves frequent, revisit overlap-based resume.
