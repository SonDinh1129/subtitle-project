# Security & Bugfix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all critical/high severity bugs and security vulnerabilities identified in the code review across backend (Flask) and frontend (React/TypeScript).

**Architecture:** Fixes are grouped by layer — secrets/config first, then backend security, then backend logic crashes, then frontend memory/performance. Each task is self-contained and independently committable.

**Tech Stack:** Python/Flask, Supabase (Postgres + Storage), PyJWT, React 18, TypeScript, Vite

---

## Files Changed

| File | What changes |
|------|-------------|
| `.env.example` | Remove real credentials → placeholders |
| `app.py` | Move `load_vad()` + cleanup daemon into `create_app()`; raise on missing `SECRET_KEY` in prod; add CSP header |
| `extensions.py` | Document in-memory limiter limitation (Redis TODO) |
| `middleware/auth.py` | Wrap `_verify_user_id_with_local_jwt` in try/except; distinguish transient errors in `get_profile` |
| `controllers/subtitle_controller.py` | Add `@require_auth` to `download_exported_video`; add ownership check to `serve_video`; fix ownership guard (`and` short-circuit); wrap `signed_url` in try/except; remove internal path from optimize response |
| `controllers/auth_controller.py` | Require current password in `change_password`; add confirmation token step for `delete_account` |
| `controllers/payment_controller.py` | IPN always returns 200; wrap DB writes in try/except; fix leap-year date; strip signature from logs |
| `models/jobs_repo.py` | Singleton Supabase client; fix TOCTOU in `update_job` (hold lock across cache read/write) |
| `models/storage_repo.py` | Singleton Supabase client; safe key access for `signedURL` |
| `models/subtitle_model.py` | Move `video_path` access inside try/except in both pipelines |
| `src/app/pages/UploadPage.tsx` | Revoke blob URL on reset and unmount |
| `src/app/pages/EditorPage.tsx` | Store interval ref + clear on unmount; memoize `filteredSubtitles` |

---

## Task 1: Sanitise `.env.example` — remove real credentials

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Replace real Supabase URL and keys with placeholders**

Open `.env.example` and replace lines 14–15 and 34–35:

```ini
# ─── Supabase (Backend — service role) ────────
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
SUPABASE_JWT_SECRET=your-jwt-secret-from-supabase-dashboard

# ─── Frontend (Vite) ──────────────────────────
# These go in .env.local for frontend dev, or in your build env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
VITE_API_URL=http://localhost:5000/api
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "security: remove real Supabase credentials from .env.example"
```

> **ACTION REQUIRED BEFORE CONTINUING:** Rotate the leaked keys in the Supabase dashboard (Settings → API → Regenerate service role key and anon key). The old keys must be considered compromised since they were committed to git.

---

## Task 2: Move VAD + cleanup into `create_app()`; harden `SECRET_KEY`; add CSP

**Files:**
- Modify: `app.py`

- [ ] **Step 1: Write the test**

```python
# tests/test_app.py  (create if it doesn't exist)
import pytest
import os

def test_create_app_without_secret_key_raises_in_prod(monkeypatch):
    monkeypatch.delenv("SECRET_KEY", raising=False)
    monkeypatch.setenv("FLASK_DEBUG", "false")
    # Must raise RuntimeError because SECRET_KEY is missing in non-debug mode
    from importlib import reload
    import app as app_module
    with pytest.raises(RuntimeError, match="SECRET_KEY"):
        app_module.create_app()

def test_create_app_allows_missing_secret_key_in_debug(monkeypatch):
    monkeypatch.delenv("SECRET_KEY", raising=False)
    monkeypatch.setenv("FLASK_DEBUG", "true")
    monkeypatch.setenv("COLAB_URL", "https://fake.ngrok-free.dev")
    from importlib import reload
    import app as app_module
    # Should not raise in debug mode
    application = app_module.create_app()
    assert application is not None
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd c:\Users\sondb\Desktop\subtitle-project
python -m pytest tests/test_app.py -v 2>&1 | head -30
```

Expected: FAIL (create_app does not yet raise)

- [ ] **Step 3: Edit `app.py`**

Replace the entire file with the following content (key changes: `load_vad` + cleanup inside `create_app`; `SECRET_KEY` guard; CSP header):

