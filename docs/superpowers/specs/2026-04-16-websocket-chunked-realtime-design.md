# WebSocket Chunked Realtime Pipeline

**Date:** 2026-04-16
**Status:** Approved

## Problem

Realtime mode hiện tại có "hidden batch phase" trước khi stream bắt đầu:

```
Upload → FFmpeg extract FULL audio → VAD scan FULL file → Encode ALL segments
→ Gửi 1 batch lên Colab → Colab mới stream về
```

Video có tiếng nói ngay từ đầu sẽ không hiển thị subtitle cho đến khi toàn bộ preprocessing hoàn tất (~30s–3min tùy độ dài video). Mục tiêu: subtitle đầu tiên xuất hiện trong **7–11 giây** sau khi upload xong.

## Approach đã loại bỏ

- **Soniox API (true 200ms streaming):** Cần thay thế toàn bộ PhoWhisper + VinAI Translate. Whisper-based models không phù hợp với 200ms chunks vì cần đủ context để chính xác.
- **HTTP per-chunk fallback:** Phức tạp hơn mà không mang lại lợi ích đủ lớn so với WebSocket persistent connection.

## Kiến trúc

```
Video file
  │
  ▼
[FFmpeg -f segment -segment_time 5]   ← background thread
  │  writes chunk_000.wav, chunk_001.wav... progressively
  ▼
[ChunkProducer]                        ← watcher thread
  │  polls every 0.5s, detects "closed" chunks
  │  VAD + base64 encode per chunk
  ▼
[ColabWsClient.transcribe_stream_ws]  ← WebSocket, persistent connection
  │  send chunk → receive result (sequential)
  │  auto-reconnect + resume on drop (max 3 retries, backoff 2s/5s/10s)
  ▼
[Colab /ws/transcribe_stream]         ← flask-sock endpoint
  │  receive 1 chunk → ASR + MT → send result
  ▼
[Local: emit SSE event to job queue]  ← unchanged
  ▼
[Frontend EditorPage]                 ← unchanged
```

**Latency breakdown:**
- FFmpeg ghi chunk đầu (5s audio): ~2–3s
- ChunkProducer detect + VAD + encode: ~0.5s
- WebSocket send + Colab ASR+MT (5s audio, GPU): ~4–7s
- **First subtitle: ~7–11s** ✅

## WebSocket Protocol

### Client → Colab (mỗi chunk)
```json
{
  "index": 0,
  "audio_base64": "<base64 float32 PCM>",
  "start_offset": 0.0,
  "end_offset": 5.0,
  "source_lang": "vi",
  "translation_mode": "segment"
}
```

### Colab → Client (kết quả mỗi chunk)
```json
{
  "index": 0,
  "english_words": [{"word": "...", "start": 0.0, "end": 0.5}],
  "vietnamese_words": [...],
  "english_text": "...",
  "vietnamese_text": "...",
  "skipped": false
}
```

`skipped: true` khi chunk không có tiếng nói (VAD phát hiện silence).

### Auto-reconnect + Resume
- `last_acked_index`: index chunk đã nhận kết quả thành công
- Khi WS drop: reconnect và gửi lại từ `last_acked_index + 1`
- Backoff: 2s → 5s → 10s (3 lần)
- Sau 3 lần fail: raise exception → job status = `ERROR`

## Thay đổi chi tiết

### Local Server — `models/subtitle_model.py`

**Hàm mới: `extract_audio_chunked(video_path, chunks_dir, chunk_seconds=5)`**
- Chạy FFmpeg với `-f segment -segment_time 5 -acodec pcm_s16le -ac 1 -ar 16000`
- Chạy trong thread riêng
- Returns khi FFmpeg kết thúc hoặc nhận cancel signal

**Class mới: `ChunkProducer`**
- Constructor: `(chunks_dir: Path, ffmpeg_done_event: threading.Event)`
- Method: `iter_chunks() → Iterator[dict]`
- Logic "chunk closed": chunk N được coi là closed khi chunk N+1 đã xuất hiện, hoặc khi ffmpeg_done_event được set
- Mỗi chunk: VAD → encode base64 → yield dict với index, audio_base64, start_offset, end_offset

**Method mới: `ColabWsClient.transcribe_stream_ws(chunks_iter, source_lang, translation_mode)`**
- Mở WebSocket tới `wss://[colab_url]/ws/transcribe_stream` (ngrok dùng HTTPS/WSS — dùng `wss://` thay cho `ws://`)
- Loop: lấy chunk từ iter → send JSON → recv result → yield result dict
- Tracking `last_acked_index` cho resume
- Auto-reconnect với backoff khi `ConnectionError` hoặc `WebSocketError`
- Yields dict events với cùng format như `transcribe_translate_stream` hiện tại

