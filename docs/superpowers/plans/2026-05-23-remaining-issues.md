# Remaining Issues Fix Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 7 known issues left after the 2026-05-23 security session: delete-account re-auth, short-lived SSE token, Redis rate limiter, atomic free-tier gate, LRU job cache, and async video export.

**Architecture:** Each fix is self-contained. Backend changes are in Flask controllers/models. One new Postgres RPC is needed (atomic free-tier gate). Frontend changes are minimal (delete re-auth, SSE token fetch). The export async flow adds a lightweight in-memory export-job registry — no new DB table needed.

**Tech Stack:** Flask 3, Supabase (Postgres + Auth), PyJWT, Flask-Limiter, Redis (optional), React 18 + TypeScript, python-ffmpeg

---

## Scope Note — Issue 1 already resolved

`change_password` re-auth is **already implemented** in `ProfilePage.tsx` (lines 78–85): it calls `supabase.auth.signInWithPassword` before the backend call. No action needed.

---

## File map

| File | Change |
|------|--------|
| `src/app/pages/ProfilePage.tsx` | Add password re-auth before `deleteAccount()` |
| `controllers/auth_controller.py` | Add `POST /api/auth/sse-token` endpoint |
| `src/lib/api.ts` | Add `getSseToken()`, update `openRealtimeStream()` |
| `extensions.py` | Read `REDIS_URL` env var, fall back to memory |
| `.env.example` | Document `REDIS_URL` |
| `controllers/subtitle_controller.py` | Replace two-step free-tier check with atomic RPC |
| `docs/supabase-setup.sql` | Add `check_and_increment_video_count` RPC |
| `models/jobs_repo.py` | Add TTL eviction for `_jobs` cache |
| `models/subtitle_model.py` | `export_burned_video` stays sync (called from bg thread now) |
| `controllers/subtitle_controller.py` | `export_video` → 202 + background thread, add `GET /export-status/<id>` |

---

## Task 1: Delete-account password re-auth

**Files:**
- Modify: `src/app/pages/ProfilePage.tsx:103-121`

The `handleDeleteAccount` function currently only checks that the user typed their email correctly. We need to also require a password, verify it via Supabase `signInWithPassword`, and only then call the backend `deleteAccount()`.

- [ ] **Step 1: Add `deletePassword` state**

In `ProfilePage.tsx`, after line 31 (`const [deleteLoading...`), add:

```typescript
  const [deletePassword, setDeletePassword] = useState('')
```

- [ ] **Step 2: Add password verification before deleteAccount call**

Replace the entire `handleDeleteAccount` function (lines 103–121):

```typescript
  async function handleDeleteAccount(e: React.FormEvent) {
    e.preventDefault()
    setDeleteFeedback(null)
    setDeleteLoading(true)
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user?.email ?? '',
        password: deletePassword,
      })
      if (signInError) {
        setDeleteFeedback({ type: 'error', message: isVi ? 'Mật khẩu không đúng' : 'Incorrect password' })
        return
      }
      const res = await deleteAccount()
      if (res.ok) {
        await signOut()
        navigate('/')
      } else {
        const data = await res.json()
        setDeleteFeedback({ type: 'error', message: data.error ?? (isVi ? 'Có lỗi xảy ra' : 'Something went wrong') })
      }
    } catch {
      setDeleteFeedback({ type: 'error', message: isVi ? 'Có lỗi xảy ra' : 'Something went wrong' })
    } finally {
      setDeleteLoading(false)
    }
  }
```

- [ ] **Step 3: Add password input field to the delete form**

In the delete form JSX, after the email confirm `<div className="space-y-1">` block (after line ~261) and before `{deleteFeedback && ...}`, add:

```tsx
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {isVi ? 'Mật khẩu của bạn' : 'Your Password'}
              </label>
              <input
                type="password"
                value={deletePassword}
                onChange={e => setDeletePassword(e.target.value)}
                placeholder={isVi ? 'Nhập mật khẩu để xác nhận' : 'Enter password to confirm'}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
```

- [ ] **Step 4: Update button disabled condition**

Find the delete button (around line 264–267). The `disabled` prop currently is:
```tsx
disabled={deleteLoading || deleteConfirmEmail !== user?.email}
```
Change to:
```tsx
disabled={deleteLoading || deleteConfirmEmail !== user?.email || !deletePassword}
```

- [ ] **Step 5: Verify build**