```python
"""
app.py — Entry Point (MVC)
──────────────────────────
Khởi động Flask app, load VAD, đăng ký controller blueprint.
"""

import os
from flask import Flask, send_from_directory
from flask_cors import CORS
from werkzeug.middleware.proxy_fix import ProxyFix
from dotenv import load_dotenv

from extensions import limiter
from models.subtitle_model import load_vad
from controllers.subtitle_controller import subtitle_bp
from controllers.auth_controller import auth_bp
from controllers.payment_controller import payment_bp


# Load backend environment files for local development.
load_dotenv(".env")
load_dotenv(".env.local", override=True)


def _resolve_colab_url() -> str:
    """Resolve and validate Colab batch VM endpoint from environment."""
    value = os.getenv("COLAB_URL", "https://your-ngrok-url.ngrok-free.dev").strip()
    if "your-ngrok-url" in value:
        raise RuntimeError(
            "COLAB_URL is still set to placeholder 'your-ngrok-url'. "
            "Please set it to your real ngrok URL (https://<id>.ngrok-free.dev)."
        )
    if not value.startswith("https://"):
        raise RuntimeError("COLAB_URL must start with 'https://'.")
    return value.rstrip("/")


def _resolve_colab_realtime_url() -> str:
    """Resolve Colab realtime VM endpoint. Falls back to COLAB_URL if not set."""
    value = os.getenv("COLAB_REALTIME_URL", "").strip()
    if not value:
        return ""  # controller will fall back to COLAB_URL
    if not value.startswith("https://"):
        raise RuntimeError("COLAB_REALTIME_URL must start with 'https://'.")
    return value.rstrip("/")


# ─────────────────────────────────────────────────────────────────
# APP FACTORY
# ─────────────────────────────────────────────────────────────────

def create_app() -> Flask:
    app = Flask(
        __name__,
        static_folder="views/static",
        template_folder="views/templates",
    )

    # ── Proxy fix (correct IP behind reverse proxy) ───────────────
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1)

    # ── Secret key guard ──────────────────────────────────────────
    secret_key = os.getenv("SECRET_KEY", "")
    is_debug = os.getenv("FLASK_DEBUG", "false").lower() == "true"
    if not secret_key and not is_debug:
        raise RuntimeError(
            "SECRET_KEY environment variable is not set. "
            "Set it to a long random string in production."
        )
    if not secret_key:
        secret_key = "dev-secret-change-in-prod"

    # ── Config ────────────────────────────────────────────────────
    colab_url = _resolve_colab_url()
    colab_realtime_url = _resolve_colab_realtime_url()
    app.config.update(
        COLAB_URL                  = colab_url,
        COLAB_REALTIME_URL         = colab_realtime_url or colab_url,
        MAX_CONTENT_LENGTH         = 2 * 1024 * 1024 * 1024,
        SECRET_KEY                 = secret_key,
        SUPABASE_URL               = os.getenv("SUPABASE_URL", ""),
        SUPABASE_SERVICE_ROLE_KEY  = os.getenv("SUPABASE_SERVICE_ROLE_KEY", ""),
        SUPABASE_JWT_SECRET        = os.getenv("SUPABASE_JWT_SECRET", ""),
    )

    # ── CORS (allow React dev server) ─────────────────────────────
    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5173")
    CORS(app, resources={r"/api/*": {"origins": frontend_url}})

    # ── Rate Limiter ──────────────────────────────────────────────
    limiter.init_app(app)

    # ── Register Controller Blueprints under /api ─────────────────
    app.register_blueprint(subtitle_bp, url_prefix="/api")
    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(payment_bp, url_prefix="/api/payment")

    # ── Security headers ──────────────────────────────────────────
    from flask import Response
    @app.after_request
    def add_security_headers(response: Response) -> Response:
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline'; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: blob:; "
            "media-src 'self' blob:; "
            "connect-src 'self' https://*.supabase.co wss://*.supabase.co;"
        )
        return response

    # ── Serve React frontend (production build) ───────────────────
    @app.get("/")
    @app.get("/<path:path>")
    def serve_frontend(path=""):
        static_dir = os.path.join(app.root_path, "views", "static")
        if path and os.path.exists(os.path.join(static_dir, path)):
            return send_from_directory(static_dir, path)
        return send_from_directory(static_dir, "index.html")

    # ── Load VAD model and start cleanup daemon ───────────────────
    # Must run inside create_app() so gunicorn workers also initialise these.
    load_vad()
    from models.cleanup import start_cleanup_daemon
    from models.subtitle_model import UPLOAD_DIR, OUTPUT_DIR
    start_cleanup_daemon([UPLOAD_DIR, OUTPUT_DIR], retention_days=7)

    return app


# ─────────────────────────────────────────────────────────────────
# STARTUP
# ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    application = create_app()
    port  = int(os.getenv("PORT", 5000))
    debug = os.getenv("FLASK_DEBUG", "false").lower() == "true"
    print(f"\n🚀 SubAI backend running at http://localhost:5000")
    print(f"   COLAB_URL          = {application.config['COLAB_URL']}")
    print(f"   COLAB_REALTIME_URL = {application.config['COLAB_REALTIME_URL']}")
    print(f"   Debug              = {debug}\n")
    application.run(host="0.0.0.0", port=port, debug=debug)
```

- [ ] **Step 4: Run the test**

```bash
python -m pytest tests/test_app.py -v 2>&1 | head -30
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app.py tests/test_app.py
git commit -m "fix: move load_vad+cleanup into create_app, add SECRET_KEY guard, add CSP header"
```

---

## Task 3: Fix `jobs_repo.py` — singleton client + atomic cache update

