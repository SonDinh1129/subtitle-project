# SubAI — AI Subtitle Generator

Nền tảng SaaS tạo phụ đề tự động từ video, hỗ trợ tiếng Anh và tiếng Việt, đạt chuẩn broadcast/Netflix.

---

## Mục lục

1. [Cấu trúc dự án](#1-cấu-trúc-dự-án)
2. [Kiến trúc hệ thống](#2-kiến-trúc-hệ-thống)
3. [Luồng xử lý (System Flow)](#3-luồng-xử-lý-system-flow)
   - [3.1 Normal Mode](#31-normal-mode-video-upload--srt)
   - [3.2 Realtime Mode — Tổng quan](#32-realtime-mode--tổng-quan-luồng-dữ-liệu)
   - [3.3 Realtime Mode — Chi tiết từng tầng](#33-realtime-mode--chi-tiết-từng-tầng)
     - [AudioStreamProducer](#331-audiostreamproducer--nguồn-pcm-frames)
     - [RealtimeStreamClient](#332-realtimestreamclient--websocket-bridge)
     - [run_pipeline_realtime](#333-run_pipeline_realtime--orchestrator)
     - [SSE Endpoint](#334-sse-endpoint--controller)
     - [Frontend SSE Client](#335-frontend-sse-client--openrealtimestream)
     - [EditorPage State & Rendering](#336-editorpage--state-management--rendering)
     - [UploadPage Warmup UX](#337-uploadpage--warmup-ux)
   - [3.4 Timing & Latency Analysis](#34-timing--latency-analysis)
   - [3.5 Error Handling & Resilience](#35-error-handling--resilience)
4. [Thuật toán phụ đề](#4-thuật-toán-phụ-đề)
5. [Model AI & Cách Pull Model](#5-model-ai--cách-pull-model)
6. [Pipeline xử lý âm thanh](#6-pipeline-xử-lý-âm-thanh)
7. [Pipeline dịch thuật](#7-pipeline-dịch-thuật)
8. [Kiến trúc Frontend](#8-kiến-trúc-frontend)
9. [Hệ thống cấu hình](#9-hệ-thống-cấu-hình)
10. [API Endpoints](#10-api-endpoints)
11. [Thanh toán & Tính năng Premium](#11-thanh-toán--tính-năng-premium)
12. [Cài đặt & Chạy](#12-cài-đặt--chạy)
13. [Quality Report — Đo chỉ số phụ đề](#13-quality-report--đo-chỉ-số-phụ-đề)
14. [Tài liệu & Kiểm thử](#14-tài-liệu--kiểm-thử)

---

## 1. Cấu trúc dự án

```
subtitle-project/
├── app.py                          ← Entry point: Flask app factory, load VAD, đăng ký blueprint
├── controllers/
│   ├── subtitle_controller.py      ← Routes chính: upload, stream SSE, export, optimize
│   ├── auth_controller.py          ← Account: /me, profile, change-password, delete account (signup/login do qua Supabase client)
│   └── payment_controller.py       ← MoMo payment integration
├── models/
│   ├── subtitle_model.py           ← Business logic: VAD, Colab client, SRT gen, job store
│   ├── subtitle_optimizer.py       ← Post-processing: CPS/CPL/Duration/Gap enforcement
│   └── momo.py                     ← MoMo payment processor
├── middleware/
│   └── auth.py                     ← JWT validation, @require_auth, @require_premium
├── src/                            ← React frontend (TypeScript)
│   ├── lib/
│   │   ├── api.ts                  ← HTTP client, type definitions
│   │   └── supabase.ts             ← Supabase auth client
│   └── app/
│       ├── pages/                  ← UploadPage, EditorPage, ProfilePage, ...
│       ├── components/             ← UI components (Radix UI + Tailwind)
│       ├── context/                ← AuthContext, UiPreferencesContext
│       └── routes.ts               ← React Router config
├── views/
│   ├── templates/index.html        ← React SPA shell
│   └── static/                     ← React build output (dist/)
├── uploads/                        ← Temporary video storage
├── outputs/                        ← Generated SRT files
├── jobs/                           ← Job status JSON files (disk persistence)
├── requirements.txt
├── package.json
├── vite.config.ts
└── .env.example
```

---

## 2. Kiến trúc hệ thống

### 2.1 Tổng quan

```
┌─────────────────────────────────────┐
│           Browser (React SPA)       │
│   UploadPage → EditorPage → Export  │
└────────────────┬────────────────────┘
                 │ HTTP/JSON, SSE, XHR
                 ▼
┌─────────────────────────────────────┐
│   Controller (subtitle_controller)  │
│ ┌──────────────────────────────┐    │
│ │ /api/upload                  │    │  Validate, authenticate, rate-limit
│ │ /api/jobs/<id>/stream   (SSE)│    │  Flask-Limiter: 5 uploads/min
│ │ /api/jobs/<id>               │    │
│ │ /api/jobs/<id>/download/lang │    │
│ │ /api/export                  │    │
│ │ /api/jobs/<id>/optimize      │    │
│ └──────────────────────────────┘    │
└────────────────┬────────────────────┘
                 │ Python function calls
                 ▼
┌─────────────────────────────────────┐
│   Model Layer (subtitle_model.py)   │
│  ┌──────────┐  ┌──────────────────┐ │
│  │ FFmpeg   │  │  Silero VAD      │ │
│  │ (audio   │  │  (speech detect) │ │
│  │ extract) │  └──────────────────┘ │
│  └──────────┘  ┌──────────────────┐ │
│                │  Job State Store  │ │
│                │  (memory + disk)  │ │
│                └──────────────────┘ │
└────────────────┬────────────────────┘
                 │ async HTTP / WebSocket
                 ▼
┌─────────────────────────────────────┐
│       Google Colab (via ngrok)      │
│  ┌──────────────┐ ┌───────────────┐ │
│  │ Whisper ASR  │ │ VinAI EN→VI   │ │
│  │ (EN audio)   │ │ Translation   │ │
│  └──────────────┘ └───────────────┘ │
│  ┌──────────────────────────────┐   │
│  │ Kyutai Realtime (EN stream)  │   │  COLAB_REALTIME_URL
│  └──────────────────────────────┘   │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│       Supabase (Auth, DB)           │
│  Auth: Magic Link, Password, OAuth  │
│  Profiles: subscription, usage      │
└─────────────────────────────────────┘
```

### 2.2 Authentication & Authorization

| Cơ chế | Chi tiết |
|--------|---------|
| Đăng ký | Email + mật khẩu, xác nhận tài khoản qua **Magic Link** (`signUp` + `emailRedirectTo=/auth/callback`) — mật khẩu được lưu nên người dùng đăng nhập lại bằng mật khẩu sau khi xác nhận |
| Đăng nhập | Email/mật khẩu (`signInWithPassword`) hoặc **Google OAuth** |
| Quên mật khẩu | Xác thực **OTP 6 số** gửi về email (`resetPasswordForEmail` → `verifyOtp` → `updateUser`) |
| Backend validation | JWT HS256 verify với `SUPABASE_JWT_SECRET` |
| Route protection | Frontend: `ProtectedRoute` (`/upload`, `/editor`, `/upgrade`, `/profile`) · Backend: `@require_auth` decorator |
| Premium gates | `@require_premium` kiểm tra `profile.premium_until > now()` |
| Rate limiting | Flask-Limiter: 5 uploads/phút; 3 tạo đơn thanh toán/phút |

> Cấu hình Supabase: bật **Confirm email**, template **Confirm signup** dùng `{{ .ConfirmationURL }}`, và thêm `http://localhost:5173/auth/callback` vào Redirect URLs (xem [docs/sequence.md](docs/sequence.md) — biểu đồ tuần tự luồng xác thực).

### 2.3 Job State Management

Job được lưu trữ theo mô hình **hybrid in-memory + JSON disk**:

```python
_jobs: dict[str, dict] = {}        # In-memory (truy cập nhanh)
_jobs_lock = threading.Lock()      # Thread-safe
JOBS_DIR / f"{job_id}.json"        # JSON file per job (durability)
_job_event_queues: dict[str, queue.Queue] = {}  # SSE event queue
```

**Lifecycle của một job:**

```
create_job()  →  update_job()  →  run_pipeline()  →  Final state
    │                │                  │
JSON file      JSON update       Background thread
+ queue        + in-memory        pushes events
created        cache               to SSE queue
```

---

## 3. Luồng xử lý (System Flow)

### 3.1 Normal Mode (Video upload → SRT)

```
1. User upload video
        │
        ▼
2. Controller validates file type (mp4/mov/mkv/avi/webm)
   Creates job_id, saves video to uploads/
        │
        ▼
3. Background thread: run_pipeline()
        │
        ├── 3a. FFmpeg extract audio (16kHz mono WAV)
        │
        ├── 3b. Silero VAD detect speech segments
        │         [{"start": 0.5, "end": 4.2}, ...]
        │
        ├── 3c. merge_short_segments() — gộp segments < 2s
        │    split_long_segment()      — cắt segments > 25s
        │
        ├── 3d. Encode each segment to base64 PCM
        │
        ├── 3e. HTTP POST to Colab /transcribe_translate THEO BATCH 15 segments
        │         (transcribe_translate_batched — tránh Colab OOM với video dài)
        │         ← Whisper ASR (EN) / PhoWhisper (VI)
        │         ← VinAI Translation (EN→VI)
        │         Response mỗi batch: word-level timestamps EN + VI
        │         update_job progress 40 → 78 theo từng batch
        │
        ├── 3f. words_to_srt_string() — tạo SRT từ word timestamps
        │
        ├── 3g. Upload SRT lên Supabase Storage (bucket: subtitle-file)
        │         key: {user_id}/{job_id}/en.srt và vi.srt
        │         Lưu en_srt_storage_path / vi_srt_storage_path vào job
        │
        └── 3h. Xóa audio WAV; GIỮ video cho Editor playback
                 (cleanup daemon xóa uploads/ + outputs/ sau 7 ngày)
                 Update job status = "done"

4. Frontend polls /api/jobs/<id> → lấy signed URL từ /jobs/<id>/srt-url
```

### 3.2 Realtime Mode — Tổng quan luồng dữ liệu

```
UploadPage (chọn "Realtime")
    │
    │  POST /api/upload (process_mode=realtime)
    ▼
Controller: create_job() → spawn background thread
    │
    │  threading.Thread(target=run_pipeline_realtime, daemon=True)
    ▼
┌──────────────────────────────────────────────────────────────┐
│  run_pipeline_realtime()  [background thread]                │
│                                                              │
│  AudioStreamProducer                                         │
│  ┌────────────────────────────────┐                          │
│  │ FFmpeg subprocess              │                          │
│  │ -vn -ar 24000 -ac 1 -f f32le  │ ← raw float32 PCM        │
│  │ pipe:1 (stdout)               │   liên tục               │
│  └────────────┬───────────────────┘                          │
│               │ iter_frames() — deadline-throttled           │
│               │ yield {pcm_base64, frame_index}              │
│               │ yield {type: "END"}                          │
│               ▼                                              │
│  RealtimeStreamClient.stream()                               │
│  ┌────────────────────────────────┐                          │
│  │ asyncio event loop (daemon t.) │                          │
│  │                                │                          │
│  │  sender() ──────────────────── │ → WebSocket → Colab      │
│  │  receiver() ←───────────────── │ ← WebSocket ← Colab      │
│  │                                │                          │
│  │  result_queue (thread-safe)    │                          │
│  └────────────────────────────────┘                          │
│               │ yield segment events                         │
│               ▼                                              │
│  emit_job_event() → _job_event_queues[job_id].put(event)     │
└──────────────────────────────────────────────────────────────┘
    │
    │  SSE GET /api/jobs/<id>/stream
    ▼
Controller SSE generator: q.get(timeout=20) → yield SSE frame
    │
    │  EventSource (browser)
    ▼
EditorPage.openRealtimeStream() → onEvent(evt)
    │
    ├── evt.type == "word_partial"  → setInProgressWords(prev[-12:] + word)
    ├── evt.type == "segment"       → setEnglishWords(prev + seg.english_words)
    │                                  setVietnameseWords(prev + seg.vietnamese_words)
    └── evt.type == "done"          → setStreamStatus("done")
    │
    ▼
useEffect([englishWords]) → setEnglishSubtitles(mapWordsToUiSubtitles())
    │
    ▼
Subtitle overlay render (Motion div, 180ms fade)
```

---

### 3.3 Realtime Mode — Chi tiết từng tầng

#### 3.3.1 `AudioStreamProducer` — Nguồn PCM frames

**Vị trí:** `models/subtitle_model.py`

```python
AudioStreamProducer(
    video_path: str,
    sample_rate: int = 24000,   # EN: 24000 Hz / VI: 16000 Hz
    frame_duration: float = 0.08  # EN: 0.08s / VI: 0.032s
)
```

**Tính toán kích thước frame:**

| Ngôn ngữ | Sample rate | Frame duration | Samples/frame | Bytes/frame (float32) |
|----------|-------------|---------------|---------------|----------------------|
| English (Kyutai) | 24,000 Hz | 80ms | 1,920 | 7,680 bytes |
| Vietnamese | 16,000 Hz | 32ms | 512 | 2,048 bytes |

**FFmpeg command:**
```bash
ffmpeg -i <video> -vn -ar <sample_rate> -ac 1 -f f32le pipe:1
# -vn      : bỏ video track
# -ac 1    : mono
# -f f32le : float32 little-endian PCM → stdout
```

**`iter_frames()` algorithm:**
```
start_time = time.time()
frame_index = 0

loop:
    raw_bytes = ffmpeg_stdout.read(frame_bytes)  # blocking read
    if len(raw_bytes) < frame_bytes: break        # EOF

    yield {
        "pcm_base64": base64.b64encode(raw_bytes).decode(),
        "frame_index": frame_index
    }

    # Real-time throttling (deadline-based pacing)
    deadline = start_time + (frame_index + 1) * frame_duration
    sleep_for = deadline - time.time()
    if sleep_for > 0:
        time.sleep(sleep_for)        # nhường CPU, đợi đến deadline

    frame_index += 1

yield {"type": "END"}    # sentinel báo hết audio
```

**Tại sao cần throttling?**
FFmpeg decode nhanh hơn realtime nhiều lần. Nếu không throttle, toàn bộ audio sẽ được gửi lên Colab ngay lập tức → Colab bị overload, buffer đầy, kết quả không ra theo thứ tự thời gian. Deadline-based pacing đảm bảo frames được gửi đúng tốc độ phát lại thực tế.

---

#### 3.3.2 `RealtimeStreamClient` — WebSocket Bridge

**Vị trí:** `models/subtitle_model.py`

```python
RealtimeStreamClient(
    colab_url: str,   # https://xyz.ngrok.io
    ws_path: str      # /ws/transcribe_kyutai hoặc /ws/transcribe_vi_realtime
)
```

**URL construction:**
```python
# https → wss (TLS WebSocket)
ws_url = colab_url.replace("https://", "wss://") + ws_path
headers = {"ngrok-skip-browser-warning": "true"}
```

**Threading model:**

```
Main thread (run_pipeline_realtime)
    │
    │ result_queue = queue.Queue()
    │
    ├── daemon thread: asyncio.run(_run())
    │       │
    │       └── asyncio event loop:
    │               ├── sender()   ← producer.iter_frames() (in executor)
    │               │               → ws.send(JSON frame)
    │               └── receiver() ← async for raw in ws:
    │                               → result_queue.put(json.loads(raw))
    │
    └── generator: while True: yield result_queue.get()
```

**WebSocket message formats:**

Sender → Colab:
```json
{"pcm_base64": "AAAA...", "frame_index": 42}
{"type": "END"}
```

Colab → Receiver (segment complete):
```json
{
  "english_words":    [{"word": "hello", "start": 0.5, "end": 1.0}],
  "vietnamese_words": [{"word": "xin",   "start": 0.5, "end": 1.0}],
  "english_text":     "hello world",
  "vietnamese_text":  "xin chào thế giới"
}
```

Colab → Receiver (partial word preview):
```json
{"type": "word_partial", "word": "hel", "frame_ts": 0.48}
```

**Retry logic:**
```python
BACKOFF = [2, 5, 10]   # seconds
MAX_RETRIES = 3

# WebSocket params:
open_timeout   = 30s   # max connection setup time
ping_interval  = 20s   # keepalive ping
ping_timeout   = 30s   # wait for pong

# On failure: asyncio.sleep(BACKOFF[retry]) → reconnect
# After MAX_RETRIES: queue RuntimeError → raises in main thread
```

---

#### 3.3.3 `run_pipeline_realtime()` — Orchestrator

**Vị trí:** `models/subtitle_model.py`

```python
def run_pipeline_realtime(job_id, colab_url, colab_realtime_url=None):
```

**Language routing:**
```python
if source_lang == "en":
    producer = AudioStreamProducer(video, sample_rate=24000, frame_duration=0.08)
    client   = RealtimeStreamClient(colab_realtime_url or colab_url,
                                    "/ws/transcribe_kyutai")
else:
    producer = AudioStreamProducer(video, sample_rate=16000, frame_duration=0.032)
    client   = RealtimeStreamClient(colab_url,
                                    "/ws/transcribe_vi_realtime")
```

**Event processing loop:**
```python
english_words, vietnamese_words = [], []
chunk_count = 0

for event in client.stream(producer):
    match event.get("type"):

        case "segment_error":
            emit_job_event(job_id, event)   # forward lỗi lên SSE

        case "word_partial":
            emit_job_event(job_id, {
                "type": "word_partial",
                "word": event["word"],
                "frame_ts": event["frame_ts"],
            })

        case _ if event.get("skipped"):
            chunk_count += 1               # đoạn im lặng, bỏ qua

        case _:
            # Segment hoàn chỉnh
            english_words.extend(event["english_words"])
            vietnamese_words.extend(event["vietnamese_words"])
            chunk_count += 1
            progress = min(90, 10 + chunk_count * 5)

            update_job(job_id, status=TRANSCRIBING, progress=progress,
                       english_words=english_words, ...)

            emit_job_event(job_id, {
                "type": "segment",
                "index": chunk_count,
                "progress": progress,
                "english_words": event["english_words"],
                "vietnamese_words": event["vietnamese_words"],
            })

# Sau khi stream kết thúc: generate SRT + upload Supabase Storage
en_srt = words_to_srt_string(english_words)
vi_srt = words_to_srt_string(vietnamese_words)
save_srt(en_srt, f"outputs/{job_id}_en.srt")
save_srt(vi_srt, f"outputs/{job_id}_vi.srt")
upload_file(en_srt_path, f"{user_id}/{job_id}/en.srt")   # Supabase Storage bucket subtitle-file
upload_file(vi_srt_path, f"{user_id}/{job_id}/vi.srt")
update_job(job_id, status=DONE, progress=100,
           en_srt_storage_path=..., vi_srt_storage_path=...)
emit_job_event(job_id, {"type": "done", "progress": 100})
```

---

#### 3.3.4 SSE Endpoint — Controller

**Vị trí:** `controllers/subtitle_controller.py`

**Route:** `GET /api/jobs/<job_id>/stream`  
**Response headers:** `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`

```python
@stream_with_context
def generate():
    q = get_job_event_queue(job_id)

    # 1. Initial snapshot (trạng thái hiện tại của job)
    snapshot = get_job(job_id)
    yield _event({"type": "snapshot", "status": ..., "english_words": ..., ...})

    if snapshot.status in (DONE, ERROR): return

    # 2. Event loop
    while True:
        try:
            payload = q.get(timeout=20)      # block tối đa 20s
        except queue.Empty:
            current = get_job(job_id)
            if current.status == DONE:
                yield _event({"type": "done", "progress": 100})
                return
            yield ": keepalive\n\n"           # SSE comment, giữ connection
            continue

        yield _event(payload)               # "data: {...}\n\n"
        if payload["type"] in ("done", "error"):
            return
```

**SSE event format (wire format):**
```
data: {"type":"snapshot","status":"queued","progress":0,"english_words":[]}\n\n
data: {"type":"segment","index":1,"progress":15,"english_words":[...]}\n\n
data: {"type":"word_partial","word":"hel","frame_ts":0.48}\n\n
: keepalive\n\n
data: {"type":"done","progress":100}\n\n
```

**Tất cả event types:**

| Type | Mô tả | Khi nào |
|------|-------|---------|
| `snapshot` | Trạng thái ban đầu của job | Ngay khi frontend connect |
| `segment` | Segment hoàn chỉnh (EN + VI words) | Sau mỗi WebSocket response từ Colab |
| `word_partial` | Preview từ đang nhận dạng (chưa xong) | Kyutai streaming trả về từng ký tự |
| `segment_error` | Segment lỗi (kèm time_range) | Khi Colab gặp lỗi với đoạn audio cụ thể |
| `done` | Pipeline hoàn tất | Sau khi stream() kết thúc |
| `error` | Lỗi nghiêm trọng | Exception trong run_pipeline_realtime |
| `keepalive` | SSE comment, không có data | Mỗi 20s khi queue trống |

---

#### 3.3.5 Frontend SSE Client — `openRealtimeStream()`

**Vị trí:** `src/lib/api.ts`

```typescript
export async function openRealtimeStream(
  jobId: string,
  handlers: {
    onEvent: (evt: RealtimeStreamEvent) => void;
    onError?: (err: Event) => void;
  }
): Promise<EventSource>
```

**Cơ chế:**
```typescript
// Auth token vào query string (EventSource không hỗ trợ custom headers)
const url = `${BASE}/jobs/${jobId}/stream?token=${encodeURIComponent(token)}`;
const stream = new EventSource(url);

stream.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    handlers.onEvent(payload);
    if (payload.type === "done" || payload.type === "error") {
        stream.close();   // đóng connection
    }
};
stream.onerror = handlers.onError;
```

**TypeScript event types:**
```typescript
type RealtimeStreamEvent =
  | { type: "snapshot"; status: JobStatus; progress: number;
      english_words: Word[]; vietnamese_words: Word[] }
  | { type: "segment"; index: number; total: number; progress: number;
      english_words: Word[]; vietnamese_words: Word[] }
  | { type: "word_partial"; word: string; frame_ts: number }
  | { type: "segment_error"; time_range: [number, number]; message: string }
  | { type: "done"; progress: 100 }
  | { type: "error"; message: string }
```

---

#### 3.3.6 EditorPage — State Management & Rendering

**Vị trí:** `src/app/pages/EditorPage.tsx`

**State variables:**

```typescript
// Accumulated words (grows with each segment event)
const [englishWords, setEnglishWords] = useState<Word[]>([]);
const [vietnameseWords, setVietnameseWords] = useState<Word[]>([]);

// Live preview buffer (partial words)
const [inProgressWords, setInProgressWords] = useState<string[]>([]);
const [latestRealtimeSegment, setLatestRealtimeSegment] = useState<
  { en: string; vi: string } | null
>(null);

// Stream lifecycle
const [streamStatus, setStreamStatus] = useState<"idle"|"streaming"|"done"|"error">("idle");
const [streamProgress, setStreamProgress] = useState(0);
const streamStartedRef = useRef(false);  // guard: chỉ subscribe 1 lần
```

**Event handler logic:**

```typescript
onEvent: (evt) => {
  switch (evt.type) {

    case "word_partial":
      setInProgressWords(prev => [...prev, evt.word].slice(-12));
      // Giữ tối đa 12 từ cuối (~3s buffer @ 4 words/sec)
      break;

    case "segment":
      // Loại bỏ partial words của segment vừa hoàn thành
      setInProgressWords(prev => prev.slice(evt.english_words.length));

      // Lưu segment text để hiển thị khi không có partial words
      const enText = evt.english_words.map(w => w.word).join(" ");
      const viText = evt.vietnamese_words.map(w => w.word).join(" ");
      setLatestRealtimeSegment({ en: enText, vi: viText });

      // Tích lũy words → trigger subtitle re-render
      setEnglishWords(prev => [...prev, ...evt.english_words]);
      setVietnameseWords(prev => [...prev, ...evt.vietnamese_words]);
      setStreamProgress(evt.progress);
      break;

    case "segment_error":
      // Thêm placeholder "[...]" vào timeline
      const [start, end] = evt.time_range;
      setEnglishWords(prev => [...prev, { word: "[...]", start, end }]);
      setVietnameseWords(prev => [...prev, { word: "[...]", start, end }]);
      break;

    case "done":
      setStreamStatus("done");
      setStreamProgress(100);
      break;

    case "error":
      setStreamStatus("error");
      setStreamError(evt.message);
      break;
  }
}
```

**Subtitle display logic (live vs. time-based):**

Realtime pipeline xử lý nhanh hơn realtime (~2-3x), nên khi video phát ở giây 9
thì pipeline đã nhận dạng tới giây 27. Overlay chỉ hiển thị segment-mới-nhất khi
playhead **bám mép live**; khi user tua/scrub về quá khứ → chuyển sang time-based
lookup để subtitle khớp đúng vị trí video.

```typescript
// lastStreamedEnd = end time của từ cuối cùng đã nhận
const atLiveEdge = currentTime >= lastStreamedEnd - 1.0;
const isLiveStreaming =
  isRealtimeMode && streamStatus === "streaming" && isPlaying
  && !isScrubbing && atLiveEdge;

// Live mode: ưu tiên partial words, fallback về segment cuối
const textEnLive = isLiveStreaming
  ? (inProgressWords.length > 0
      ? inProgressWords.join(" ")           // đang nhận dạng
      : (latestRealtimeSegment?.en ?? ""))  // segment vừa xong
  : textEn;  // time-based: lookup theo currentTime

const textViLive = isLiveStreaming ? (latestRealtimeSegment?.vi ?? "") : textVi;

// Overlay wrap: mỗi dòng ≤ 42 ký tự, tối đa 2 dòng (wrapToTwoLines)
// chỉ realtime → sentence mode (progressive bị ẩn ở realtime)
```

**Auto-clear partial words (3s timeout):**
```typescript
useEffect(() => {
  if (inProgressWords.length === 0) return;
  const timer = setTimeout(() => setInProgressWords([]), 3000);
  return () => clearTimeout(timer);
}, [inProgressWords]);
```

**Subtitle overlay rendering:**
```typescript
<motion.div
  initial={{ opacity: 0, y: subtitlePosition === "bottom" ? 8 : -8 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.18, ease: "easeOut" }}
  style={{
    left: `${subtitleAnchor.x}%`,    // draggable position
    top: `${subtitleAnchor.y}%`,
    transform: "translate(-50%, -50%)",
  }}
>
  {subtitleLines.map((line, idx) => (
    <span key={idx} style={{
      color: fontColor,
      backgroundColor: `${bgColor}${Math.round(bgOpacity * 2.55).toString(16)}`,
      fontFamily: selectedFont,
      fontSize: ...,
    }}>
      {line}
    </span>
  ))}
</motion.div>
```

---

#### 3.3.7 UploadPage — Warmup UX

**Vị trí:** `src/app/pages/UploadPage.tsx`

Sau khi upload xong ở realtime mode, app **không chờ** xử lý hoàn tất mà redirect ngay vào Editor. Tuy nhiên cần 2.5s warmup để Colab có thời gian kết nối WebSocket:

```typescript
if (processMode === "realtime") {
  // Lưu job state ban đầu vào sessionStorage
  sessionStorage.setItem("currentJob", JSON.stringify({
    job_id: jobId,
    status: "queued",
    progress: 0,
    english_words: [],
    vietnamese_words: [],
  }));

  // Warmup delay: cho Colab model khởi động
  setState("realtime_warming");
  await new Promise(resolve => setTimeout(resolve, 2500));

  navigate(`/editor?mode=realtime&job_id=${jobId}`);
}
```

**Warmup UI:** pulsing rings + 3 animated steps: "Connect" → "Warm up" → "Ready"

---

### 3.4 Timing & Latency Analysis

```
FFmpeg decode → frame throttle → base64 encode → JSON stringify
    ~1ms           ~80ms            ~0.5ms          ~0.5ms
                                                        │
                                                        ▼ WebSocket send
                                                   Network: 50-200ms
                                                        │
                                                   Colab Kyutai inference
                                                   ~100ms/frame
                                                        │
                                                   WebSocket response
                                                   Network: 50-200ms
                                                        │
                                                   result_queue.put()
                                                   ~0.1ms
                                                        │
                                                   SSE yield → browser
                                                   ~50-200ms
                                                        │
                                                   React state update
                                                   ~20ms
                                                        │
                                                   DOM render + CSS anim
                                                   ~180ms (transition)
                                                        │
                                                   ▼
                                         Total: ~500-900ms end-to-end
```

**Partial words (word_partial):** ~200ms latency (Kyutai streaming character-by-character)  
**Segment complete:** ~500ms latency sau khi từ cuối trong segment được nhận dạng  
**Warmup time (lần đầu):** 2.5s (frontend delay) + Colab cold start  

---

### 3.5 Error Handling & Resilience

| Layer | Cơ chế | Chi tiết |
|-------|--------|---------|
| FFmpeg | Exception catch | Cleanup process, emit error event |
| WebSocket sender | asyncio exception | Retry loop (2s, 5s, 10s delays) |
| WebSocket receiver | Parse errors | Silent skip, không crash connection |
| RealtimeStreamClient | MAX_RETRIES=3 | Sau 3 lần → RuntimeError → job status=error |
| SSE generator | queue.Empty timeout 20s | Emit keepalive, poll job status |
| EventSource (browser) | onerror callback | setStreamStatus("error") |
| Partial words | 3s auto-clear timeout | Tự xoá nếu không nhận segment tiếp theo |
| segment_error | Placeholder "[...]" | Giữ timeline liên tục, không crash UI |

---

## 4. Thuật toán phụ đề

Đây là phần cốt lõi của hệ thống. Có **2 tầng thuật toán**:

### 4.1 Tầng 1: Greedy Word Chunking (`words_to_srt_string`)

**Vị trí:** `models/subtitle_model.py`

Chuyển đổi danh sách từ có timestamp thành các khối SRT.

**Nguyên lý hoạt động:**

```
Input:  [{"word": "Hello", "start": 0.0, "end": 0.4},
         {"word": "world", "start": 0.5, "end": 0.9},
         {"word": "this",  "start": 1.0, "end": 1.2},
         ...]

Thuật toán Greedy (max_chars = 42):
- Tích lũy từ vào block hiện tại
- Khi tổng ký tự + từ tiếp theo > 42 → đóng block
  - start = từ đầu tiên trong block
  - end   = start của từ tiếp theo (tránh gap)
- Mở block mới bắt đầu bằng từ vừa gây overflow

Output: SRT blocks
    1
    00:00:00,000 --> 00:00:00,900
    Hello world

    2
    00:00:01,000 --> ...
    this is...
```

**Tham số chính:**
- `max_chars = 42` — giới hạn ký tự mỗi block (chuẩn EN)
- Block end = start của từ tiếp theo (ngăn overlap)
- Block cuối = end của từ cuối cùng

### 4.2 Tầng 2: Subtitle Optimizer — 4-Pass Convergence Loop

**Vị trí:** `models/subtitle_optimizer.py`

Đây là thuật toán chính để đảm bảo phụ đề đạt **chuẩn Netflix/Broadcast**. Chạy tối đa **3 vòng lặp hội tụ** (convergence loop) với 4 bước theo thứ tự cố định.

**Chuẩn được áp dụng:**

| Quy tắc | Giá trị | Lý do |
|---------|---------|-------|
| `MAX_CPS` | 17.0 ký tự/giây | Tốc độ đọc tối đa |
| `MAX_CPL_VI` | 47 ký tự/dòng | Tiếng Việt (có dấu) rộng hơn EN |
| `MAX_CPL_EN` | 42 ký tự/dòng | Chuẩn Netflix EN |
| `MAX_LINES` | 2 dòng | Không che quá nhiều video |
| `MIN_DURATION` | 1.0s | Thời gian hiển thị tối thiểu |
| `MAX_DURATION` | 7.0s | Không giữ quá lâu trên màn hình |
| `MIN_GAP` | 0.083s | ~2 frames @ 24fps, ngăn flash |

#### Vòng lặp chính:

```python
def optimize_subtitles(blocks):
    for iteration in range(3):
        blocks, d_changed = fix_duration(blocks)  # Bước 1
        blocks, c_changed = fix_cpl(blocks)       # Bước 2
        blocks, s_changed = fix_cps(blocks)       # Bước 3
        blocks = fix_gap(blocks)                   # Bước 4 (luôn chạy)

        if not (d_changed or c_changed or s_changed):
            break  # Hội tụ — dừng sớm
```

**Tại sao thứ tự này?**
1. Duration trước: quyết định số lượng block (split tạo ra block mới)
2. CPL trước CPS: line wrapping độc lập với duration; CPS phụ thuộc vào số dòng cuối
3. CPS sau: có thể extend hoặc split thêm block
4. Gap cuối: là quan hệ giữa hai block, chỉ có nghĩa sau khi timing đã ổn định

---

#### Bước 1: `fix_duration()` — Cắt block > 7s, kéo dài block < 1s

```
Nếu duration > 7s:
    split_block() đệ quy tại điểm phân chia tốt nhất:
        Ưu tiên: dấu câu (. ? ! ; , —) gần midpoint
        Fallback: khoảng trắng gần midpoint
        Phân bổ thời gian theo tỷ lệ ký tự:
            ratio = len(part1) / len(total)
            part1.end = start + duration * ratio

Nếu duration < 1s:
    Kéo dài end = start + 1s
    Nếu đè lên block tiếp theo → merge hai block
```

#### Bước 2: `fix_cpl()` — Wrap text, tối đa 47 ký tự/dòng, 2 dòng

```
Nếu text ≤ 47 ký tự: giữ nguyên

Nếu text cần 1-2 dòng:
    _find_balanced_split() — chiến lược "top-heavy":
        Dòng 1 >= Dòng 2 (dòng trên dài hơn hoặc bằng)
        Lý do: phụ đề hiện ở đáy màn hình,
               dòng dưới ngắn hơn che ít video hơn

Nếu text cần > 2 dòng:
    split_block() — chia block, phân bổ thời gian theo tỷ lệ ký tự
```

**`wrap_text()` — Greedy word-wrap với balanced 2-line:**

```
Bước 1: Thử _find_balanced_split()
        → Tìm điểm chia để |len(line1) - len(line2)| nhỏ nhất
        → Duyệt từng vị trí từ i=2 đến n-2
        → Chọn điểm có score thấp nhất (cân bằng nhất)

Bước 2: Fallback greedy wrap
        → Tích lũy từ cho đến khi vượt max_cpl
        → Xuống dòng
```

#### Bước 3: `fix_cps()` — Đảm bảo tốc độ đọc ≤ 17 ký tự/giây

```
CPS = len(text.replace('\n', '')) / duration

Nếu CPS > 17.0:
    Chiến lược A (ưu tiên): Kéo dài duration
        needed_duration = char_count / 17.0
        max_end = next_block.start - MIN_GAP (0.083s)
        Nếu target_end ≤ max_end và needed_duration ≤ 7s:
            → Kéo dài block.end

    Chiến lược B (fallback): Split block
        → Chia tại midpoint theo ký tự
        → Phân bổ thời gian theo tỷ lệ

    Dead-lock guard:
        Nếu split tạo ra block < 1s → chấp nhận vi phạm CPS
        (log warning, không có giải pháp tốt hơn)
```

#### Bước 4: `fix_gap()` — Đảm bảo khoảng cách tối thiểu 83ms

```
Với mỗi cặp block liên tiếp:
    gap = curr.start - prev.end

    Nếu gap < 83ms:
        new_prev_end = curr.start - 83ms

        Nếu (new_prev_end - prev.start) ≥ 1s:
            → Thu hẹp prev.end (có thể tăng CPS, vòng sau sẽ fix)

        Nếu không:
            → Merge hai block thành một
            → Inline CPL fix (wrap_text)
```

### 4.3 Frontend Line Breaking & CPS/CPL Guard

**Vị trí:** `src/app/pages/EditorPage.tsx` + `src/lib/api.ts`

Frontend áp ràng buộc CPL/CPS riêng để hiển thị phụ đề (đặc biệt VI sau dịch dễ vượt chuẩn):

```
getBalancedBreakIndex(words):  — điểm xuống dòng cho overlay
    Bỏ qua break sai ngữ pháp (Articles/Auxiliaries/Prepositions)
    Ưu tiên điểm chia giữ CẢ 2 DÒNG ≤ 42 ký tự; trong đó chọn cân bằng nhất

wrapToTwoLines(text, 42):  — wrap chuỗi overlay live thành tối đa 2 dòng ≤42 ký tự
    Áp dụng cho cả textEnLive và textViLive trước khi render overlay

wordsToSubtitles(words, 42)  [api.ts]:  — list subtitle bên phải + SRT
    Bước 1: gom từ thành block ≤ 42 ký tự
    Bước 2: CPS guard — kéo dài duration block quá ngắn để CPS ≤ 17,
            không lấn block kế (sửa lỗi CPS=1000+ do timestamp sát nhau)
```

---

## 5. Model AI & Cách Pull Model

### 5.1 Silero VAD (Voice Activity Detection)

**Pull method:** `torch.hub.load()` — tự động tải khi khởi động app

```python
# app.py — gọi 1 lần lúc startup
def load_vad() -> bool:
    _vad_model, _vad_utils = torch.hub.load(
        repo_or_dir="snakers4/silero-vad",
        model="silero_vad",
        force_reload=False,   # dùng cache nếu đã có
    )
```

**Cache location:** `~/.cache/torch/hub/snakers4_silero-vad_master/`

**Đặc điểm:**
- Download tự động lần đầu chạy (~5MB)
- Non-blocking startup: nếu VAD load thất bại, app vẫn chạy (controller check `is_vad_ready()`)
- Sample rate: 16,000 Hz
- Sliding window: 512 samples (~32ms per window)

### 5.2 Whisper ASR (English Transcription)

**Pull method:** Chạy trên **Google Colab** — không cần pull local

Colab VM load Whisper khi khởi động:
```python
# Trong Colab notebook (không thuộc repo này)
import whisper
model = whisper.load_model("large-v3")  # hoặc "medium", "base"
```

**Kết nối từ backend:** HTTP POST qua ngrok tunnel

```python
class ColabClient:
    def transcribe_translate(self, segments_data, ...):
        # Gửi audio base64 PCM đến Colab
        resp = requests.post(
            f"{COLAB_URL}/transcribe_translate",
            json={
                "segments": [
                    {
                        "audio_base64": "<base64-encoded-float32-pcm>",
                        "start_offset": 1.2,
                        "end_offset": 5.3
                    }
                ],
                "translation_mode": "segment",  # hoặc "sentence"
                "source_lang": "en"
            },
            timeout=600  # 10 phút patience
        )
```

**Retry logic:** 3 lần với exponential backoff (5s, 10s, 15s)

### 5.3 VinAI Translation Model (EN→VI)

**Pull method:** Chạy trên **Google Colab** — tích hợp cùng endpoint với Whisper

Colab load VinAI khi khởi động:
```python
# Trong Colab notebook
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM
tokenizer = AutoTokenizer.from_pretrained("vinai/vinai-translate-en2vi-v2")
model = AutoModelForSeq2SeqLM.from_pretrained("vinai/vinai-translate-en2vi-v2")
```

**Response format:**
```json
{
  "english_words":    [{"word": "Hello", "start": 1.2, "end": 1.5}, ...],
  "vietnamese_words": [{"word": "Xin",   "start": 1.2, "end": 1.4}, ...],
  "english_text":     "Hello world",
  "vietnamese_text":  "Xin chào thế giới"
}
```

### 5.4 Kyutai (English Realtime Streaming)

**Pull method:** Chạy trên **Google Colab** — endpoint riêng cho realtime

```python
# Trong Colab notebook
# Kyutai là model ASR streaming, kết nối qua WebSocket
```

**Kết nối từ backend:** WebSocket qua `COLAB_REALTIME_URL`

```python
class RealtimeStreamClient:
    ws_url = f"{COLAB_REALTIME_URL}/ws/transcribe_kyutai"

    # Gửi PCM frames realtime:
    await ws.send(json.dumps({
        "pcm_base64": frame["pcm_base64"],
        "frame_index": frame["frame_index"],
    }))
```

**Tham số:**
- Sample rate: **24,000 Hz** (yêu cầu của Kyutai)
- Frame duration: **80ms** (1920 samples)

### 5.5 Silero VAD + PhoWhisper (Vietnamese Realtime)

**Pull method:** Chạy trên **Google Colab** — endpoint riêng

**Tham số:**
- Sample rate: **16,000 Hz**
- Frame duration: **32ms** (512 samples)
- WebSocket path: `/ws/transcribe_vi_realtime`

### 5.6 Tóm tắt cách pull model

| Model | Pull method | Location | Kích thước | Trigger |
|-------|-------------|----------|------------|---------|
| Silero VAD | `torch.hub.load()` | Local cache | ~5MB | App startup |
| Whisper | `whisper.load_model()` | Google Colab | 1.5-3GB | Colab startup |
| VinAI EN→VI | `transformers` HuggingFace | Google Colab | ~2GB | Colab startup |
| Kyutai | Colab load | Google Colab | TBD | Colab startup |

---

## 6. Pipeline xử lý âm thanh

### 6.1 Audio Extraction (FFmpeg)

```python
# Normal mode: extract toàn bộ audio
ffmpeg -i input.mp4 \
  -acodec pcm_s16le \  # 16-bit signed PCM
  -ac 1 \              # mono
  -ar 16000 \          # 16 kHz
  output.wav

# Realtime mode: stream PCM frames trực tiếp từ FFmpeg stdout (không cắt chunk file)
# AudioStreamProducer đọc raw float32 PCM, throttle theo realtime, gửi từng frame qua WebSocket
ffmpeg -i input.mp4 -vn -ar 24000 -ac 1 -f f32le pipe:1   # EN (Kyutai): 24kHz, 80ms/frame
ffmpeg -i input.mp4 -vn -ar 16000 -ac 1 -f f32le pipe:1   # VI: 16kHz, 32ms/frame
```

### 6.2 VAD Segmentation

```
Input: WAV 16kHz mono
           │
           ▼
Silero VAD sliding window (512 samples ≈ 32ms)
    threshold = 0.5 (confidence)
    min_speech = 250ms (bỏ qua noise ngắn)
    min_silence = 500ms (tách segment mới sau 500ms im lặng)
    speech_pad = ±100ms (mở rộng boundary)
           │
           ▼
Output: [{"start": 0.5, "end": 4.2},
         {"start": 5.1, "end": 12.3}, ...]
```

### 6.3 Segment Processing

```
merge_short_segments(min_duration=2.0s):
    Gộp các segment ngắn liền kề để đủ 2s
    → Tránh gửi quá nhiều request nhỏ đến Colab

split_long_segment(max_duration=25.0s):
    Chia segment dài > 25s thành chunks đều nhau
    → Tránh Whisper timeout (~300s cho 10-phút audio)
    → Số chunks = ceil(duration / 25)
    → Thời gian chia đều
```

---

## 7. Pipeline dịch thuật

### 7.1 Translation Modes

| Mode | Cách hoạt động | Ưu điểm | Nhược điểm |
|------|---------------|---------|------------|
| `segment` | Dịch cả segment như một đơn vị | Ngữ cảnh tốt hơn | Segment dài khó align timing |
| `sentence` | Chia segment thành câu, dịch từng câu | Granular hơn | Có thể mất ngữ cảnh liên câu |

### 7.2 Luồng dịch thuật

```
1. Whisper/PhoWhisper ASR → word-level timestamps
2. Gộp từ thành text theo segment (gửi Colab theo batch 15 segments)
3. VinAI model dịch EN → VI
4. Word-level timestamps VI được align lại
5. words_to_srt_string() tạo VI SRT riêng (có CPS guard ở frontend)
6. Upload SRT lên Supabase Storage
7. (Premium) subtitle_optimizer.py optimize VI SRT (MAX_CPL=47)
```

---

## 8. Kiến trúc Frontend

### 8.1 Tech Stack

| Thành phần | Công nghệ |
|------------|----------|
| Framework | React 18.3 + React Router 7 |
| Styling | Tailwind CSS 4.1 + Motion animations |
| Components | Radix UI (accessible, unstyled) |
| Forms | React Hook Form |
| State | React Context (Auth, UI Preferences) |
| HTTP | Fetch API + XHR (trong `src/lib/api.ts`) |
| Auth | Supabase Auth + JWT |
| Build | Vite |

### 8.2 Page Structure

```
src/app/pages/
├── LandingPage.tsx          ← Marketing homepage
├── UploadPage.tsx           ← Upload video, theo dõi tiến trình
├── EditorPage.tsx           ← Subtitle editor, preview, export
│     └── getBalancedBreakIndex()  ← Thuật toán line-break frontend
├── SignInPage.tsx           ← Đăng nhập (email/mật khẩu + Google)
├── SignUpPage.tsx           ← Đăng ký (Magic Link, có xác nhận mật khẩu)
├── ForgotPasswordPage.tsx   ← Quên mật khẩu (OTP 6 số)
├── AuthCallbackPage.tsx     ← Xử lý callback Magic Link / OAuth → /auth/callback
├── ResetPasswordPage.tsx    ← Đặt lại mật khẩu (recovery)
├── ProfilePage.tsx          ← Thông tin tài khoản: đổi tên / đổi MK / xóa TK
├── UpgradePage.tsx          ← Thông tin gói Premium (99.000đ/năm)
└── UpgradeSuccessPage.tsx   ← Xác nhận thanh toán (poll /auth/me)
```

### 8.3 API Service Layer (`src/lib/api.ts`)

| Hàm | Mô tả |
|-----|-------|
| `uploadVideo(file, processMode, translationMode, onProgress?, sourceLang)` | XHR upload với progress tracking |
| `getJobStatus(jobId)` | Poll trạng thái job (rate-limit exempt) |
| `pollUntilDone(jobId, onUpdate, intervalMs?)` | Poll đến khi job xong; gọi `onUpdate` mỗi lần poll |
| `openRealtimeStream(jobId, handlers)` | SSE stream cho realtime mode (EventSource + token query) |
| `wordsToSubtitles(words, maxChars?)` | Chuyển word array → subtitle items (CPS guard ≤17) |
| `getSrtUrl(jobId, lang)` | Lấy signed URL tải SRT từ Supabase Storage |
| `downloadSrt(jobId, lang)` | Tải file SRT trực tiếp về máy |
| `getVideoUrl(videoFilename)` | Signed URL video gốc cho Editor |
| `exportVideo(jobId, resolution, lang)` | Burn subtitles vào video (async) |
| `getExportStatus(exportId)` / `pollExportUntilDone(exportId, onUpdate?)` | Poll trạng thái export video |
| `getAuthHeader()` / `authFetch(path, init?)` | Helper gắn JWT cho request backend |
| `updateProfile(fullName)` / `changePassword(newPassword)` / `deleteAccount()` | Quản lý tài khoản |

---

## 9. Hệ thống cấu hình

### 9.1 Biến môi trường

**Backend (Flask):**

| Biến | Bắt buộc | Mô tả |
|------|---------|-------|
| `COLAB_URL` | Có | URL ngrok của Colab VM chính (Whisper + VinAI). App raise nếu là placeholder/không https |
| `COLAB_REALTIME_URL` | Không | URL ngrok cho realtime (fallback về `COLAB_URL`) |
| `SECRET_KEY` | Prod | Flask session secret (raise nếu thiếu khi không debug; dev mặc định `dev-secret-change-in-prod`) |
| `SUPABASE_URL` | Có | URL Supabase project |
| `SUPABASE_SERVICE_ROLE_KEY` | Có | Supabase admin key (service role, bypass RLS) |
| `SUPABASE_JWT_SECRET` | Không* | JWT HS256 secret — chỉ dùng ở nhánh fallback (chính: `supabase.auth.get_user`) |
| `FLASK_DEBUG` | Không | Debug mode (default: `false`) |
| `PORT` | Không | Flask listen port (default: `5000`) |
| `FRONTEND_URL` | Không | CORS origin (default: `http://localhost:5173`) |
| `MOMO_PARTNER_CODE` / `MOMO_ACCESS_KEY` / `MOMO_SECRET_KEY` | Thanh toán | Thông tin MoMo; thiếu → `/payment/create-order` trả 503 |
| `MOMO_ENDPOINT` | Không | MoMo create endpoint (default: sandbox `test-payment.momo.vn`) |
| `NGROK_URL` | Thanh toán | Base URL công khai cho MoMo IPN (`{NGROK_URL}/api/payment/ipn`) |
| `OPENAI_API_KEY` | Không | Bắt buộc cho `/jobs/<id>/translation-quality` (LLM-as-judge) |
| `REDIS_URL` | Không | Backend cho Flask-Limiter (default: `memory://`, per-process) |

**Frontend (Vite — đặt ở `.env.local`):**

| Biến | Bắt buộc | Mô tả |
|------|---------|-------|
| `VITE_API_URL` | Có | URL backend API (vd `http://localhost:5000/api`) |
| `VITE_SUPABASE_URL` | Có | URL Supabase project |
| `VITE_SUPABASE_ANON_KEY` | Có | Supabase anon key (client) |

\* `SUPABASE_JWT_SECRET` được liệt kê trong `.env.example` nhưng code chỉ dùng nó ở nhánh xác thực dự phòng (HS256). Luồng chính dùng `supabase.auth.get_user(token)`.

### 9.2 Upload limits

```python
MAX_CONTENT_LENGTH = 2 * 1024 * 1024 * 1024  # 2GB
Colab timeout = 600s (10 phút)
```

---

## 10. API Endpoints

**Blueprint prefixes:** `subtitle_bp` → `/api`, `auth_bp` → `/api/auth`, `payment_bp` → `/api/payment`.

### Subtitle & video (`/api`)

| Method | URL | Mô tả | Auth | Rate limit |
|--------|-----|-------|------|-----------|
| GET | `/api/health` | Server health + Colab status | - | - |
| POST | `/api/upload` | Upload video, tạo job | Required | 5/phút |
| GET | `/api/jobs/<id>` | Poll job status | Required | exempt |
| GET | `/api/jobs/<id>/stream` | SSE realtime stream | Required | - |
| GET | `/api/jobs/<id>/srt-url?lang=en\|vi` | Signed URL tải SRT từ Supabase Storage (TTL 3600s) | Required | - |
| GET | `/api/video/<filename>` | Signed URL video gốc (cho Editor playback) | Required | - |
| POST | `/api/export` | Burn subtitles vào video (async, trả 202) | Required | 10/phút |
| GET | `/api/export-status/<export_id>` | Poll trạng thái export | Required | - |
| GET | `/api/exports/<filename>` | Tải video đã gắn phụ đề (download_url từ export-status) | Required | - |
| POST | `/api/jobs/<id>/optimize` | Optimize VI subtitles | Premium | - |
| GET | `/api/jobs/<id>/report?lang=en\|vi&srt=original\|optimized` | Quality report (CPS/CPL/gap/repetition) | Required | - |
| GET | `/api/jobs/<id>/translation-quality` | LLM-as-judge đánh giá bản dịch | Required | 10/phút |

### Account (`/api/auth`)

| Method | URL | Mô tả | Auth | Rate limit |
|--------|-----|-------|------|-----------|
| GET | `/api/auth/me` | Lấy profile người dùng hiện tại | Required | 60/phút |
| PATCH | `/api/auth/profile` | Cập nhật họ tên | Required | 30/phút |
| POST | `/api/auth/change-password` | Đổi mật khẩu | Required | 10/phút |
| DELETE | `/api/auth/account` | Xóa tài khoản | Required | 5/giờ |
| POST | `/api/auth/sse-token` | Cấp token ngắn hạn cho EventSource | Required | 30/phút |

> Đăng ký / đăng nhập **không có route backend** — xử lý phía client bằng Supabase Auth (`signUp`, `signInWithPassword`, OAuth).

### Payment (`/api/payment`)

| Method | URL | Mô tả | Auth | Rate limit |
|--------|-----|-------|------|-----------|
| POST | `/api/payment/create-order` | Tạo đơn MoMo, trả `payment_url` | Required | 3/phút |
| POST | `/api/payment/ipn` | MoMo IPN callback (server-to-server) | - | - |

### Upload Request

```
POST /api/upload
Content-Type: multipart/form-data

file             : video file (mp4/mov/mkv/avi/webm)
process_mode     : "normal" | "realtime"
translation_mode : "segment" | "sentence"
source_lang      : "en" | "vi"
```

### Job Status Response

```json
{
  "job_id":   "uuid",
  "status":   "queued | extracting | vad | transcribing | generating | done | error",
  "progress": 0,
  "error":    null,

  // Chỉ khi status == "done":
  "english_words":    [{"word": "Hello", "start": 1.2, "end": 1.8}],
  "vietnamese_words": [{"word": "Xin",   "start": 1.2, "end": 1.5}],
  "english_text":     "Hello world...",
  "vietnamese_text":  "Xin chào thế giới..."
}
```

---

## 11. Thanh toán & Tính năng Premium

**Provider:** MoMo (thanh toán Việt Nam)

| Tính năng | Free | Premium |
|-----------|------|---------|
| Upload video | 5 video/tháng | Không giới hạn |
| Normal mode | Có | Có |
| Realtime mode | Không | Có |
| Subtitle optimizer | Không | Có |

**Premium gate:**
```python
@require_premium  # Kiểm tra profile.premium_until > now()
def optimize_subtitles():
    ...
```

---

## 12. Cài đặt & Chạy

### Backend

```bash
# Cài dependencies
pip install -r requirements.txt

# Cấu hình môi trường
cp .env.example .env
# Chỉnh sửa .env với COLAB_URL, SUPABASE_* keys

# Khởi động server (tự động load Silero VAD)
python app.py
# Server chạy tại http://localhost:5000
```

### Frontend (Development)

```bash
npm install
cp .env.example .env.local
# VITE_API_URL=http://localhost:5000/api

npm run dev
# http://localhost:5173
```

### Production Build

```bash
# Build React
npm run build       # → dist/

# Copy vào Flask static
cp -r dist/* views/static/

# Chạy Flask (serve cả frontend + API)
python app.py
```

---

## Metrics & Benchmarks

| Metric | Giá trị | Ghi chú |
|--------|---------|---------|
| Max upload size | 2 GB | Flask limit |
| Normal batch size | 15 segments/request | Tránh Colab OOM video dài |
| Realtime frame (EN/VI) | 80ms @ 24kHz / 32ms @ 16kHz | Kyutai / PhoWhisper |
| Realtime latency | 1-2 giây | Frame-based WS streaming |
| VAD latency | ~50ms/1s audio | CPU-bound |
| Colab timeout | 600 giây | 10-phút patience |
| Subtitle optimizer | < 100ms | 3-iteration convergence |
| Min gap giữa subtitles | 83ms | ~2 frames @ 24fps |
| Max CPS | 17.0 | Netflix/Broadcast standard |
| Max CPL (VI) | 47 ký tự | Vietnamese với dấu |
| Max CPL (EN) | 42 ký tự | Netflix EN standard |
| Free tier | 5 video/tháng | Supabase billing |

---

## 13. Quality Report — Đo chỉ số phụ đề

**Module:** [models/subtitle_quality.py](models/subtitle_quality.py)  
**Endpoint:** `GET /api/jobs/<job_id>/report`

Phân tích SRT file và trả về báo cáo đầy đủ: CPS, CPL, gap violations, và ASR heuristic errors (Whisper hallucination detection). Không cần Premium, không sửa file gốc.

### 13.1 Các chỉ số được đo

| Chỉ số | Ngưỡng vi phạm | Mô tả |
|--------|---------------|-------|
| CPS (Characters/sec) | > 17.0 | Block phụ đề đọc quá nhanh |
| CPL — Vietnamese | > 47 ký tự/dòng | Dòng quá dài (tiếng Việt có dấu) |
| CPL — English | > 42 ký tự/dòng | Dòng quá dài (chuẩn Netflix EN) |
| Duration ngắn | < 1.0s | Hiển thị quá nhanh, mắt không kịp đọc |
| Duration dài | > 7.0s | Giữ quá lâu trên màn hình |
| Gap giữa 2 block | < 83ms (~2 frames @24fps) | Flash transition |
| Repetition (ASR) | ≥ 3 lần lặp liên tiếp | Dấu hiệu Whisper hallucination |

### 13.2 Gọi qua API (curl)

#### Bước 1 — Lấy auth token

```powershell
# PowerShell
$response = curl -s -X POST "https://<SUPABASE_URL>/auth/v1/token?grant_type=password" `
  -H "apikey: <SUPABASE_ANON_KEY>" `
  -H "Content-Type: application/json" `
  -d '{"email":"your@email.com","password":"yourpassword"}'

$TOKEN = ($response | ConvertFrom-Json).access_token
```

```bash
# bash/zsh
TOKEN=$(curl -s -X POST "https://<SUPABASE_URL>/auth/v1/token?grant_type=password" \
  -H "apikey: <SUPABASE_ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"email":"your@email.com","password":"yourpassword"}' \
  | python -m json.tool | grep access_token | cut -d'"' -f4)
```

#### Bước 2 — Upload video, lấy job_id

```powershell
# PowerShell
$upload = curl -X POST http://localhost:5000/api/upload `
  -H "Authorization: Bearer $TOKEN" `
  -F "file=@C:\path\to\video.mp4" `
  -F "process_mode=normal" `
  -F "source_lang=en" | ConvertFrom-Json

$JOB_ID = $upload.job_id
Write-Host "Job ID: $JOB_ID"
```

```bash
# bash
JOB_ID=$(curl -s -X POST http://localhost:5000/api/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/path/to/video.mp4" \
  -F "process_mode=normal" \
  -F "source_lang=en" \
  | python -c "import sys,json; print(json.load(sys.stdin)['job_id'])")
echo "Job ID: $JOB_ID"
```

#### Bước 3 — Chờ job hoàn tất

```powershell
# PowerShell — poll đến khi done
do {
    $job = curl "http://localhost:5000/api/jobs/$JOB_ID" `
      -H "Authorization: Bearer $TOKEN" | ConvertFrom-Json
    Write-Host "Status: $($job.status) — $($job.progress)%"
    if ($job.status -notin @("done","error")) { Start-Sleep 5 }
} while ($job.status -notin @("done","error"))
```

```bash
# bash
while true; do
  STATUS=$(curl -s "http://localhost:5000/api/jobs/$JOB_ID" \
    -H "Authorization: Bearer $TOKEN" \
    | python -c "import sys,json; d=json.load(sys.stdin); print(d['status'],d['progress'])")
  echo "Status: $STATUS"
  echo "$STATUS" | grep -q "^done\|^error" && break
  sleep 5
done
```

#### Bước 4 — Gọi quality report

```powershell
# PowerShell — báo cáo Vietnamese (mặc định)
curl "http://localhost:5000/api/jobs/$JOB_ID/report?lang=vi" `
  -H "Authorization: Bearer $TOKEN" | python -m json.tool

# Báo cáo English
curl "http://localhost:5000/api/jobs/$JOB_ID/report?lang=en" `
  -H "Authorization: Bearer $TOKEN" | python -m json.tool

# Sau khi đã optimize (Premium): so sánh bản optimized
curl "http://localhost:5000/api/jobs/$JOB_ID/report?lang=vi&srt=optimized" `
  -H "Authorization: Bearer $TOKEN" | python -m json.tool
```

```bash
# bash
curl -s "http://localhost:5000/api/jobs/$JOB_ID/report?lang=vi" \
  -H "Authorization: Bearer $TOKEN" | python -m json.tool
```

### 13.3 Response JSON

```json
{
  "lang": "vi",
  "total_blocks": 120,
  "total_duration": 350.5,

  "violations": {
    "cps": 3,
    "cpl": 7,
    "duration_short": 2,
    "duration_long": 1,
    "gap": 5,
    "repetition": 2
  },

  "violation_pct": {
    "cps": 2.5,
    "cpl": 5.8,
    "gap": 4.2
  },

  "cps_stats": {
    "avg": 13.2,
    "max": 19.8,
    "median": 12.5,
    "threshold": 17.0
  },

  "cpl_stats": {
    "avg_longest_line": 38.4,
    "max_longest_line": 52,
    "threshold": 47
  },

  "gap_stats": {
    "avg": 0.21,
    "min": 0.04,
    "threshold": 0.083
  },

  "worst_cps_blocks": [
    {
      "index": 42,
      "start": 123.5,
      "end": 125.0,
      "text": "Đây là block có CPS cao nhất",
      "duration": 1.5,
      "cps": 19.8,
      "longest_line": 30,
      "gap_to_next": 0.1,
      "violations": { "cps": true, "cpl": false, "gap": false, "repetition": false, ... },
      "repeated_phrase": null
    }
  ],

  "worst_cpl_blocks": [ ... ],

  "blocks": [
    {
      "index": 1,
      "start": 1.0,
      "end": 3.5,
      "text": "Xin chào thế giới",
      "duration": 2.5,
      "cps": 7.2,
      "longest_line": 18,
      "line_count": 1,
      "gap_to_next": 0.15,
      "violations": {
        "cps": false,
        "cpl": false,
        "duration_short": false,
        "duration_long": false,
        "gap": false,
        "repetition": false
      },
      "repeated_phrase": null
    }
  ]
}
```

### 13.4 Script tóm tắt nhanh (PowerShell)

Lưu thành `check_quality.ps1`:

```powershell
param(
    [string]$JobId,
    [string]$Lang = "vi",
    [string]$Token
)

$data = curl "http://localhost:5000/api/jobs/$JobId/report?lang=$Lang" `
  -H "Authorization: Bearer $Token" -s | ConvertFrom-Json

Write-Host "════════════════════════════════"
Write-Host "  QUALITY REPORT — $($data.lang.ToUpper())"
Write-Host "════════════════════════════════"
Write-Host "Tổng blocks      : $($data.total_blocks)"
Write-Host "Thời lượng       : $($data.total_duration)s"
Write-Host ""
Write-Host "── Violations ───────────────────"
Write-Host "CPS > 17         : $($data.violations.cps) blocks ($($data.violation_pct.cps)%)"
Write-Host "CPL quá dài      : $($data.violations.cpl) blocks ($($data.violation_pct.cpl)%)"
Write-Host "Duration ngắn    : $($data.violations.duration_short) blocks"
Write-Host "Duration dài     : $($data.violations.duration_long) blocks"
Write-Host "Gap < 83ms       : $($data.violations.gap) blocks ($($data.violation_pct.gap)%)"
Write-Host "Repetition (ASR) : $($data.violations.repetition) blocks"
Write-Host ""
Write-Host "── CPS Stats ────────────────────"
Write-Host "avg / max / median : $($data.cps_stats.avg) / $($data.cps_stats.max) / $($data.cps_stats.median)"
Write-Host ""
Write-Host "── Worst CPS blocks ─────────────"
$data.worst_cps_blocks | ForEach-Object {
    Write-Host "  [#$($_.index)] $($_.start)s → $($_.end)s | CPS=$($_.cps) | $($_.text)"
}
Write-Host ""
Write-Host "── Worst CPL blocks ─────────────"
$data.worst_cpl_blocks | ForEach-Object {
    Write-Host "  [#$($_.index)] CPL=$($_.longest_line) | $($_.text)"
}
```

Chạy:

```powershell
.\check_quality.ps1 -JobId "abc-123-def" -Lang "vi" -Token $TOKEN
```

### 13.5 Gọi trực tiếp từ Python (không cần server)

```python
from models.subtitle_quality import analyze_srt_file
import json

# Từ file SRT trên disk
report = analyze_srt_file("outputs/abc-123-def_vi.srt", lang="vi")

# In full JSON
print(json.dumps(report.to_dict(), ensure_ascii=False, indent=2))

# Hoặc truy cập trực tiếp
print(f"CPS violations: {report.cps_violations}/{report.total_blocks}")
print(f"Worst CPS block: #{report.worst_cps_blocks[0].index} — {report.worst_cps_blocks[0].cps:.1f} CPS")

# Lọc tất cả blocks bị lỗi repetition
hallucinations = [b for b in report.blocks if b.repetition_detected]
for b in hallucinations:
    print(f"Block #{b.index} [{b.start}s]: lặp '{b.repeated_phrase}'")
```

### 13.6 Lưu ý về ASR error detection

Whisper trả về `probability` per-word nhưng hiện tại backend **không forward** trường này khi build word dict (chỉ giữ `word`, `start`, `end`). Do đó, ASR error detection dùng **repetition heuristic**:

- Tìm cùng từ/phrase (1–4 từ) xuất hiện ≥ 3 lần liên tiếp trong một block
- Đây là dấu hiệu đặc trưng của Whisper hallucination, thường xảy ra trên audio nhiễu hoặc im lặng kéo dài

Nếu muốn confidence-based detection chính xác hơn, cần sửa Colab notebook để forward trường `probability` từ Whisper word objects vào response.

---

## 14. Tài liệu & Kiểm thử

Tài liệu phân tích & kiểm thử nằm trong thư mục [docs/](docs/):

| Tài liệu | Nội dung |
|----------|---------|
| [docs/usecase_details_subai.md](docs/usecase_details_subai.md) | Đặc tả chi tiết 11 use case (tác nhân, tiền/hậu điều kiện, luồng chính/thay thế/ngoại lệ) |
| [docs/sequence.md](docs/sequence.md) | 11 biểu đồ tuần tự (Mermaid `sequenceDiagram`) cho toàn bộ use case — xác thực, upload, editor, xuất, thanh toán, tài khoản |
| [docs/test_cases.md](docs/test_cases.md) | 62 test case kiểm thử thủ công cho các luồng quan trọng (dạng bảng, có cột Pass/Fail) |

### 14.1 Phạm vi kiểm thử thủ công

[docs/test_cases.md](docs/test_cases.md) phủ các nhóm sau (bám sát code thực tế — thông báo lỗi và giá trị giới hạn là chính xác với hệ thống):

| Nhóm | Số test case | Phạm vi |
|------|:---:|---------|
| Xác thực (TC-AUTH) | 17 | Đăng ký Magic Link, đăng nhập, quên mật khẩu OTP, Google, bảo vệ route |
| Upload (TC-UPLOAD) | 12 | Normal/Realtime, định dạng, hạn mức 5 video/tháng, khóa Realtime |
| Editor (TC-EDIT) | 15 | Xem, chỉnh sửa, Undo/Redo, tải SRT, xuất video 360p/720p/1080p |
| Thanh toán (TC-PAY) | 9 | MoMo create-order, success/timeout, đã Premium, rate limit |
| Tài khoản (TC-PROFILE) | 9 | Xem thông tin, đổi tên, đổi mật khẩu, xóa tài khoản |
| Bảo mật & Phân quyền (TC-SEC) | 26 | Auth token (401), IDOR/ownership (403), Premium gate, rate limit (429), path traversal, IPN giả mạo |

> Lưu ý: các test case phụ thuộc Colab (xử lý ASR/dịch thực tế) cần môi trường Colab VM1/VM2 hoạt động để chạy đến kết quả cuối. Nhóm TC-SEC test ở tầng API backend (curl/Postman) với 2 tài khoản A/B.