```bash
npm run build
```
Expected: no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/pages/ProfilePage.tsx
git commit -m "fix: require password confirmation before account deletion"
```

---

## Task 2: Short-lived SSE token endpoint (backend)

**Files:**
- Modify: `controllers/auth_controller.py`

Add `POST /api/auth/sse-token` which generates a short-lived (60s) JWT signed with `SUPABASE_JWT_SECRET`. The SSE stream endpoint already accepts `?token=` and validates it via `_verify_user_id_with_local_jwt`. We reuse that same validation path — a 60s token is safe because the `EventSource` connects immediately.

- [ ] **Step 1: Read the current imports at the top of `controllers/auth_controller.py`**

Current imports (lines 1–12):
```python
from flask import Blueprint, g, jsonify, request
from middleware.auth import require_auth, get_profile, is_premium, _get_supabase_service
from extensions import limiter
```

- [ ] **Step 2: Add the SSE token endpoint**

Append to the end of `controllers/auth_controller.py`:

```python

import jwt as _jwt
import time
import os as _os

@auth_bp.post('/sse-token')
@require_auth
@limiter.limit("30/minute")
def get_sse_token():
    """
    POST /api/auth/sse-token
    Issues a short-lived (60s) JWT for use as ?token= on EventSource SSE connections.
    The SSE stream endpoint validates this via _verify_user_id_with_local_jwt.
    """
    jwt_secret = _os.getenv('SUPABASE_JWT_SECRET')
    if not jwt_secret:
        return jsonify({'error': 'SSE tokens not available (SUPABASE_JWT_SECRET not set)'}), 503

    now = int(time.time())
    payload = {
        'sub': g.user_id,
        'aud': 'authenticated',
        'iat': now,
        'exp': now + 60,
    }
    token = _jwt.encode(payload, jwt_secret, algorithm='HS256')
    return jsonify({'token': token, 'expires_in': 60}), 200
```

- [ ] **Step 3: Verify Python syntax**

```bash
python -m py_compile controllers/auth_controller.py && echo OK
```
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add controllers/auth_controller.py
git commit -m "feat: add POST /api/auth/sse-token for short-lived SSE authentication"
```

---

## Task 3: Frontend uses SSE token (api.ts)

**Files:**
- Modify: `src/lib/api.ts:237-272`

`openRealtimeStream` currently puts the long-lived Supabase session token (`session.access_token`) directly in the SSE URL. Replace with a call to the new `/api/auth/sse-token` endpoint to get a 60-second token.

- [ ] **Step 1: Add `getSseToken` helper**

In `src/lib/api.ts`, after the `getSrtUrl` function (after line ~317), add:

```typescript
/** POST /api/auth/sse-token — returns a 60s JWT for EventSource ?token= param. */
async function getSseToken(): Promise<string> {
  const res = await authFetch('/auth/sse-token', { method: 'POST' })
  if (!res.ok) throw new Error(`SSE token fetch failed (${res.status})`)
  const data = await res.json() as { token: string }
  return data.token
}
```

- [ ] **Step 2: Update `openRealtimeStream` to use short-lived token**

Replace the entire `openRealtimeStream` function (lines 237–272):

```typescript
export async function openRealtimeStream(
  jobId: string,
  handlers: {
    onEvent: (evt: RealtimeStreamEvent) => void;
    onError?: (err: Event) => void;
  },
): Promise<EventSource> {
  let token = ''
  try {
    token = await getSseToken()
  } catch {
    // Fall back to session token if SSE token endpoint unavailable
    const { data: { session } } = await supabase.auth.getSession()
    token = session?.access_token ?? ''
  }
  const url = token
    ? `${BASE}/jobs/${jobId}/stream?token=${encodeURIComponent(token)}`
    : `${BASE}/jobs/${jobId}/stream`
  const stream = new EventSource(url)

  stream.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data) as RealtimeStreamEvent
      handlers.onEvent(payload)
      if (payload.type === 'done' || payload.type === 'error') {
        stream.close()
      }
    } catch {
      handlers.onEvent({
        type: 'error',
        message: 'Invalid stream payload from server.',
      })
      stream.close()
    }
  }

  stream.onerror = (err) => {
    handlers.onError?.(err)
  }

  return stream
}
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/api.ts
git commit -m "feat: use short-lived SSE token instead of long-lived session JWT in EventSource URL"
```

---

## Task 4: Redis-backed rate limiter

**Files:**
- Modify: `extensions.py`
- Modify: `.env.example`

Flask-Limiter with `storage_uri="memory://"` gives each gunicorn worker its own counter — 4 workers means each user gets 4× the limit. Switch to Redis when `REDIS_URL` is set; fall back to memory for local dev.

- [ ] **Step 1: Update `extensions.py`**