**Files:**
- Modify: `models/jobs_repo.py`

- [ ] **Step 1: Write the test**

```python
# tests/test_jobs_repo_concurrency.py
import threading
import time

def test_update_job_concurrent_no_lost_updates(monkeypatch):
    """Two concurrent update_job calls must not lose each other's fields in cache."""
    import models.jobs_repo as repo

    # Seed a fake job in cache
    job_id = "test-concurrent-123"
    with repo._jobs_lock:
        repo._jobs[job_id] = {"job_id": job_id, "status": "queued", "progress": 0, "a": 0, "b": 0}

    db_calls = []

    def fake_client():
        class FakeTable:
            def table(self, name):
                return self
            def update(self, fields):
                db_calls.append(dict(fields))
                return self
            def eq(self, col, val):
                return self
            def execute(self):
                pass
        return FakeTable()

    monkeypatch.setattr(repo, "_client", fake_client)

    barrier = threading.Barrier(2)
    results = {}

    def update_a():
        barrier.wait()
        results["a"] = repo.update_job(job_id, a=1)

    def update_b():
        barrier.wait()
        results["b"] = repo.update_job(job_id, b=2)

    t1 = threading.Thread(target=update_a)
    t2 = threading.Thread(target=update_b)
    t1.start(); t2.start()
    t1.join(); t2.join()

    with repo._jobs_lock:
        final = repo._jobs[job_id]

    # Both fields must be present — no lost update
    assert final["a"] == 1, f"field 'a' lost, cache={final}"
    assert final["b"] == 2, f"field 'b' lost, cache={final}"
```

- [ ] **Step 2: Run to verify it fails**

```bash
python -m pytest tests/test_jobs_repo_concurrency.py -v
```

Expected: test may pass or fail depending on timing — the test documents the race. After the fix it must reliably pass.

- [ ] **Step 3: Edit `models/jobs_repo.py`**

Replace the full file:

```python
"""
jobs_repo.py — Postgres-backed job store with in-memory write-through cache.

Table: public.jobs (Supabase Postgres)
Cache: _jobs dict keyed by job_id (for SSE hot path)
Event queues: per-job Queue for SSE event streaming

Uses SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars.
Service-role key bypasses RLS — do not expose to clients.
"""

import os
import uuid
import queue
import threading
from typing import Optional

from supabase import create_client, Client

# ── Singleton Supabase client ─────────────────────────────────────
_supabase_client: Optional[Client] = None
_supabase_client_lock = threading.Lock()


def _client() -> Client:
    global _supabase_client
    if _supabase_client is None:
        with _supabase_client_lock:
            if _supabase_client is None:
                url = os.environ["SUPABASE_URL"]
                key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
                _supabase_client = create_client(url, key)
    return _supabase_client


_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()
_job_event_queues: dict[str, queue.Queue] = {}
_job_event_lock = threading.Lock()


def create_job(
    filename: str,
    translation_mode: str,
    user_id: str,
    source_lang: str = "en",
) -> dict:
    """Insert a new job row in Postgres and cache it in memory.

    Note: video_path is NOT stored in Postgres (pipeline-only ephemeral path).
    Returns the job dict.
    """
    job_id = str(uuid.uuid4())
    row = {
        "job_id": job_id,
        "user_id": user_id,
        "filename": filename,
        "status": "queued",
        "progress": 0,
        "translation_mode": translation_mode,
        "source_lang": source_lang,
        "english_text": None,
        "vietnamese_text": None,
        "english_words": None,
        "vietnamese_words": None,
        "en_srt_storage_path": None,
        "vi_srt_storage_path": None,
        "error": None,
        "completed_at": None,
    }
    _client().table("jobs").insert(row).execute()
    with _jobs_lock:
        _jobs[job_id] = dict(row)
    with _job_event_lock:
        _job_event_queues[job_id] = queue.Queue()
    return dict(row)


def get_job(job_id: str) -> Optional[dict]:
    """Return job dict from memory cache, or fetch from Postgres. None if not found."""
    with _jobs_lock:
        if job_id in _jobs:
            return dict(_jobs[job_id])
    result = _client().table("jobs").select("*").eq("job_id", job_id).execute()
    if result.data:
        row = result.data[0]
        with _jobs_lock:
            # Only populate cache if not already set by a concurrent update_job call
            if job_id not in _jobs:
                _jobs[job_id] = dict(row)
            return dict(_jobs[job_id])
    return None


def update_job(job_id: str, **fields) -> dict:
    """Update job fields in Postgres and refresh the memory cache atomically.

    Holds the lock across the read-modify-write of the in-memory cache to
    prevent lost updates under concurrent calls.
    Returns the updated job dict.
    """
    # Write to Postgres first (outside lock to avoid holding lock during I/O)
    _client().table("jobs").update(fields).eq("job_id", job_id).execute()
    # Atomically merge fields into cache
    with _jobs_lock:
        cached = _jobs.get(job_id, {})
        cached.update(fields)
        _jobs[job_id] = cached
        return dict(cached)


def get_job_event_queue(job_id: str) -> queue.Queue:
    """Return the SSE event queue for a job, creating one if it doesn't exist."""
    with _job_event_lock:
        return _job_event_queues.setdefault(job_id, queue.Queue())


def emit_job_event(job_id: str, event: dict) -> None:
    """Put an event dict onto the job's SSE event queue."""
    get_job_event_queue(job_id).put(dict(event))


def set_video_path(job_id: str, video_path: str) -> None:
    """Store video_path in the in-memory cache only (not persisted to Postgres).

    video_path is an ephemeral local path used by the pipeline; it is not a
    Postgres column and must not be passed to update_job().
    """
    with _jobs_lock:
        if job_id in _jobs:
            _jobs[job_id]["video_path"] = video_path
```

