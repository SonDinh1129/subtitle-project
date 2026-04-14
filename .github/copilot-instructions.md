# SubAI – Copilot Instructions

These rules apply to ALL code generation in this project.
Follow them exactly. Do not introduce patterns not described here.

---

## Project Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.12 · Flask · flask-limiter · PyJWT · Supabase Python SDK |
| Frontend | React 19 · TypeScript · Vite · TailwindCSS · react-router v7 |
| Auth | Supabase (JWT validated server-side) |
| AI pipeline | Silero VAD (local) → Colab (Whisper + translation) |
| Payment | PayOS (HMAC-SHA256 signature) |

---

## Architecture: MVC (strict)

```
controllers/   ← HTTP only: validate input, call model, return JSON
models/        ← Business logic, no HTTP, no Flask request/response
middleware/    ← Cross-cutting: auth decorators, Supabase helpers
extensions.py  ← Shared Flask extensions (limiter)
src/lib/api.ts ← All frontend↔backend communication
src/app/       ← React components, pages, context, routes
```

### Rule: Controllers do NOT contain business logic
```python
# WRONG
@subtitle_bp.post("/upload")
def upload():
    wav = read_audio(...)   # ← processing in controller
    segments = vad(wav)     # ← processing in controller

# CORRECT
@subtitle_bp.post("/upload")
@require_auth
def upload():
    job = create_job(...)   # ← delegate to model
    threading.Thread(target=run_pipeline, args=(job_id, colab_url)).start()
    return jsonify({"job_id": job_id}), 200
```

### Rule: Models do NOT import Flask or access request/g
```python
# WRONG
from flask import g, current_app
def run_pipeline(job_id):
    colab_url = current_app.config["COLAB_URL"]  # ← Flask in model

# CORRECT
def run_pipeline(job_id: str, colab_url: str) -> None:  # ← passed in by controller
    ...
```

---

## Backend Rules

### 1. Blueprint route URLs — never include `/api` prefix
The blueprints are registered with `url_prefix="/api"` in `app.py`.
Adding `/api` again creates a broken double-prefix.

```python
# WRONG
@subtitle_bp.route("/api/jobs/<job_id>/something", methods=["POST"])

# CORRECT
@subtitle_bp.route("/jobs/<job_id>/something", methods=["POST"])
```

### 2. Auth decorators — required on every non-public endpoint
```python
# Public endpoints (health check, PayOS webhook): no decorator needed
# User endpoints:
@subtitle_bp.post("/upload")
@require_auth
@limiter.limit("5/minute")
def upload_video(): ...

# Premium-only endpoints — BOTH decorators + ownership check:
@subtitle_bp.post("/jobs/<job_id>/optimize")
@require_auth
@require_premium
def optimize(job_id):
    job = get_job(job_id)
    if job.get("user_id") != g.user_id:
        return jsonify(error="Forbidden"), 403
```

### 3. Supabase client — always use the shared helper
Never call `create_client(...)` inline. Use the request-scoped cached helper.

```python
# WRONG
from supabase import create_client
supabase = create_client(current_app.config["SUPABASE_URL"], ...)

# CORRECT
from middleware.auth import _get_supabase_service
supabase = _get_supabase_service()
```

### 4. Imports — always at module top level
```python
# WRONG
def create_order():
    import time          # ← late import
    import hashlib       # ← late import

# CORRECT
import time
import hashlib
# ... top of file
```

### 5. PayOS signature — use the shared helper
```python
# WRONG — building canonical string manually each time
canonical = "&".join(f"{k}={v}" for k, v in sorted(data.items()))
sig = hmac.new(key, canonical.encode(), hashlib.sha256).hexdigest()

# CORRECT
from controllers.payment_controller import _build_payos_signature
sig = _build_payos_signature(data)
```

### 6. CORS — never hardcode origins alongside env var
```python
# WRONG
CORS(app, resources={r"/api/*": {"origins": [frontend_url, "http://localhost:5173"]}})

# CORRECT — rely on env var (defaults to localhost already)
CORS(app, resources={r"/api/*": {"origins": frontend_url}})
```

### 7. Static file paths — use Path constants, never hardcoded strings
```python
# WRONG
send_from_directory('uploads', filename)

# CORRECT
from models.subtitle_model import UPLOAD_DIR
send_from_directory(str(UPLOAD_DIR), filename)
```

### 8. Repeated logic across pipeline functions — extract helpers
If the same sequence of operations appears in more than one pipeline function,
extract it into a module-level helper:
```python
# CORRECT pattern (see _prepare_segments in subtitle_model.py)
def _prepare_segments(audio_path: str, min_duration: float = 2.0) -> list[dict]:
    segments, wav = detect_speech_segments(audio_path)
    if not segments:
        raise RuntimeError("No speech detected in the video.")
    ...
    return encode_segments_for_colab(segments, wav)
```