Replace the entire file content:

```python
"""
extensions.py — Shared Flask extensions (avoid circular imports)
"""
import os
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

limiter = Limiter(
    get_remote_address,
    default_limits=["200/hour"],
    storage_uri=os.getenv("REDIS_URL", "memory://"),
)
```

- [ ] **Step 2: Document in `.env.example`**

Open `.env.example` and add after the last existing line:

```
# Optional: Redis URL for rate limiter shared across gunicorn workers.
# Without this, each worker has its own counter (limits multiply by worker count).
# Example: redis://localhost:6379/0
REDIS_URL=
```

- [ ] **Step 3: Verify Python syntax**

```bash
python -m py_compile extensions.py && echo OK
```
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add extensions.py .env.example
git commit -m "fix: rate limiter reads REDIS_URL env var, falls back to memory for dev"
```

---

## Task 5: Atomic free-tier gate (Postgres RPC + backend)

**Files:**
- Modify: `docs/supabase-setup.sql`
- Modify: `controllers/subtitle_controller.py:165-188`

Currently: read `videos_used_this_month` from profile cache → check ≥ 5 → (if allowed) call `increment_video_count`. Two concurrent uploads can both read the same count, both pass, both increment.

Fix: one atomic Postgres function `check_and_increment_video_count(uid, limit)` that checks + increments inside a single `UPDATE ... RETURNING` with a `WHERE videos_used_this_month < limit`. Returns the new count or `NULL` if blocked.

- [ ] **Step 1: Add the SQL function to `docs/supabase-setup.sql`**

Append to the end of `docs/supabase-setup.sql`:

```sql
-- Atomically check the free-tier video limit and increment if allowed.
-- Returns the new videos_used_this_month value if the increment succeeded,
-- or NULL if the user has already reached the limit.
-- Must be run in Supabase SQL Editor to deploy.
CREATE OR REPLACE FUNCTION check_and_increment_video_count(uid uuid, lim int DEFAULT 5)
RETURNS int AS $$
DECLARE
  new_count int;
BEGIN
  UPDATE profiles
  SET videos_used_this_month = videos_used_this_month + 1
  WHERE id = uid
    AND videos_used_this_month < lim
  RETURNING videos_used_this_month INTO new_count;
  RETURN new_count;  -- NULL if no row was updated (limit reached)
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

- [ ] **Step 2: Deploy the SQL function**

Run the above SQL in the Supabase SQL Editor (Dashboard → SQL Editor → New query → paste → Run).

> Note: This is a manual deployment step. The `.sql` file is the source of truth.

- [ ] **Step 3: Replace the two-step check in `subtitle_controller.py`**

Find this block (lines ~165–188):

```python
    # Gate: free tier video limit (5/month)
    videos_used = profile.get("videos_used_this_month", 0)
    if not premium and videos_used >= 5:
        return jsonify({"error": "Monthly video limit reached (5/month)", "code": "LIMIT_REACHED"}), 403
```

And this block (lines ~184–188):

```python
    # Increment usage counter atomically
    try:
        _get_supabase_service().rpc("increment_video_count", {"uid": g.user_id}).execute()
    except Exception:
        pass  # Non-fatal
```

Replace both blocks with:

```python
    # Gate: free tier video limit — atomic check+increment in Postgres
    if not premium:
        try:
            result = _get_supabase_service().rpc(
                "check_and_increment_video_count",
                {"uid": g.user_id, "lim": 5},
            ).execute()
            new_count = result.data  # None means limit was reached
            if new_count is None:
                return jsonify({"error": "Monthly video limit reached (5/month)", "code": "LIMIT_REACHED"}), 403
        except Exception:
            current_app.logger.exception("check_and_increment_video_count failed for user %s", g.user_id)
            return jsonify({"error": "Service temporarily unavailable"}), 503
```

- [ ] **Step 4: Verify Python syntax**

```bash
python -m py_compile controllers/subtitle_controller.py && echo OK
```
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add docs/supabase-setup.sql controllers/subtitle_controller.py
git commit -m "fix: atomic free-tier gate via check_and_increment_video_count Postgres RPC"
```

---

## Task 6: TTL eviction for in-memory job cache

**Files:**
- Modify: `models/jobs_repo.py`

`_jobs` grows unbounded — every job ever created by any user stays in memory until the server restarts. Add a TTL of 2 hours: jobs are evicted from the in-memory dict 2 hours after they were created. The pipeline always finishes within minutes; SSE is only needed during the pipeline. After 2h, `get_job` falls back to Postgres (the slow path already exists).

- [ ] **Step 1: Add `_job_timestamps` tracking and `_evict_stale_jobs` helper**

In `models/jobs_repo.py`, after the existing dict declarations (after line 39):

```python
import time as _time