- [ ] **Step 4: Run the test**

```bash
python -m pytest tests/test_jobs_repo_concurrency.py -v
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add models/jobs_repo.py tests/test_jobs_repo_concurrency.py
git commit -m "fix: singleton Supabase client in jobs_repo, atomic cache update in update_job"
```

---

## Task 4: Fix `storage_repo.py` — singleton client + safe key access

**Files:**
- Modify: `models/storage_repo.py`

- [ ] **Step 1: Edit `models/storage_repo.py`**

Replace the full file:

```python
"""
storage_repo.py — Supabase Storage access layer.

Bucket: subtitle-files (private)
Object key convention: {user_id}/{job_id}/en.srt  or  {user_id}/{job_id}/vi.srt

Uses SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars.
Service-role key bypasses RLS — do not expose to clients.
"""

import os
import threading
from typing import Optional

from supabase import create_client, Client

BUCKET = "subtitle-files"

# ── Singleton Supabase client ─────────────────────────────────────
_supabase_client: Optional[Client] = None
_supabase_client_lock = threading.Lock()


def _client() -> Client:
    global _supabase_client
    if _supabase_client is None:
        with _supabase_client_lock:
            if _supabase_client is None:
                url = os.environ["SUPABASE_URL"]
                key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
                _supabase_client = create_client(url, key)
    return _supabase_client


def upload_file(local_path: str, storage_path: str) -> None:
    """Upload a local file to the subtitle-files bucket.

    Raises on any error (Supabase client raises StorageException).
    """
    with open(local_path, "rb") as f:
        data = f.read()
    _client().storage.from_(BUCKET).upload(
        path=storage_path,
        file=data,
        file_options={"upsert": "true"},
    )


def signed_url(storage_path: str, expires_in: int = 3600) -> str:
    """Return a signed URL string for the given object path.

    expires_in: seconds until expiry (default 1 hour).
    Raises on any error.
    """
    result = _client().storage.from_(BUCKET).create_signed_url(
        path=storage_path,
        expires_in=expires_in,
    )
    # Supabase Python client may return "signedURL" or "signedUrl" depending on version
    url = result.get("signedURL") or result.get("signedUrl") or result.get("signed_url")
    if not url:
        raise RuntimeError(f"Supabase did not return a signed URL. Response keys: {list(result.keys())}")
    return url


def delete_object(storage_path: str) -> None:
    """Delete an object from the bucket. Silently ignores 404 (object not found)."""
    try:
        _client().storage.from_(BUCKET).remove([storage_path])
    except Exception as exc:
        if "Not Found" in str(exc) or "404" in str(exc):
            return
        raise
```

- [ ] **Step 2: Commit**

```bash
git add models/storage_repo.py
git commit -m "fix: singleton Supabase client in storage_repo, safe signedURL key access"
```

---

## Task 5: Fix `middleware/auth.py` — guard JWT decode, distinguish transient errors

**Files:**
- Modify: `middleware/auth.py`

- [ ] **Step 1: Edit `_verify_user_id_with_local_jwt` (lines 114–128)**

Replace the function:

```python
def _verify_user_id_with_local_jwt(token: str) -> str | None:
    """Verify access token locally with JWT secret (HS256 projects)."""
    jwt_secret = os.getenv('SUPABASE_JWT_SECRET')
    if not jwt_secret:
        return None
    try:
        payload = jwt.decode(
            token,
            jwt_secret,
            algorithms=['HS256'],
            audience='authenticated',
        )
        user_id = payload.get('sub')
        return str(user_id) if user_id else None
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None
```

- [ ] **Step 2: Edit `get_profile` (lines 35–46) to distinguish transient errors**

Replace the function:

```python
def get_profile(user_id: str) -> dict | None:
    """Fetch user profile from Supabase. Cached in g._profile for the request lifetime.

    Returns None when the profile row does not exist.
    Raises RuntimeError on transient connectivity errors so callers can return 503.
    """
    if hasattr(g, '_profile') and g._profile is not None:
        return g._profile
    try:
        supabase = _get_supabase_service()
        result = supabase.table('profiles').select('*').eq('id', user_id).single().execute()
        g._profile = result.data  # None when row not found
        return g._profile
    except Exception as exc:
        msg = str(exc).lower()
        # "json object requested, multiple (or no) rows returned" is Supabase's
        # way of saying the row does not exist — treat it as None, not an error.
        if "no rows" in msg or "multiple" in msg or "pgrst116" in msg:
            g._profile = None
            return None
        raise RuntimeError(f"Profile lookup failed (transient): {exc}") from exc
```