**Thay đổi: `run_pipeline_realtime()`**
```python
# Trước
segments_data = _prepare_segments(audio_path, min_duration=1.5)
for event in client.transcribe_translate_stream(segments_data, ...):
    ...

# Sau
chunks_dir = UPLOAD_DIR / f"{job_id}_chunks"
chunks_dir.mkdir(exist_ok=True)
ffmpeg_done = threading.Event()
ffmpeg_thread = threading.Thread(
    target=extract_audio_chunked,
    args=(video_path, chunks_dir, 5, ffmpeg_done)
)
ffmpeg_thread.start()

producer = ChunkProducer(chunks_dir, ffmpeg_done)
for event in client.transcribe_stream_ws(producer.iter_chunks(), source_lang, translation_mode):
    ...
```

Cleanup: xóa `chunks_dir` trong `finally` block.

### Colab — `colab.md`

**Cell 1:** Thêm `flask-sock` vào pip install.

**Cell 5 (sau khi tạo app):** Thêm `sock = Sock(app)`.

**Cell 5c mới — WebSocket + helper:**

```python
from flask_sock import Sock
sock = Sock(app)

def process_single_chunk(chunk_data: dict) -> dict:
    """ASR + MT cho 1 chunk. Dùng chung cho WS và HTTP."""
    source_lang = chunk_data.get("source_lang", "en")
    translation_mode = chunk_data.get("translation_mode", "segment")
    active_asr = get_asr_model(source_lang)
    translate_fn = translate_vi2en_batch if source_lang == "vi" else translate_en2vi_batch

    audio_bytes = base64.b64decode(chunk_data["audio_base64"])
    audio = np.frombuffer(audio_bytes, dtype=np.float32)
    start_offset = chunk_data.get("start_offset", 0.0)

    segments_gen, _ = active_asr.transcribe(
        audio, task="transcribe", language=source_lang,
        word_timestamps=True, beam_size=5, vad_filter=False
    )

    words = []
    for s in segments_gen:
        if s.words:
            for w in s.words:
                if is_valid_word(w.word):
                    words.append({
                        "word": w.word.strip(),
                        "start": round(start_offset + w.start, 2),
                        "end": round(start_offset + w.end, 2),
                    })

    if not words:
        return {"index": chunk_data.get("index", 0), "skipped": True}

    segment_text = add_punctuation_simple(" ".join(w["word"] for w in words))
    translated_text = translate_fn([segment_text])[0]
    translated_words = align_translation_to_words(words, segment_text, translated_text)

    if source_lang == "vi":
        en_words, vi_words = translated_words, words
        en_text, vi_text = translated_text, segment_text
    else:
        en_words, vi_words = words, translated_words
        en_text, vi_text = segment_text, translated_text

    return {
        "index": chunk_data.get("index", 0),
        "start_offset": start_offset,
        "end_offset": chunk_data.get("end_offset", start_offset + 5.0),
        "english_words": en_words,
        "vietnamese_words": vi_words,
        "english_text": en_text,
        "vietnamese_text": vi_text,
        "skipped": False,
    }

@sock.route("/ws/transcribe_stream")
def transcribe_stream_ws(ws):
    logger.info("⚡ WS connection opened")
    while True:
        data = ws.receive()
        if data is None:
            break
        chunk = json.loads(data)
        result = process_single_chunk(chunk)
        ws.send(json.dumps(result, ensure_ascii=False))
        logger.info(f"  ✅ WS chunk {chunk.get('index')} done")
    logger.info("⚡ WS connection closed")
```

Tất cả HTTP endpoints cũ (`/transcribe_translate`, `/transcribe_translate_stream`, v.v.) giữ nguyên.

## Không thay đổi

- Frontend (`EditorPage.tsx`, `api.ts`) — vẫn nhận SSE events như hiện tại
- HTTP endpoints trên Colab — vẫn hoạt động bình thường
- Normal pipeline (`run_pipeline`) — không thay đổi
- Job status flow, SSE event format — không thay đổi

## Dependency mới

| Bên | Package | Lý do |
|-----|---------|-------|
| Colab | `flask-sock` | WebSocket server |
| Local | `websocket-client` | WebSocket client Python |