_job_timestamps: dict[str, float] = {}  # job_id → creation epoch seconds
_JOB_CACHE_TTL = 7200  # 2 hours


def _evict_stale_jobs() -> None:
    """Remove jobs older than _JOB_CACHE_TTL from the in-memory cache.
    Must be called with _jobs_lock held.
    """
    cutoff = _time.monotonic() - _JOB_CACHE_TTL
    stale = [jid for jid, ts in _job_timestamps.items() if ts < cutoff]
    for jid in stale:
        _jobs.pop(jid, None)
        _job_timestamps.pop(jid, None)
```

- [ ] **Step 2: Record timestamp on `create_job`**

In `create_job`, after the line `_jobs[job_id] = dict(row)` (inside the `with _jobs_lock:` block), add:

```python
        _job_timestamps[job_id] = _time.monotonic()
```

- [ ] **Step 3: Record timestamp and run eviction in `get_job` slow path**

In `get_job`, inside the `with _jobs_lock:` block in the slow path (the `if job_id not in _jobs:` branch), after setting `_jobs[job_id] = dict(row)`, add:

```python
                _job_timestamps[job_id] = _time.monotonic()
                _evict_stale_jobs()
```

- [ ] **Step 4: Verify Python syntax**

```bash
python -m py_compile models/jobs_repo.py && echo OK
```
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add models/jobs_repo.py
git commit -m "fix: add 2-hour TTL eviction for in-memory job cache to prevent unbounded growth"
```

---

## Task 7: Async video export (202 + background thread)

**Files:**
- Modify: `controllers/subtitle_controller.py`

`export_video()` currently calls `export_burned_video()` synchronously on the Flask worker thread. FFmpeg for a 10-minute 1080p video can take 2–5 minutes, tying up the worker.

Fix: return `202 Accepted` immediately with an `export_id`, run FFmpeg in a daemon thread, expose `GET /api/export-status/<export_id>` to poll. Use a module-level `_exports` dict (same pattern as `_jobs`).

- [ ] **Step 1: Add the `_exports` registry at the top of the subtitle_controller.py imports section**

Near the top of `controllers/subtitle_controller.py`, after the existing imports (around line 12, after `import threading`), add:

```python
import uuid as _uuid

# In-memory export registry: export_id → {"status": "pending"|"done"|"error", "filename"?: str, "error"?: str}
_exports: dict[str, dict] = {}
_exports_lock = threading.Lock()
```

- [ ] **Step 2: Rewrite `export_video` to return 202 and dispatch a background thread**

Replace the entire `export_video` function (lines ~362–398):

```python
@subtitle_bp.post("/export")
@require_auth
def export_video():
    """Start async export. Returns 202 with export_id; poll GET /export-status/<export_id>."""
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
    if job.get("user_id") != g.user_id:
        return jsonify({"error": "Forbidden"}), 403
    if job.get("status") != JobStatus.DONE:
        return jsonify({"error": f"Job not ready (status: {job.get('status')})"}), 409

    export_id = str(_uuid.uuid4())
    with _exports_lock:
        _exports[export_id] = {"status": "pending"}

    def _run(app, eid, j, res, lng):
        with app.app_context():
            try:
                output_path = export_burned_video(j, resolution=res, lang=lng)
                filename = Path(output_path).name
                with _exports_lock:
                    _exports[eid] = {"status": "done", "filename": filename}
            except Exception as exc:
                with _exports_lock:
                    _exports[eid] = {"status": "error", "error": str(exc)}

    threading.Thread(
        target=_run,
        args=(current_app._get_current_object(), export_id, job, resolution, lang),
        daemon=True,
    ).start()

    return jsonify({"export_id": export_id, "status": "pending"}), 202
```

- [ ] **Step 3: Add `GET /export-status/<export_id>` poll endpoint**

Immediately after the rewritten `export_video` function, add:

```python
@subtitle_bp.get("/export-status/<export_id>")
@require_auth
def get_export_status(export_id: str):
    """Poll async export status. Returns status + download_url when done."""
    with _exports_lock:
        entry = _exports.get(export_id)
    if not entry:
        return jsonify({"error": "Export not found"}), 404
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
```

- [ ] **Step 4: Update `src/lib/api.ts` — exportVideo returns 202, add pollExportStatus**

In `src/lib/api.ts`, update the `ExportResponse` type and `exportVideo` function, and add a new `pollExportStatus` function.