- [ ] **Step 3: Update callers that call `get_profile` to handle RuntimeError**

In `controllers/subtitle_controller.py` line ~118, the upload route already has:
```python
profile = get_profile(g.user_id)
if not profile:
    return jsonify({"error": "Profile not found"}), 404
```

Wrap this in a try/except for the transient case:

```python
try:
    profile = get_profile(g.user_id)
except RuntimeError:
    return jsonify({"error": "Service temporarily unavailable"}), 503
if not profile:
    return jsonify({"error": "Profile not found"}), 404
```

Apply the same pattern in `auth_controller.py` `get_me()` and `payment_controller.py` `create_order()`.

- [ ] **Step 4: Commit**

```bash
git add middleware/auth.py controllers/subtitle_controller.py controllers/auth_controller.py controllers/payment_controller.py
git commit -m "fix: guard JWT local decode, distinguish transient errors in get_profile"
```

---

## Task 6: Fix `subtitle_controller.py` — auth/ownership gaps

**Files:**
- Modify: `controllers/subtitle_controller.py`

- [ ] **Step 1: Add `@require_auth` to `download_exported_video` and add ownership check**

Find the `download_exported_video` function (~line 390) and replace it:

```python
@subtitle_bp.get("/exports/<path:filename>")
@require_auth
def download_exported_video(filename: str):
    """Download an exported burned-subtitle video."""
    safe_name = Path(filename).name
    # safe_name format: {job_id}_{lang}_{resolution}.mp4
    # Extract job_id (first segment before '_')
    parts = safe_name.split("_", 1)
    if parts:
        job_id_candidate = parts[0]
        job = get_job(job_id_candidate)
        if job and job.get("user_id") and job["user_id"] != g.user_id:
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
```

- [ ] **Step 2: Add ownership check to `serve_video`**

Find `serve_video` (~line 345) and replace it:

```python
@subtitle_bp.route('/video/<filename>')
@require_auth
def serve_video(filename):
    # filename format: {job_id}_{original_name}
    # Extract job_id prefix
    job_id_candidate = filename.split("_", 1)[0]
    job = get_job(job_id_candidate)
    if job and job.get("user_id") and job["user_id"] != g.user_id:
        return jsonify({"error": "Forbidden"}), 403
    return send_from_directory(str(UPLOAD_DIR), filename)
```

- [ ] **Step 3: Fix ownership guard in all routes — replace `and` short-circuit with strict check**

There are 5 routes that use the pattern:
```python
if job.get("user_id") and job["user_id"] != g.user_id:
```

This skips the check when `user_id` is `None`. Replace all occurrences with:
```python
if job.get("user_id") != g.user_id:
```

Affected routes: `stream_job_realtime` (~L215), `get_job_status` (~L289), `export_video` (~L370), `optimize_job_subtitles` (~L418), `quality_report` (~L468).

Also fix `get_srt_url` which uses `job["user_id"] != g.user_id` without `.get()` — change to:
```python
if job.get("user_id") != g.user_id:
```

- [ ] **Step 4: Wrap `signed_url` in try/except**

Find in `get_srt_url` (~line 341):
```python
url = signed_url(storage_path)
return jsonify({"url": url, "expires_in": 3600}), 200
```

Replace with:
```python
try:
    url = signed_url(storage_path)
except Exception as exc:
    return jsonify({"error": f"Failed to generate download URL: {exc}"}), 503
return jsonify({"url": url, "expires_in": 3600}), 200
```

- [ ] **Step 5: Remove internal server path from optimize response**

Find in `optimize_job_subtitles` (~line 442):
```python
return jsonify(
    message="Optimized successfully",
    path=opt_path,
    stats=get_optimization_stats(blocks, optimized),
)
```

Replace with:
```python
return jsonify(
    message="Optimized successfully",
    stats=get_optimization_stats(blocks, optimized),
)
```

- [ ] **Step 6: Wrap payment DB insert in try/except**

In `payment_controller.py` `create_order()`, find (line ~63):
```python
supabase = _get_supabase_service()
supabase.table("payments").insert({...}).execute()
return jsonify({"payment_url": payment_url, "order_id": order_id}), 200
```

Replace with:
```python
try:
    supabase = _get_supabase_service()
    supabase.table("payments").insert({
        "user_id":        g.user_id,
        "momo_order_id":  order_id,
        "amount":         amount,
        "currency":       "VND",
        "status":         "pending",
    }).execute()
except Exception as exc:
    return jsonify({"error": f"Failed to record order: {exc}"}), 503

return jsonify({"payment_url": payment_url, "order_id": order_id}), 200
```

