# Supabase Storage + Postgres `jobs` Migration

**Date:** 2026-05-22
**Status:** Draft — awaiting user review
**Scope:** Hybrid migration from local file storage (`uploads/`, `outputs/`, `jobs/*.json`) to Supabase Storage (files) + Postgres (metadata).

---

## 1. Motivation

Current state:

- Video, audio, SRT, exported MP4 all live on local disk (`uploads/`, `outputs/`).
- Job metadata persisted as JSON files in `jobs/{job_id}.json` plus in-memory `_jobs` dict.
- Files are lost on container restart; multi-instance deploy would split state across pods.
- No way to query "all jobs for user X" — would require directory scan.

Goal: persist long-lived artifacts and queryable metadata in Supabase, keep ephemeral pipeline workspace on local disk. Minimum disruption to existing pipeline code.

## 2. Scope

**In scope:**

- Bucket `subtitle-files` on Supabase Storage (private).
- Table `public.jobs` on Supabase Postgres.
- Upload SRT (en + vi) and burned-subtitle export MP4 to Storage at appropriate pipeline points.
- Refactor `create_job` / `get_job` / `update_job` to read/write Postgres instead of JSON files.
- Refactor `download_srt`, `export_video`, `download_exported_video` endpoints to serve via signed URLs.
- Delete local video + audio after pipeline completes; delete local SRT/export after configurable retention (7 days).

**Out of scope:**

- Uploading original video or intermediate audio to Storage.
- Splitting transcript/word data into a separate `job_results` table (deferred; TOAST handles oversized columns acceptably for current scale).
- Multi-instance correctness (sticky session assumed — see §10).
- Pre-signed direct browser-to-Storage upload (current `/api/upload` still streams through Flask, unchanged).

## 3. Storage layout

Bucket: `subtitle-files`, **private** (no public access).

Object key convention:

```
{user_id}/{job_id}/en.srt
{user_id}/{job_id}/vi.srt
{user_id}/{job_id}/export_{resolution}_{lang}.mp4
```

Examples:

```
87813ab3-dd37-.../46286bd8-.../en.srt
87813ab3-dd37-.../46286bd8-.../export_720p_vi.mp4
87813ab3-dd37-.../46286bd8-.../export_1080p_en.mp4
```

RLS: Storage bucket policies restrict `SELECT` to objects whose first path segment equals `auth.uid()::text`. Backend uses the service-role key to bypass RLS for writes.

## 4. Database schema

```sql
create table public.jobs (
  job_id            uuid primary key,
  user_id           uuid not null references auth.users(id) on delete cascade,

  filename          text not null,

  status            text not null check (
    status in (
      'queued',
      'extracting',
      'transcribing',
      'translating',
      'aligning',
      'generating_srt',
      'done',
      'error'
    )
  ),

  progress          int not null default 0 check (progress between 0 and 100),

  translation_mode  text not null,
  source_lang       text not null default 'en',

  english_text      text,
  vietnamese_text   text,
  english_words     jsonb,
  vietnamese_words  jsonb,

  en_srt_storage_path  text,
  vi_srt_storage_path  text,

  exports           jsonb not null default '{}'::jsonb,

  error             text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index jobs_user_created_idx on public.jobs(user_id, created_at desc);
create index jobs_user_status_idx  on public.jobs(user_id, status);

alter table public.jobs enable row level security;

create policy "owner reads own jobs"
  on public.jobs for select
  using (auth.uid() = user_id);

-- Writes go through the service-role key, so no client INSERT/UPDATE policy needed.

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_jobs_updated_at
before update on public.jobs
for each row execute function public.set_updated_at();
```

### Notes on schema decisions

- **`status` enum kept short.** `uploading` was considered as a separate state to cover the "DB done but Storage not yet written" race. Rejected: SRT upload takes <1s, would never be observable, and atomicity is guaranteed by code ordering (§7) — `status='done'` is only written *after* both Storage uploads succeed.
- **`exports jsonb`** keyed by `{resolution}_{lang}`. Example value:
  ```json
  {
    "720p_vi": {
      "path": "user_id/job_id/export_720p_vi.mp4",
      "created_at": "2026-05-22T10:00:00Z",
      "size": 123456789
    }
  }
  ```
  Enables idempotent re-export (§8).
