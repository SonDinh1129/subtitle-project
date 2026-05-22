# Handoff Note — Security & Bugfix Session (2026-05-23)

**Branch:** `kyutai-model`
**Session type:** Security audit + full fix implementation

---

## What was done

A full code review was performed across all backend (Flask) and frontend (React/TS) source files.
26 issues were found and triaged. All high/critical issues were fixed in 10 commits on this branch.

### Commits (newest → oldest)

| SHA | Message |
|-----|---------|
| `1b34439` | fix: clear fake-playhead interval on unmount, memoize filteredSubtitles |
| `64c3ea0` | fix: revoke blob URL on reset and unmount to prevent video memory leak |
| `85b3ca5` | fix: move video_path access inside try block in both pipeline functions |
| `f6e1045` | fix: IPN always returns 200, leap-year date fix, atomic DB update, strip signature from logs |
| `7963a27` | fix: add auth+ownership to export/video endpoints, fix ownership guard, wrap signed_url |
| `abfb8d8` | fix: guard JWT local decode, distinguish transient errors in get_profile |
| `1fc4aa0` | fix: singleton Supabase client in storage_repo, atomic cache update |
| `f744b5b` | fix: singleton Supabase client in jobs_repo, atomic cache update in update_job |
| `93bfe03` | fix: move load_vad+cleanup into create_app, add SECRET_KEY guard, add CSP header |
| `412215f` | security: remove real Supabase credentials from .env.example |

---

## ACTION REQUIRED — Do this before anything else

**The Supabase service role key and anon key were committed in `.env.example` in git history.**
They have been replaced with placeholders, but the old values are still in git history and must be considered compromised.

1. Go to Supabase dashboard → Settings → API
2. Regenerate the **service role key**
3. Regenerate the **anon/public key**
4. Update your `.env` and `.env.local` files with the new values
5. Update any CI/CD secrets, deployment configs, or other places these keys are used

---

## What each fix covers

### Security fixes

**`.env.example`** — Removed real `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. All now contain placeholder strings.

**`app.py`**
- Added `SECRET_KEY` guard: raises `RuntimeError` at startup if `SECRET_KEY` is unset and `FLASK_DEBUG != "true"`. Prevents running in production with the hardcoded dev key.
- Added `Content-Security-Policy` header restricting script/style/connect sources.

**`controllers/subtitle_controller.py`**
- `/api/exports/<filename>` — Added `@require_auth` and ownership check. Previously any unauthenticated user could download any exported video.
- `/api/video/<filename>` — Added ownership check. Previously any authenticated user could access another user's upload via IDOR.
- All 6 ownership guards changed from `if job.get("user_id") and job["user_id"] != g.user_id` to `if job.get("user_id") != g.user_id`. The old form skipped the check entirely when `user_id` was `None`.
- `get_srt_url` — Wrapped `signed_url()` call in try/except → returns 503 on Supabase error instead of 500.
- `optimize_job_subtitles` — Removed absolute server path from response body.

**`controllers/payment_controller.py`**
- IPN endpoint now always returns HTTP 200 (MoMo retries indefinitely on non-200, causing a retry storm).
- `signature` field stripped from all IPN log entries (prevents replay via log access).
- Leap-year crash fixed: `now.replace(year=now.year+1)` → `now + relativedelta(years=1)` (requires `python-dateutil`, added to `requirements.txt`).
- Both DB update calls in `payment_ipn` wrapped in single try/except.
- Payment record insert in `create_order` wrapped in try/except.

**`middleware/auth.py`**
- `_verify_user_id_with_local_jwt` — wrapped `jwt.decode` in try/except. Previously an exception from a malformed token escaped as unhandled 500.
- `get_profile` — now distinguishes Supabase "no rows" errors (returns `None` → 404) from transient connectivity errors (raises `RuntimeError` → callers return 503). Previously all errors silently returned `None`, masking DB outages as "Profile not found".

### Logic / crash fixes

**`app.py`**
- `load_vad()` and `start_cleanup_daemon()` moved inside `create_app()`. Previously they were in the `if __name__ == "__main__"` block, so VAD was never loaded when running under gunicorn, causing every transcription job to fail.

**`models/subtitle_model.py`**
- `run_pipeline` and `run_pipeline_realtime` — `video_path = job["video_path"]` moved inside the `try` block with a guard: `if not video_path: raise RuntimeError(...)`. Previously a server restart between job creation and pipeline execution caused a `KeyError` before the try block, leaving the job stuck in `queued` state forever.

### Performance / resource leak fixes

**`models/jobs_repo.py`**
- Singleton Supabase client with double-checked locking. Previously a new HTTP client was created on every DB call (dozens per video pipeline).
- `update_job` now holds `_jobs_lock` across the entire read-modify-write of the in-memory cache, preventing lost updates under concurrent calls.
- `get_job` slow path now checks `if job_id not in _jobs` before overwriting cache, preventing a stale DB read from overwriting a newer in-memory entry.

**`models/storage_repo.py`**
- Singleton Supabase client.
- `signed_url()` now safely tries multiple key names (`signedURL`, `signedUrl`, `signed_url`) instead of a hard `result["signedURL"]` that raises `KeyError` on Supabase client version differences.

**`src/app/pages/UploadPage.tsx`**
- `URL.revokeObjectURL` called when: (a) component unmounts with a blob URL, (b) user picks a second file, (c) user resets. Previously the video file buffer stayed pinned in memory for the tab's lifetime.

**`src/app/pages/EditorPage.tsx`**
- Fake-playhead `setInterval` stored in `fakePlayheadRef` and cleared on unmount. Previously navigating away while the fake playhead was running caused `setCurrentTime` calls on an unmounted component.
- `filteredSubtitles` wrapped in `useMemo([subtitles, searchTerm])`. Previously recomputed on every render tick including 60Hz `currentTime` updates.

---

## Known issues NOT fixed (require design decision)

| Issue | Reason not fixed |
|-------|-----------------|
| `change_password` requires no current-password confirmation | Supabase Admin API (`update_user_by_id`) does not re-verify the current password. Fixing this requires a frontend re-auth flow (e.g. sign-in modal before password change). |
| `delete_account` requires no re-authentication | Same — needs a re-auth confirmation step in the frontend. |
| JWT in SSE URL (`?token=...`) | `EventSource` API cannot send custom headers; the token in URL is unavoidable for SSE. Consider issuing a short-lived single-use SSE token server-side to reduce exposure window. |
| Rate limiter uses in-memory storage | Under multiple gunicorn workers each worker has its own counter. Fix by configuring `storage_uri="redis://..."` in `extensions.py`. |
| Free-tier limit check is non-atomic | The `videos_used >= 5` gate check and the `increment_video_count` RPC are two separate operations; concurrent uploads can bypass the limit. Fix by moving both into a single Postgres atomic RPC. |
| Unbounded in-memory job cache | `_jobs` dict in `jobs_repo.py` grows forever. Add TTL-based eviction or an LRU for long-running servers. |
| `export_burned_video` blocks Flask worker | FFmpeg export runs synchronously on the request thread. Should return 202 and run in a background task. |

---

## Files changed summary

```
.env.example
app.py
requirements.txt                        (added python-dateutil)
middleware/auth.py
controllers/subtitle_controller.py
controllers/auth_controller.py          (get_profile 503 handling)
controllers/payment_controller.py
models/jobs_repo.py
models/storage_repo.py
models/subtitle_model.py
src/app/pages/UploadPage.tsx
src/app/pages/EditorPage.tsx
```