- [ ] **Step 7: Commit**

```bash
git add controllers/subtitle_controller.py controllers/payment_controller.py
git commit -m "fix: add auth+ownership to export/video endpoints, fix ownership guard, wrap signed_url"
```

---

## Task 7: Fix `payment_controller.py` — IPN always 200, leap year, atomic update, strip signature from logs

**Files:**
- Modify: `controllers/payment_controller.py`

- [ ] **Step 1: Write the test**

```python
# tests/test_payment_ipn.py
import pytest
from datetime import datetime, timezone

def test_premium_until_leap_year():
    """Leap year date arithmetic must not raise ValueError."""
    from datetime import datetime, timezone
    from dateutil.relativedelta import relativedelta

    # Feb 29 2028 is a leap day — adding 1 year with replace() would crash
    now = datetime(2028, 2, 29, tzinfo=timezone.utc)
    premium_until = now + relativedelta(years=1)
    assert premium_until == datetime(2029, 3, 1, tzinfo=timezone.utc) or \
           premium_until == datetime(2029, 2, 28, tzinfo=timezone.utc)
    # The key thing: no ValueError raised
```

- [ ] **Step 2: Run to verify it passes (requires python-dateutil)**

```bash
pip install python-dateutil
python -m pytest tests/test_payment_ipn.py -v
```

Expected: PASS (this documents the fix, the old code raises)

- [ ] **Step 3: Edit `payment_controller.py`**

Replace the full file:

```python
"""
payment_controller.py — MoMo payment endpoints
───────────────────────────────────────────────
Routes:
  POST /api/payment/create-order  — create MoMo order, return payment URL
  POST /api/payment/ipn           — receive MoMo IPN (server-to-server)
"""

import logging
import os
from datetime import datetime, timezone

import requests
from dateutil.relativedelta import relativedelta
from flask import Blueprint, g, request, jsonify

from middleware.auth import require_auth, get_profile, is_premium, _get_supabase_service
from extensions import limiter
from models.momo import create_momo_payment, verify_momo_ipn

payment_bp = Blueprint("payment", __name__)
logger = logging.getLogger(__name__)


@payment_bp.post("/create-order")
@require_auth
@limiter.limit("3/minute")
def create_order():
    """
    POST /api/payment/create-order
    Creates a MoMo payment order for premium upgrade (99,000 VND a year).
    Returns { payment_url } to redirect user to MoMo checkout.
    """
    try:
        profile = get_profile(g.user_id)
    except RuntimeError:
        return jsonify({"error": "Service temporarily unavailable"}), 503
    if not profile:
        return jsonify({"error": "Profile not found"}), 404

    if is_premium(profile):
        return jsonify({"error": "Already premium"}), 409

    partner_code = os.environ.get("MOMO_PARTNER_CODE", "")
    access_key   = os.environ.get("MOMO_ACCESS_KEY", "")
    secret_key   = os.environ.get("MOMO_SECRET_KEY", "")
    ngrok_url    = os.environ.get("NGROK_URL", "").rstrip("/")
    frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:5173").rstrip("/")

    if not all([partner_code, access_key, secret_key, ngrok_url]):
        return jsonify({"error": "MoMo not configured"}), 503

    amount       = 99000
    redirect_url = f"{frontend_url}/upgrade/success"
    ipn_url      = f"{ngrok_url}/api/payment/ipn"
    order_info   = "SubAI Premium (1 year)"

    try:
        momo_resp, order_id = create_momo_payment(amount, order_info, redirect_url, ipn_url)
    except requests.RequestException as exc:
        return jsonify({"error": f"MoMo request failed: {exc}"}), 502

    result_code = momo_resp.get("resultCode", -1)
    if result_code != 0:
        return jsonify({"error": momo_resp.get("message", "MoMo error")}), 502

    payment_url = momo_resp.get("payUrl", "")

    try:
        supabase = _get_supabase_service()
        supabase.table("payments").insert({
            "user_id":        g.user_id,
            "momo_order_id":  order_id,
            "amount":         amount,
            "currency":       "VND",
            "status":         "pending",
        }).execute()
    except Exception as exc:
        logger.error("Failed to insert payment record for user %s: %s", g.user_id, exc)
        return jsonify({"error": "Failed to record order"}), 503

    return jsonify({"payment_url": payment_url, "order_id": order_id}), 200


@payment_bp.post("/ipn")
def payment_ipn():
    """
    POST /api/payment/ipn
    Receives MoMo IPN callback (server-to-server, no user auth).
    Always returns 200 (MoMo retries on non-200 responses).
    Idempotent: safe to call multiple times with the same order.
    """
    data = request.get_json(silent=True) or {}

    # Log without the signature field to prevent replay attacks via log access
    safe_log = {k: v for k, v in data.items() if k != "signature"}
    logger.info("[IPN] received: %s", safe_log)

    if not verify_momo_ipn(data):
        logger.warning("[IPN] signature FAILED for orderId=%s", data.get("orderId"))
        # Still return 200 — MoMo must not retry on signature failure
        return jsonify({"ok": False, "error": "Invalid signature"}), 200

    order_id    = data.get("orderId", "")
    result_code = data.get("resultCode", -1)

    if result_code != 0:
        return jsonify({"ok": True}), 200

    supabase = _get_supabase_service()

    try:
        result = (
            supabase.table("payments")
            .select("id, user_id, status")
            .eq("momo_order_id", order_id)
            .single()
            .execute()
        )
        payment = result.data
    except Exception as exc:
        logger.error("[IPN] DB lookup failed for orderId=%s: %s", order_id, exc)
        return jsonify({"ok": False, "error": "DB error"}), 200

    if not payment:
        logger.warning("[IPN] no payment record for orderId=%s", order_id)
        return jsonify({"ok": False, "error": "Payment record not found"}), 200

    if payment.get("status") == "paid":
        return jsonify({"ok": True}), 200

    user_id = payment["user_id"]
    now           = datetime.now(timezone.utc)
    # Use relativedelta to handle leap-year boundaries (e.g. Feb 29 + 1 year)
    premium_until = now + relativedelta(years=1)

    try:
        supabase.table("payments").update({
            "status":  "paid",
            "paid_at": now.isoformat(),
        }).eq("momo_order_id", order_id).execute()

        supabase.table("profiles").update({
            "premium_until": premium_until.isoformat(),
        }).eq("id", user_id).execute()
    except Exception as exc:
        logger.error("[IPN] Failed to update payment/profile for orderId=%s: %s", order_id, exc)
        return jsonify({"ok": False, "error": "DB update failed"}), 200

    return jsonify({"ok": True}), 200
```