- **Transcript + words kept in `jobs`.** Postgres TOAST stores oversized JSONB out-of-row; list queries that `SELECT job_id, filename, status, progress, created_at, updated_at, error` will not pay the cost. If list latency becomes a problem, extract to `job_results` later — cheap migration.
- **Two indexes**: `(user_id, created_at desc)` for history view, `(user_id, status)` for "active jobs" queries.

## 5. Pipeline lifecycle

| Stage | `uploads/` | `outputs/` | Storage | DB status |
|---|---|---|---|---|
| Job created | — | — | — | `queued` |
| Audio extract | video + audio | — | — | `extracting` |
| Transcribe / translate / align | video + audio | — | — | `transcribing` → `translating` → `aligning` |
| SRT generated locally | video + audio | en.srt, vi.srt | — | `generating_srt` |
| SRT uploaded | **deleted** | en.srt, vi.srt | en.srt, vi.srt | (intermediate, not persisted) |
| Pipeline finalize | — | en.srt, vi.srt | en.srt, vi.srt | `done` (with storage paths set) |
| `/api/export` called | — | export.mp4 (temp) | + export_{res}_{lang}.mp4 | (unchanged status) |
| After 7 days | — | SRT/export removed | retained | (unchanged) |

Failure path: any exception → `status='error'`, `error=str(exc)`. Local files left in place for inspection (cleanup will eventually remove them).

## 6. API surface changes

### `POST /api/upload`
Unchanged externally. Internally `create_job` now writes Postgres instead of JSON file.

### `GET /api/jobs/{id}` and `GET /api/jobs/{id}/stream`
Unchanged externally. `get_job` reads Postgres (via `_jobs` memory cache hit first for SSE hot path).

### `GET /api/download-srt?job_id=...&lang=en|vi` *(rename/replace existing `/download` route)*

**Before:** `send_file(local_path)`.
**After:** returns JSON:
```json
{ "url": "https://xnpieqombgbhgxpuxxrk.supabase.co/storage/v1/object/sign/...", "expires_in": 3600 }
```
Frontend triggers download via hidden `<a download href={url}>` or `window.location.href = url`.