Replace `ExportResponse` interface (around line 163):

```typescript
export interface ExportResponse {
  export_id: string;
  status: "pending" | "done" | "error";
  filename?: string;
  download_url?: string;
  error?: string;
}
```

Replace the `exportVideo` function (around line 323–337):

```typescript
/**
 * POST /api/export
 * Starts async export. Returns 202 with export_id immediately.
 * Poll getExportStatus until status === "done".
 */
export async function exportVideo(
  jobId: string,
  resolution: ExportResolution,
  lang: SubtitleLang,
): Promise<ExportResponse> {
  const res = await authFetch(`/export`, {
    method: "POST",
    body: JSON.stringify({ job_id: jobId, resolution, lang }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Export failed (${res.status}): ${text}`);
  }
  return res.json();
}

/** GET /api/export-status/:exportId — poll until status is "done" or "error". */
export async function getExportStatus(exportId: string): Promise<ExportResponse> {
  const res = await authFetch(`/export-status/${exportId}`);
  if (!res.ok) throw new Error(`Export status check failed (${res.status})`);
  return res.json();
}

/** Poll export status until done or error. Returns the final ExportResponse. */
export function pollExportUntilDone(
  exportId: string,
  onUpdate?: (r: ExportResponse) => void,
  intervalMs = 2000,
): Promise<ExportResponse> {
  return new Promise((resolve, reject) => {
    const id = setInterval(async () => {
      try {
        const r = await getExportStatus(exportId)
        onUpdate?.(r)
        if (r.status === "done") { clearInterval(id); resolve(r) }
        if (r.status === "error") { clearInterval(id); reject(new Error(r.error ?? "Export failed")) }
      } catch (err) {
        clearInterval(id)
        reject(err)
      }
    }, intervalMs)
  })
}
```

- [ ] **Step 5: Update `EditorPage.tsx` export flow to poll after 202**

Find the export handler in `src/app/pages/EditorPage.tsx`. Search for `exportVideo` usage. Replace the single `await exportVideo(...)` call with a two-step flow: start export, then poll.

Find the block that calls `exportVideo` and uses the result's `download_url`. It will look roughly like:

```typescript
const result = await exportVideo(jobId, resolution, lang)
// then uses result.download_url or result.filename
```

Replace it with:

```typescript
const started = await exportVideo(jobId, resolution, lang)
const result = await pollExportUntilDone(
  started.export_id,
  (r) => { /* optional: update loading message */ },
)
```

Then use `result.download_url` and `result.filename` as before (same field names, just now filled when `status === "done"`).

- [ ] **Step 6: Add `pollExportUntilDone` and `getExportStatus` to imports in `EditorPage.tsx`**

Find the import line in `EditorPage.tsx` that imports from `../../lib/api`. Add `getExportStatus` and `pollExportUntilDone` to the named imports.

- [ ] **Step 7: Verify Python syntax and frontend build**

```bash
python -m py_compile controllers/subtitle_controller.py && echo Python OK
npm run build
```
Expected: `Python OK`, then Vite build success with no errors.

- [ ] **Step 8: Commit**

```bash
git add controllers/subtitle_controller.py src/lib/api.ts src/app/pages/EditorPage.tsx
git commit -m "feat: async video export — POST /export returns 202, poll GET /export-status/:id"
```

---

## Self-Review

### Spec coverage

| Issue | Task |
|-------|------|
| delete_account re-auth | Task 1 ✅ |
| SSE JWT exposure | Tasks 2 + 3 ✅ |
| Rate limiter Redis | Task 4 ✅ |
| Free-tier non-atomic | Task 5 ✅ |
| Unbounded job cache | Task 6 ✅ |
| export blocks worker | Task 7 ✅ |
| change_password re-auth | Already fixed in ProfilePage.tsx — no task needed ✅ |

### Placeholder scan

No TBD, no "add error handling", no "similar to Task N" found. All code blocks are complete.

### Type consistency

- `ExportResponse` updated in `api.ts` (Task 7 Step 4) and consumed consistently in `exportVideo`, `getExportStatus`, `pollExportUntilDone`.
- `getSseToken` defined in Task 3 Step 1, used in `openRealtimeStream` in Task 3 Step 2.
- `check_and_increment_video_count` SQL function name matches Python RPC call in Task 5.
- `_exports` dict declared in Task 7 Step 1, used in Steps 2 and 3.
- `_job_timestamps` declared in Task 6 Step 1, written in Steps 2 and 3, read in `_evict_stale_jobs`.