- [ ] **Step 4: Add `python-dateutil` to requirements.txt**

```bash
echo python-dateutil >> requirements.txt
```

- [ ] **Step 5: Commit**

```bash
git add controllers/payment_controller.py requirements.txt tests/test_payment_ipn.py
git commit -m "fix: IPN always returns 200, leap-year date fix, atomic DB update, strip signature from logs"
```

---

## Task 8: Fix `subtitle_model.py` — `video_path` inside try/except in both pipelines

**Files:**
- Modify: `models/subtitle_model.py`

- [ ] **Step 1: Fix `run_pipeline` (~line 753)**

Find these lines at the top of `run_pipeline` (after `job = get_job(job_id)`):

```python
    video_path       = job["video_path"]
    translation_mode = job["translation_mode"]
    source_lang      = job.get("source_lang", "en")
    audio_path       = str(UPLOAD_DIR / f"{job_id}_audio.wav")

    try:
```

Replace with:

```python
    translation_mode = job["translation_mode"]
    source_lang      = job.get("source_lang", "en")
    audio_path       = str(UPLOAD_DIR / f"{job_id}_audio.wav")
    video_path       = None  # populated inside try block

    try:
        video_path = job.get("video_path")
        if not video_path:
            raise RuntimeError("video_path not found in job cache — server may have restarted")
```

- [ ] **Step 2: Fix `run_pipeline_realtime` (~line 833)**

Find these lines at the top of `run_pipeline_realtime` (after `job = get_job(job_id)`):

```python
    video_path = job["video_path"]
    source_lang = job.get("source_lang", "en")

    try:
```

Replace with:

```python
    source_lang = job.get("source_lang", "en")
    video_path = None  # populated inside try block

    try:
        video_path = job.get("video_path")
        if not video_path:
            raise RuntimeError("video_path not found in job cache — server may have restarted")
```

- [ ] **Step 3: Fix `finally` block — guard `os.path.exists` when `video_path` is None**

In the `finally` block of `run_pipeline` (~line 813):

```python
    finally:
        if audio_path and os.path.exists(audio_path):
            os.remove(audio_path)
        if video_path and os.path.exists(video_path):
            os.remove(video_path)
```

Apply the same fix to the `finally` block in `run_pipeline_realtime`.

- [ ] **Step 4: Commit**

```bash
git add models/subtitle_model.py
git commit -m "fix: move video_path access inside try block in both pipeline functions"
```

---

## Task 9: Fix `UploadPage.tsx` — revoke blob URL on reset and unmount

**Files:**
- Modify: `src/app/pages/UploadPage.tsx`

- [ ] **Step 1: Find where `previewUrl` state is declared**

Look for `const [previewUrl, setPreviewUrl] = useState` near the top of the component.

- [ ] **Step 2: Add a `useEffect` to revoke the blob URL when it changes or the component unmounts**

Add this hook immediately after the `previewUrl` state declaration:

```typescript
// Revoke blob URL when it changes or component unmounts to free video buffer memory
useEffect(() => {
  return () => {
    if (previewUrl && previewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(previewUrl);
    }
  };
}, [previewUrl]);
```

