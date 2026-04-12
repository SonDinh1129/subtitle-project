# SubAI — AI Subtitle Generator

```
subtitle-web/
├── models/
│   └── subtitle_model.py       ← Model: VAD, Colab client, SRT gen, job store
├── views/
│   └── templates/
│       └── index.html          ← View: React SPA shell (Vite inject)
│   └── static/                 ← View: React build output (production)
├── controllers/
│   └── subtitle_controller.py  ← Controller: Flask routes, validate, gọi Model
├── src/                        ← React frontend source
│   └── lib/
│       └── api.ts              ← Frontend ↔ Controller service layer
├── app.py                      ← Entry point: Flask app factory + startup
└── requirements.txt
```

---

## Kiến trúc MVC

```
Browser (React)
    │  HTTP (fetch/XHR)
    ▼
Controller  (subtitle_controller.py)
    │  Gọi hàm thuần Python
    ▼
Model  (subtitle_model.py)
    ├── FFmpeg  → extract audio
    ├── Silero VAD  → detect speech
    └── ColabClient → HTTP → Google Colab (Whisper ASR + MT)
```

| Layer      | File                            | Trách nhiệm                                          |
|------------|---------------------------------|------------------------------------------------------|
| Model      | `models/subtitle_model.py`      | AI logic, audio xử lý, Colab, SRT, job store         |
| View       | `views/templates/index.html`    | React SPA shell (UI render ở browser)                |
| Controller | `controllers/subtitle_controller.py` | HTTP routing, validation, gọi Model, trả JSON   |
| Entry      | `app.py`                        | Flask factory, load VAD, đăng ký blueprint           |

---

## Chạy Backend

### 1. Cài dependencies
```bash
pip install -r requirements.txt
```

### 2. Set Colab URL
```bash
# macOS/Linux
export COLAB_URL=https://<your-real-ngrok-id>.ngrok-free.dev

# Windows PowerShell
$env:COLAB_URL = "https://<your-real-ngrok-id>.ngrok-free.dev"
```

### 3. Khởi động server
```bash
python app.py
```
Server chạy tại `http://localhost:5000`

---

## Chạy Frontend (Development)

```bash
# Trong thư mục frontend (React/Vite)
cp .env.example .env          # VITE_API_URL=http://localhost:5000/api
npm install
npm run dev                   # http://localhost:5173
```

---

## API Endpoints

| Method | URL                                | Mô tả                              |
|--------|------------------------------------|------------------------------------|
| GET    | `/api/health`                      | Kiểm tra server + Colab            |
| POST   | `/api/upload`                      | Upload video, nhận `job_id`        |
| GET    | `/api/jobs/<job_id>`               | Poll trạng thái + kết quả          |
| GET    | `/api/jobs/<job_id>/download/<lang>` | Tải SRT (`en` hoặc `vi`)         |

### Upload Form Data
```
file             : video (mp4/mov/mkv/avi/webm)
translation_mode : "segment" | "sentence"
```

### Job Status Response
```json
{
  "job_id":   "uuid",
  "status":   "queued | extracting | vad | transcribing | generating | done | error",
  "progress": 0..100,
  "error":    null,

  // chỉ có khi status == "done":
  "english_words":    [{"word": "...", "start": 1.2, "end": 1.8}],
  "vietnamese_words": [...],
  "english_text":     "...",
  "vietnamese_text":  "..."
}
```

---

## Production Build

```bash
# Build React
npm run build
# Copy dist vào views/static
cp -r dist/* subtitle-web/views/static/
# Flask tự serve index.html cho mọi route
python app.py
```

---

## Biến môi trường

| Biến            | Mặc định                        | Mô tả                     |
|-----------------|---------------------------------|---------------------------|
| `COLAB_URL`     | (bắt buộc)                      | URL ngrok của Colab        |
| `PORT`          | `5000`                          | Port Flask                 |
| `FLASK_DEBUG`   | `false`                         | Debug mode                 |
| `SECRET_KEY`    | `dev-secret-change-in-prod`     | Flask secret key           |
| `VITE_API_URL`  | `http://localhost:5000/api`     | (frontend) URL backend API |