Rationale for JSON over 302 redirect: avoids JWT exposure in `?token=` query (current SSE uses query-token because `EventSource` can't send headers — `<a>` would face the same constraint). JSON keeps `Authorization` header flow intact and gives the frontend a clear hook for error states (expired token, missing file).

### `POST /api/export`

Now:
1. Check `jobs.exports->'{resolution}_{lang}'` — if present and signed URL still works, return it.
2. Otherwise render burned-subtitle MP4 to local `outputs/`.
3. Upload to Storage.
4. Update `jobs.exports` via `jsonb_set`.
5. Delete local MP4.
6. Return signed URL.

### `GET /api/exports/{filename}`

Replaced by signed-URL response from `POST /api/export`. Direct `/api/exports/...` endpoint kept for 1 release cycle returning 404 with a note (unused once frontend updates).

### `GET /api/video/{filename}` (legacy)

Returns 404 after `status='done'` because the original video is deleted. Frontend already has `sessionStorage.videoPreviewUrl` (objectURL from the user's local file) for Editor preview, so this is acceptable. Document in code that this endpoint only works while the job is mid-pipeline (and only on the instance that received the upload).

## 7. Atomicity guarantee for "upload then mark done"

Postgres and Supabase Storage are separate systems — no cross-system transaction. The invariant we maintain:

> If `status='done'`, then `en_srt_storage_path` and `vi_srt_storage_path` are non-null AND the objects exist in Storage.

Enforced by code ordering in the pipeline finalize step:

```python
update_job(job_id, status='generating_srt', progress=90)

en_path = f"{user_id}/{job_id}/en.srt"
vi_path = f"{user_id}/{job_id}/vi.srt"

upload_to_storage(en_srt_local, en_path)   # raises on failure
upload_to_storage(vi_srt_local, vi_path)   # raises on failure

# Only reach this line if both uploads succeeded.
update_job(
    job_id,
    status='done',
    progress=100,
    en_srt_storage_path=en_path,
    vi_srt_storage_path=vi_path,
)
```

Failure modes covered:
- Upload throws → outer `try` sets `status='error'`. DB never claims `done`.
- DB update throws after uploads succeed → caught by outer `try`, status flips to `error`. Storage objects orphaned but harmless; cleanup script (§9) will remove via Storage lifecycle or on retry.
- Worker crashes between upload and DB update → job stuck in `generating_srt`. Acceptable for v1 (rare, manual reset). Future: a stale-job sweeper.

For `/api/export`, same ordering: upload to Storage → update `exports` JSONB → delete local file. If DB update fails, local file lingers (cleanup removes it later); Storage object orphaned (acceptable, key collision on re-export is safe because key is deterministic).

## 8. Idempotent export

When `POST /api/export` is called with `(resolution, lang)`:

1. `SELECT exports->'{res}_{lang}' FROM jobs WHERE job_id = ?`
2. If present:
   - Generate fresh signed URL from `path` field, return it.
   - Skip rendering entirely.
3. If absent: render → upload → store entry → return signed URL.

Storage path is deterministic per `(user_id, job_id, resolution, lang)`, so re-render after a delete is safe — same path overwrites cleanly.

## 9. Local cleanup

Two layers:

### Per-job cleanup (immediate)
At the end of each successful pipeline (`run_pipeline`, `run_pipeline_realtime`):
- Delete `uploads/{job_id}_{filename}` (original video).
- Delete `uploads/{job_id}_audio.wav`.
- Keep `outputs/{job_id}_*.srt` (frontend may still hit it before Storage signed URL takes over — not strictly required, but cheap insurance for the first hour).

### Periodic cleanup (deferred)
Function `cleanup_local_outputs(retention_days=7)`:
- Scan `outputs/` and `uploads/` for files with mtime older than retention.
- Delete local files only.
- **Never touch Storage objects.**

Triggered by:
- Once at Flask app startup (in a background thread, non-blocking).
- Every 24h via a daemon thread.

This is acceptable for single-instance deploy. Production with multiple instances or serverless should replace this with an external cron — documented as a TODO in the cleanup function docstring.

## 10. Known limitations (acknowledged, not fixed in this PR)

### Multi-instance SSE inconsistency
`_jobs` memory cache and `_job_event_queues` are per-process. If instance A receives `POST /upload` and instance B receives `GET /jobs/{id}/stream`, B reads the job from Postgres correctly but never receives event-queue updates → progress bar appears frozen.

**Mitigation for now:** assume single-instance deploy or sticky session at the LB. If/when multi-instance is needed, migrate `_job_event_queues` to Supabase Realtime (subscribe to `jobs:{id}` channel) and have the DB trigger publish on UPDATE.

### Orphan Storage objects
If pipeline crashes between Storage upload and DB update, the SRT/MP4 in Storage has no DB pointer. No automatic reaper in v1 — manual cleanup if it becomes a problem.

### Signed URL expiry mid-download
1-hour signed URL is generous for SRT (KB) and burned-export (MB). For very large exports on slow connections, user may hit expiry. Acceptable; frontend can re-request.

## 11. Migration steps (for implementation plan)

1. **Supabase setup** (manual, in dashboard):
   - Create bucket `subtitle-files` (private).
   - Run DDL from §4 in SQL Editor.
   - Verify RLS policy.
2. **Backend — DB layer:**
   - Add `models/jobs_repo.py` with `create_job`, `get_job`, `update_job` backed by Postgres.
   - Keep `_jobs` memory cache as a write-through layer (for SSE hot path).
   - Remove `JOBS_DIR` and `_persist_job` JSON writes (keep directory existing for backward-compat reads during transition? No — fresh start, no migration of old JSON jobs).
3. **Backend — Storage layer:**
   - Add `models/storage.py` with `upload_to_storage(local_path, storage_path)` and `signed_url(storage_path, expires_in=3600)`.
4. **Backend — pipeline:**
   - Modify `run_pipeline` and `run_pipeline_realtime` to upload SRT and update DB atomically per §7.
   - Add per-job cleanup of video + audio after success.
5. **Backend — endpoints:**
   - Refactor `download_srt`, `export_video`, `download_exported_video` per §6.
6. **Backend — cleanup daemon:**
   - Add `cleanup_local_outputs(retention_days=7)`, wire to app start.
7. **Frontend:**
   - Update SRT download to consume JSON `{url}` response.
   - Update export download path similarly.
   - No change to upload flow.
8. **Verification:**
   - Manual: upload → wait for done → check `outputs/` retained, `uploads/` cleaned, Storage contains both SRTs, `jobs` row has paths set.
   - Manual: re-export same `(res, lang)` → confirm no re-render (log-based).
   - Manual: download SRT → confirm signed URL works in browser.

## 12. Open questions

None — all design decisions resolved in the brainstorming pass.