### 9. No TODO / TEMPORARY comments in committed code
If a feature is not ready, either implement it fully or do not commit the stub.
```python
# WRONG
# TEMPORARY: auth not applied — DO NOT deploy
# TODO: add ownership check when auth is ready
@subtitle_bp.post("/endpoint")
def endpoint(): ...

# CORRECT — implement auth or don't add the route
@subtitle_bp.post("/endpoint")
@require_auth
@require_premium
def endpoint():
    job = get_job(job_id)
    if job.get("user_id") != g.user_id:
        return jsonify(error="Forbidden"), 403
```

---

## Frontend Rules

### 1. All API calls go through `src/lib/api.ts`
Never use raw `fetch` with a manually built URL in components or contexts.

```typescript
// WRONG — in any component or context
const res = await fetch(`http://localhost:5000/api/auth/me`, {
  headers: { Authorization: `Bearer ${token}` },
})

// CORRECT — use helpers from api.ts
import { authFetch, authFetchWithToken } from '../../lib/api'

// When you have the token already (e.g. in AuthContext during auth state change):
const res = await authFetchWithToken('/auth/me', accessToken)

// When calling from a component with an active session:
const res = await authFetch('/jobs/123')
```

### 2. Never duplicate the BASE URL constant
`BASE` is defined once in `src/lib/api.ts`. Do not redefine it anywhere else.

```typescript
// WRONG — in AuthContext.tsx, a page, or a hook
const BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:5000/api').replace(/\/$/, '')

// CORRECT — import and use helpers from api.ts
import { authFetch } from '../../lib/api'
```

### 3. Types — define in `api.ts`, import everywhere
All shared API types (`Word`, `JobResponse`, `JobStatus`, etc.) live in `src/lib/api.ts`.
Do not redefine them in components.

```typescript
// WRONG
interface Word { word: string; start: number; end: number }  // in EditorPage.tsx

// CORRECT
import type { Word, JobResponse } from '../../lib/api'
```

### 4. Protected routes — wrap in ProtectedRoute in routes.ts
```typescript
// CORRECT pattern
{
  Component: ProtectedRoute,
  children: [
    { path: "upload", Component: UploadPage },
    { path: "editor", Component: EditorPage },
  ],
}
```

### 5. Auth state — read from AuthContext, never recompute
`isPremium` is computed server-side and provided by `AuthContext`.
Do not recompute from `profile.premium_until` on the frontend.

```typescript
// WRONG
const isPremium = profile?.premium_until
  ? new Date(profile.premium_until) > new Date()
  : false

// CORRECT
const { isPremium } = useAuth()
```

### 6. Realtime stream — use openRealtimeStream from api.ts
```typescript
// CORRECT
import { openRealtimeStream } from '../../lib/api'
const stream = await openRealtimeStream(jobId, {
  onEvent: (evt) => { ... },
  onError: (err) => { ... },
})
```

---

## Adding a New Feature — Checklist

When Copilot generates a new feature, verify all of the following:

**Backend**
- [ ] Route in the correct blueprint, URL has no `/api` prefix
- [ ] `@require_auth` on every non-public endpoint
- [ ] `@require_premium` + ownership check on premium endpoints
- [ ] `@limiter.limit(...)` on write/expensive endpoints
- [ ] Supabase access via `_get_supabase_service()` from `middleware.auth`
- [ ] Business logic in model, not controller
- [ ] All imports at module top level
- [ ] No hardcoded path strings — use `UPLOAD_DIR` / `OUTPUT_DIR`
- [ ] New model functions covered by tests in `tests/`

**Frontend**
- [ ] API call uses `authFetch` or `authFetchWithToken` from `api.ts`
- [ ] No local `BASE` constant
- [ ] New types added to `api.ts` and imported where used
- [ ] New pages added to `routes.ts`, wrapped in `ProtectedRoute` if auth-required
- [ ] Auth state read from `useAuth()`, never recomputed locally

---

## File Ownership Map

| File | Owns |
|---|---|
| `controllers/subtitle_controller.py` | Upload, job status, download, export, optimize routes |
| `controllers/auth_controller.py` | `/api/auth/me` |
| `controllers/payment_controller.py` | PayOS create-order, webhook |
| `models/subtitle_model.py` | Job store, VAD, Colab client, SRT generation, pipeline |
| `models/subtitle_optimizer.py` | SRT post-processing (CPS/CPL/gap/duration fixes) |
| `middleware/auth.py` | JWT decode, `require_auth`, `require_premium`, `get_profile`, `_get_supabase_service` |
| `extensions.py` | `limiter` (flask-limiter singleton) |
| `src/lib/api.ts` | All types, `BASE`, `authFetch`, `authFetchWithToken`, all API call functions |
| `src/lib/supabase.ts` | Supabase browser client singleton |
| `src/app/context/AuthContext.tsx` | `user`, `session`, `profile`, `isPremium`, `signOut`, `refreshProfile` |
| `src/app/routes.ts` | React Router config, protected route grouping |