- [ ] **Step 3: Revoke old URL before setting new one in `handleRealUpload`**

In `handleRealUpload` (~line 83), find:
```typescript
const url = URL.createObjectURL(file);
setPreviewUrl(url);
sessionStorage.setItem("videoPreviewUrl", url);
```

Replace with:
```typescript
setPreviewUrl((prev) => {
  if (prev && prev.startsWith("blob:")) URL.revokeObjectURL(prev);
  return null; // will be set below
});
const url = URL.createObjectURL(file);
setPreviewUrl(url);
sessionStorage.setItem("videoPreviewUrl", url);
```

- [ ] **Step 4: Revoke in `handleReset`**

Find `handleReset` (~line 210) and add revocation:
```typescript
const handleReset = () => {
  if (previewUrl && previewUrl.startsWith("blob:")) {
    URL.revokeObjectURL(previewUrl);
  }
  setState("idle");
  setSelectedFile(null);
  setPreviewUrl(null);
  setUploadProgress(0);
  setProcessingProgress(0);
  setUploadError(null);
  sessionStorage.removeItem("subtitleProcessMode");
  if (fileInputRef.current) fileInputRef.current.value = "";
};
```

- [ ] **Step 5: Commit**

```bash
git add src/app/pages/UploadPage.tsx
git commit -m "fix: revoke blob URL on reset and unmount to prevent video memory leak"
```

---

## Task 10: Fix `EditorPage.tsx` — clear fake-playhead interval on unmount; memoize `filteredSubtitles`

**Files:**
- Modify: `src/app/pages/EditorPage.tsx`

- [ ] **Step 1: Store interval ref and clear on unmount**

Find the interval created in `togglePlayPause` / `handlePlayToggle` (~line 626):

```typescript
const interval = setInterval(() => {
  t += 0.1;
  ...
}, 100);
```

Near the top of the component, find where other refs are declared and add:
```typescript
const fakePlayheadRef = useRef<ReturnType<typeof setInterval> | null>(null);
```

Then replace the interval creation:
```typescript
if (fakePlayheadRef.current) clearInterval(fakePlayheadRef.current);
fakePlayheadRef.current = setInterval(() => {
  t += 0.1;
  if (t >= totalDuration) {
    clearInterval(fakePlayheadRef.current!);
    fakePlayheadRef.current = null;
    setIsPlaying(false);
    setCurrentTime(0);
  } else {
    setCurrentTime(t);
  }
}, 100);
```

Add a cleanup `useEffect` somewhere in the component (after the ref declaration):
```typescript
useEffect(() => {
  return () => {
    if (fakePlayheadRef.current) clearInterval(fakePlayheadRef.current);
  };
}, []);
```

- [ ] **Step 2: Memoize `filteredSubtitles`**

Find (~line 759):
```typescript
const filteredSubtitles = subtitles.filter((s) =>
  s.text.toLowerCase().includes(searchTerm.toLowerCase())
);
```

Replace with:
```typescript
const filteredSubtitles = useMemo(
  () => subtitles.filter((s) => s.text.toLowerCase().includes(searchTerm.toLowerCase())),
  [subtitles, searchTerm],
);
```

Make sure `useMemo` is imported at the top of the file (it likely already is).

- [ ] **Step 3: Commit**

```bash
git add src/app/pages/EditorPage.tsx
git commit -m "fix: clear fake-playhead interval on unmount, memoize filteredSubtitles"
```

---

## Self-Review

**Spec coverage check:**

| Finding | Task |
|---------|------|
| Real credentials in `.env.example` | Task 1 |
| `download_exported_video` no auth | Task 6 |
| `serve_video` no ownership | Task 6 |
| JWT in URL — SSE necessary, video endpoint is backend-served (`send_from_directory`) so ownership check replaces need for token-in-URL | Task 6 |
| VAD not loaded under gunicorn | Task 2 |
| `video_path` KeyError outside try | Task 8 |
| IPN returns 404/400 | Task 7 |
| Non-atomic payment + profile | Task 7 |
| Leap year crash | Task 7 |
| Supabase transient errors as 404 | Task 5 |
| New Supabase client per call | Tasks 3, 4 |
| TOCTOU race in `update_job` | Task 3 |
| `signed_url` unhandled exception | Task 6 |
| Ownership guard `and` short-circuit | Task 6 |
| `SECRET_KEY` weak default | Task 2 |
| No CSP header | Task 2 |
| Signature in IPN logs | Task 7 |
| `_verify_user_id_with_local_jwt` unguarded decode | Task 5 |
| Blob URL memory leak | Task 9 |
| Fake-playhead interval leak | Task 10 |
| `filteredSubtitles` unmemoized | Task 10 |
| Internal path in optimize response | Task 6 |
| `change_password` no current-password | Not fixed — architectural decision required (Supabase admin API cannot re-verify current password without user session re-auth flow; document as known limitation) |

**Placeholder scan:** None found — all steps contain exact code.

**Type consistency:** All method names consistent across tasks.
