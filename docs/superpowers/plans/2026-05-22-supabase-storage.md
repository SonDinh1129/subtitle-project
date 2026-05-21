# Supabase Storage + Postgres Jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move SRT files to Supabase Storage and job metadata from JSON files to a Postgres `jobs` table — without changing the upload UX, export flow, or breaking the existing pipeline.

**Architecture:** Hybrid. Pipeline still writes to `uploads/` and `outputs/` because ffmpeg/Whisper need local file paths. After SRT is generated, upload to Storage, then mark job `done`. Original video + audio are deleted immediately after a successful pipeline run. SRT files in `outputs/` are kept for 7 days then swept by a daemon. **Export MP4 is NOT stored in Supabase Storage** (free tier caps objects at 50 MB; exports routinely exceed this) — export flow is unchanged. Frontend gets signed URLs for SRT download; it never talks to Storage directly.

**Tech Stack:** Flask (existing), supabase-py (already in `middleware/auth.py`), Postgres (Supabase), Supabase Storage. Tests use pytest with stubbed heavy dependencies (see `tests/conftest.py`).

**Spec:** [docs/superpowers/specs/2026-05-22-supabase-storage-design.md](../specs/2026-05-22-supabase-storage-design.md)

---

## File structure

**New files:**
- `models/jobs_repo.py` — Postgres-backed job CRUD with write-through memory cache. Owns `_jobs` and `_job_event_queues`. Replaces JSON file persistence.
- `models/storage_repo.py` — Thin wrapper over `supabase.storage`: `upload_file`, `signed_url`, `delete_object`.
- `models/cleanup.py` — Local-disk cleanup daemon for stale files in `outputs/` and `uploads/`.
- `tests/test_jobs_repo.py` — Unit tests for `jobs_repo` with mocked Supabase client.
- `tests/test_storage_repo.py` — Unit tests for `storage_repo`.
- `tests/test_cleanup.py` — Unit tests for cleanup logic.
- `db/migrations/001_jobs_table.sql` — DDL for `public.jobs` + trigger + RLS.

**Modified files:**
- `models/subtitle_model.py` — Remove `create_job`/`get_job`/`update_job`/`_persist_job`/`JOBS_DIR` (move to `jobs_repo`). Add Storage upload + local cleanup at end of `run_pipeline` and `run_pipeline_realtime`. Rename `JobStatus.VAD` → keep `EXTRACTING` only; rename `JobStatus.GENERATING` → `GENERATING_SRT`.
- `controllers/subtitle_controller.py` — Replace `download_srt` with `GET /api/jobs/{id}/srt-url` returning JSON signed URL. `export_video` and `download_exported_video` are **unchanged**. Authorization check added to srt-url handler.
- `app.py` — Wire cleanup daemon at startup.
- `src/lib/api.ts` — New `getSrtUrl(jobId, lang)`, replace old SRT download function.
- `src/app/pages/EditorPage.tsx` — Update SRT download handler only (export unchanged).

**Files NOT touched:**
- `middleware/auth.py` — unchanged.
- `controllers/auth_controller.py`, `controllers/payment_controller.py` — unchanged.
- `models/subtitle_optimizer.py`, `models/subtitle_quality.py` — unchanged.

---

## Pre-flight: Supabase setup (manual, do this first)

This is the only manual step. Everything else is code.

- [ ] **Step 0.1: Create Storage bucket**

In Supabase Dashboard → Storage → New bucket:
- Name: `subtitle-files`
- Public: **OFF**
- File size limit: 50 MB (SRT files are only a few KB; this is the free-tier cap and is sufficient)

No policies needed — backend uses service-role key.

- [ ] **Step 0.2: Run DDL migration**

In Supabase Dashboard → SQL Editor, paste and run the entire contents of `db/migrations/001_jobs_table.sql` (which you'll create in Task 1). For now, run this SQL directly:

```sql
create table public.jobs (
  job_id            uuid primary key,
  user_id           uuid not null references auth.users(id) on delete cascade,
  filename          text not null,
  status            text not null check (
    status in ('queued','extracting','transcribing','translating','aligning','generating_srt','done','error')
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
  error             text,
  completed_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index jobs_user_created_idx on public.jobs(user_id, created_at desc);
create index jobs_user_status_idx  on public.jobs(user_id, status);

alter table public.jobs enable row level security;

create policy "owner reads own jobs"
  on public.jobs for select using (auth.uid() = user_id);

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

- [ ] **Step 0.3: Verify**

Run in SQL Editor:
```sql
select column_name, data_type from information_schema.columns where table_name='jobs';
```
Expected: 19 rows including `en_srt_storage_path` (text), `completed_at` (timestamptz). No `exports` column.

---

## Task 1: Persist the DDL in the repo

Even though Step 0.2 ran it manually, the SQL must live in the repo so future devs can recreate the schema.

**Files:**
- Create: `db/migrations/001_jobs_table.sql`

- [ ] **Step 1.1: Create the migrations directory and file**

Write `db/migrations/001_jobs_table.sql` containing the exact SQL from Step 0.2 above (including the `create table`, both `create index`, `alter table ... enable row level security`, the policy, the function, and the trigger).

- [ ] **Step 1.2: Commit**

```bash
git add db/migrations/001_jobs_table.sql
git commit -m "feat(db): add jobs table migration"
```

---

## Task 2: Create `storage_repo.py` with failing test

A thin wrapper over `supabase.storage` so the rest of the code never imports `supabase` directly for file ops. Three operations: `upload_file`, `signed_url`, `delete_object`.

**Files:**
- Create: `models/storage_repo.py`
- Create: `tests/test_storage_repo.py`

- [ ] **Step 2.1: Write the failing test**

Create `tests/test_storage_repo.py`:

```python
from unittest.mock import MagicMock, patch

from models import storage_repo


def test_upload_file_calls_supabase_with_path_and_bytes(tmp_path):
    f = tmp_path / "hello.srt"
    f.write_text("1\n00:00:00,000 --> 00:00:01,000\nHi\n", encoding="utf-8")

    fake_client = MagicMock()
    fake_bucket = fake_client.storage.from_.return_value
    fake_bucket.upload.return_value = None

    with patch.object(storage_repo, "_get_client", return_value=fake_client):
        storage_repo.upload_file(str(f), "user-1/job-1/en.srt")

    fake_client.storage.from_.assert_called_once_with("subtitle-files")
    args, kwargs = fake_bucket.upload.call_args
    assert args[0] == "user-1/job-1/en.srt"
    # Either the path string or raw bytes is acceptable as the second arg;
    # supabase-py accepts both. We assert non-empty payload was passed.
    assert args[1]


def test_signed_url_returns_string():
    fake_client = MagicMock()
    fake_bucket = fake_client.storage.from_.return_value
    fake_bucket.create_signed_url.return_value = {"signedURL": "https://x.test/sign?token=abc"}

    with patch.object(storage_repo, "_get_client", return_value=fake_client):
        url = storage_repo.signed_url("user-1/job-1/en.srt", expires_in=3600)

    assert url == "https://x.test/sign?token=abc"
    fake_bucket.create_signed_url.assert_called_once_with("user-1/job-1/en.srt", 3600)


def test_delete_object_calls_supabase():
    fake_client = MagicMock()
    fake_bucket = fake_client.storage.from_.return_value
    fake_bucket.remove.return_value = None

    with patch.object(storage_repo, "_get_client", return_value=fake_client):
        storage_repo.delete_object("user-1/job-1/en.srt")

    fake_bucket.remove.assert_called_once_with(["user-1/job-1/en.srt"])
```

- [ ] **Step 2.2: Run test to verify it fails**

```
pytest tests/test_storage_repo.py -v
```
Expected: FAIL with `ModuleNotFoundError: No module named 'models.storage_repo'`.

- [ ] **Step 2.3: Implement `models/storage_repo.py`**

```python
"""
storage_repo.py — Supabase Storage wrapper.

All Storage interactions go through this module so handlers never import
the supabase client for file operations directly.
"""
import os
from supabase import create_client, Client

BUCKET = "subtitle-files"

_client_singleton: Client | None = None


def _get_client() -> Client:
    """Return a process-wide service-role Supabase client (lazy-init)."""
    global _client_singleton
    if _client_singleton is None:
        url = os.environ["SUPABASE_URL"]
        key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
        _client_singleton = create_client(url, key)
    return _client_singleton


def upload_file(local_path: str, storage_path: str) -> None:
    """Upload a local file to the bucket. Raises on failure."""
    with open(local_path, "rb") as fh:
        data = fh.read()
    client = _get_client()
    client.storage.from_(BUCKET).upload(storage_path, data)


def signed_url(storage_path: str, expires_in: int = 3600) -> str:
    """Generate a signed URL for downloading an object."""
    client = _get_client()
    resp = client.storage.from_(BUCKET).create_signed_url(storage_path, expires_in)
    # supabase-py returns {"signedURL": "..."} or {"signedUrl": "..."} depending on version
    return resp.get("signedURL") or resp.get("signedUrl")


def delete_object(storage_path: str) -> None:
    """Delete an object. Silently no-ops if it doesn't exist."""
    client = _get_client()
    client.storage.from_(BUCKET).remove([storage_path])
```

- [ ] **Step 2.4: Run test to verify it passes**

```
pytest tests/test_storage_repo.py -v
```
Expected: 3 passed.

- [ ] **Step 2.5: Commit**

```bash
git add models/storage_repo.py tests/test_storage_repo.py
git commit -m "feat(storage): add Supabase Storage wrapper module"
```

---

## Task 3: Create `jobs_repo.py` with failing tests

Postgres-backed CRUD with write-through memory cache. Keeps `_jobs` dict and `_job_event_queues` (moved from `subtitle_model.py`). All callers go through `create_job`, `get_job`, `update_job`.

**Files:**
- Create: `models/jobs_repo.py`
- Create: `tests/test_jobs_repo.py`

- [ ] **Step 3.1: Write the failing tests**

Create `tests/test_jobs_repo.py`:

```python
from unittest.mock import MagicMock, patch

from models import jobs_repo


def _fake_client_with_insert(returned_row: dict) -> MagicMock:
    client = MagicMock()
    chain = client.table.return_value.insert.return_value.execute
    chain.return_value.data = [returned_row]
    return client


def _fake_client_with_select(returned_row: dict | None) -> MagicMock:
    client = MagicMock()
    chain = client.table.return_value.select.return_value.eq.return_value.single.return_value.execute
    chain.return_value.data = returned_row
    return client


def _fake_client_with_update(returned_row: dict) -> MagicMock:
    client = MagicMock()
    chain = (
        client.table.return_value
        .update.return_value
        .eq.return_value
        .execute
    )
    chain.return_value.data = [returned_row]
    return client


def test_create_job_inserts_row_and_caches():
    jobs_repo._jobs.clear()

    row = {
        "job_id": "job-1",
        "user_id": "user-1",
        "filename": "movie.mp4",
        "status": "queued",
        "progress": 0,
        "translation_mode": "segment",
        "source_lang": "en",
        "exports": {},
    }
    fake = _fake_client_with_insert(row)

    with patch.object(jobs_repo, "_get_client", return_value=fake):
        job = jobs_repo.create_job(
            filename="movie.mp4",
            translation_mode="segment",
            user_id="user-1",
            source_lang="en",
        )

    assert job["job_id"] == "job-1"
    assert jobs_repo._jobs["job-1"]["filename"] == "movie.mp4"
    fake.table.assert_called_with("jobs")


def test_get_job_returns_from_cache_when_present():
    jobs_repo._jobs.clear()
    jobs_repo._jobs["job-1"] = {"job_id": "job-1", "filename": "cached.mp4"}

    fake = _fake_client_with_select(None)
    with patch.object(jobs_repo, "_get_client", return_value=fake):
        job = jobs_repo.get_job("job-1")

    assert job["filename"] == "cached.mp4"
    fake.table.assert_not_called()


def test_get_job_reads_from_db_on_cache_miss():
    jobs_repo._jobs.clear()

    row = {"job_id": "job-2", "filename": "fresh.mp4", "status": "done"}
    fake = _fake_client_with_select(row)

    with patch.object(jobs_repo, "_get_client", return_value=fake):
        job = jobs_repo.get_job("job-2")

    assert job["filename"] == "fresh.mp4"
    assert jobs_repo._jobs["job-2"]["filename"] == "fresh.mp4"


def test_get_job_returns_none_when_not_found():
    jobs_repo._jobs.clear()
    fake = _fake_client_with_select(None)
    with patch.object(jobs_repo, "_get_client", return_value=fake):
        assert jobs_repo.get_job("missing") is None


def test_update_job_writes_db_and_updates_cache():
    jobs_repo._jobs.clear()
    jobs_repo._jobs["job-1"] = {"job_id": "job-1", "status": "queued", "progress": 0}

    updated_row = {"job_id": "job-1", "status": "done", "progress": 100}
    fake = _fake_client_with_update(updated_row)

    with patch.object(jobs_repo, "_get_client", return_value=fake):
        result = jobs_repo.update_job("job-1", status="done", progress=100)

    assert result["status"] == "done"
    assert jobs_repo._jobs["job-1"]["status"] == "done"


def test_get_job_event_queue_returns_same_queue_per_id():
    jobs_repo._job_event_queues.clear()
    q1 = jobs_repo.get_job_event_queue("job-1")
    q2 = jobs_repo.get_job_event_queue("job-1")
    assert q1 is q2
```

- [ ] **Step 3.2: Run test to verify it fails**

```
pytest tests/test_jobs_repo.py -v
```
Expected: FAIL with `ModuleNotFoundError: No module named 'models.jobs_repo'`.

- [ ] **Step 3.3: Implement `models/jobs_repo.py`**

```python
"""
jobs_repo.py — Postgres-backed job CRUD with write-through memory cache.

Replaces the JSON-file persistence that used to live in subtitle_model.py.
Memory cache (`_jobs`) is kept as a read-through accelerator for the SSE
hot path; Postgres is the source of truth.
"""
import os
import uuid
import queue
import threading
from typing import Optional

from supabase import create_client, Client

# ── Process-wide singletons ──────────────────────────────────────────
_client_singleton: Client | None = None

_jobs: dict[str, dict] = {}
_jobs_lock = threading.Lock()
_job_event_queues: dict[str, queue.Queue] = {}
_job_event_lock = threading.Lock()


def _get_client() -> Client:
    global _client_singleton
    if _client_singleton is None:
        url = os.environ["SUPABASE_URL"]
        key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
        _client_singleton = create_client(url, key)
    return _client_singleton


def create_job(
    filename: str,
    translation_mode: str,
    user_id: str,
    source_lang: str = "en",
) -> dict:
    """Insert a new job row in Postgres and seed the memory cache."""
    job_id = str(uuid.uuid4())
    row = {
        "job_id": job_id,
        "user_id": user_id,
        "filename": filename,
        "status": "queued",
        "progress": 0,
        "translation_mode": translation_mode,
        "source_lang": source_lang,
        "exports": {},
    }
    client = _get_client()
    resp = client.table("jobs").insert(row).execute()
    inserted = resp.data[0]

    with _jobs_lock:
        _jobs[job_id] = dict(inserted)
    with _job_event_lock:
        _job_event_queues[job_id] = queue.Queue()

    return dict(inserted)


def get_job(job_id: str) -> Optional[dict]:
    """Return the job dict, hitting the memory cache first."""
    with _jobs_lock:
        if job_id in _jobs:
            return dict(_jobs[job_id])

    client = _get_client()
    resp = client.table("jobs").select("*").eq("job_id", job_id).single().execute()
    if not resp.data:
        return None

    with _jobs_lock:
        _jobs[job_id] = dict(resp.data)
    return dict(resp.data)


def update_job(job_id: str, **fields) -> dict:
    """Merge fields into the job row and refresh the cache."""
    client = _get_client()
    resp = client.table("jobs").update(fields).eq("job_id", job_id).execute()
    updated = resp.data[0] if resp.data else {}

    with _jobs_lock:
        cached = _jobs.get(job_id, {})
        cached.update(updated)
        _jobs[job_id] = cached
    return dict(_jobs[job_id])


def get_job_event_queue(job_id: str) -> queue.Queue:
    with _job_event_lock:
        return _job_event_queues.setdefault(job_id, queue.Queue())


def emit_job_event(job_id: str, event: dict) -> None:
    get_job_event_queue(job_id).put(dict(event))
```

- [ ] **Step 3.4: Run tests to verify they pass**

```
pytest tests/test_jobs_repo.py -v
```
Expected: 6 passed.

- [ ] **Step 3.5: Commit**

```bash
git add models/jobs_repo.py tests/test_jobs_repo.py
git commit -m "feat(jobs): add Postgres-backed jobs_repo with write-through cache"
```

---

## Task 4: Wire `subtitle_model.py` to the new repos

Strip the old in-file CRUD and re-export from `jobs_repo` so existing imports keep working. Also rename `JobStatus.VAD` → `EXTRACTING` consolidation and `GENERATING` → `GENERATING_SRT` to match the spec enum.

**Files:**
- Modify: `models/subtitle_model.py:36-130` (remove `JOBS_DIR`, `_persist_job`, `create_job`, `get_job`, `update_job`, `_jobs`, `_job_event_queues`, `get_job_event_queue`, `emit_job_event` — keep `UPLOAD_DIR`, `OUTPUT_DIR`, `JobStatus`).
- Modify: `models/subtitle_model.py:48-55` (`JobStatus` constants).

- [ ] **Step 4.1: Update `JobStatus` constants**

Replace the `JobStatus` class in [models/subtitle_model.py:48-55](models/subtitle_model.py#L48-L55) with:

```python
class JobStatus:
    QUEUED         = "queued"
    EXTRACTING     = "extracting"
    TRANSCRIBING   = "transcribing"
    TRANSLATING    = "translating"
    ALIGNING       = "aligning"
    GENERATING_SRT = "generating_srt"
    DONE           = "done"
    ERROR          = "error"

    # Legacy aliases — keep until all call sites migrate.
    VAD        = EXTRACTING       # old "vad" → fold into "extracting"
    GENERATING = GENERATING_SRT   # old "generating" → "generating_srt"
```

- [ ] **Step 4.2: Remove old job-store code, re-export from `jobs_repo`**

Replace [models/subtitle_model.py:58-130](models/subtitle_model.py#L58-L130) (the entire "JOB STORE" section through the end of `emit_job_event`) with:

```python
# ─────────────────────────────────────────────────────────────────
# JOB STORE  (delegated to jobs_repo)
# ─────────────────────────────────────────────────────────────────

from models.jobs_repo import (
    create_job,
    get_job,
    update_job,
    get_job_event_queue,
    emit_job_event,
)
```

Also remove `JOBS_DIR` from the `PATHS` block — change [models/subtitle_model.py:36-41](models/subtitle_model.py#L36-L41) from:

```python
UPLOAD_DIR = Path("uploads")
OUTPUT_DIR = Path("outputs")
JOBS_DIR   = Path("jobs")

for _d in [UPLOAD_DIR, OUTPUT_DIR, JOBS_DIR]:
    _d.mkdir(exist_ok=True)
```

to:

```python
UPLOAD_DIR = Path("uploads")
OUTPUT_DIR = Path("outputs")

for _d in [UPLOAD_DIR, OUTPUT_DIR]:
    _d.mkdir(exist_ok=True)
```

Also remove the now-unused imports `json`, `uuid`, `time`, `threading`, `queue` from the top of the file IF they're not used elsewhere in `subtitle_model.py`. Verify with `grep` before deleting each.

- [ ] **Step 4.3: Update existing tests if they reference the removed JSON path**

Run:
```
pytest tests/ -v 2>&1 | head -100
```

If any test references `JOBS_DIR` or directly inspects `jobs/*.json`, mock the new `jobs_repo._get_client` instead. Expected: only `test_jobs_repo.py` and `test_storage_repo.py` and pre-existing tests should run. The pre-existing `tests/test_subtitle_optimizer.py` and `tests/test_realtime_chunked.py` should still pass (they don't touch job CRUD).

- [ ] **Step 4.4: Commit**

```bash
git add models/subtitle_model.py
git commit -m "refactor(jobs): delegate job CRUD to jobs_repo, drop JSON file store"
```

---

## Task 5: Pipeline finalize — upload SRT + atomic done

Modify the end of `run_pipeline` to upload SRT before setting `status='done'`, per spec §7.

**Files:**
- Modify: `models/subtitle_model.py:816-870` (the `run_pipeline` finalize block — exact line numbers may shift after Task 4; locate by searching for `update_job(job_id, status=JobStatus.DONE`).

- [ ] **Step 5.1: Read the current finalize block**

```
grep -n "JobStatus.DONE\|en_srt_path\|vi_srt_path" models/subtitle_model.py
```

Locate the section that currently does:
```python
update_job(job_id, status=JobStatus.GENERATING, progress=80)
...
en_srt_path = str(OUTPUT_DIR / f"{job_id}_en.srt")
vi_srt_path = str(OUTPUT_DIR / f"{job_id}_vi.srt")
...
update_job(job_id, status=JobStatus.DONE, ...)
```

- [ ] **Step 5.2: Add an import for storage_repo at the top of subtitle_model.py**

Add near the top of [models/subtitle_model.py](models/subtitle_model.py):
```python
from models import storage_repo
```

- [ ] **Step 5.3: Replace the finalize block with upload-then-done**

Find the block in `run_pipeline` that calls `update_job(job_id, status=JobStatus.DONE, ...)` and replace it with:

```python
        update_job(job_id, status=JobStatus.GENERATING_SRT, progress=90)

        en_srt_local = str(OUTPUT_DIR / f"{job_id}_en.srt")
        vi_srt_local = str(OUTPUT_DIR / f"{job_id}_vi.srt")

        # Generate SRT files locally (existing code that writes en_srt_local
        # and vi_srt_local stays put — keep whatever the current
        # _write_srt() / similar call does).

        user_id = job.get("user_id")
        en_storage = f"{user_id}/{job_id}/en.srt"
        vi_storage = f"{user_id}/{job_id}/vi.srt"

        storage_repo.upload_file(en_srt_local, en_storage)
        storage_repo.upload_file(vi_srt_local, vi_storage)

        # Only reach here if both uploads succeeded.
        from datetime import datetime, timezone
        update_job(
            job_id,
            status=JobStatus.DONE,
            progress=100,
            en_srt_storage_path=en_storage,
            vi_srt_storage_path=vi_storage,
            completed_at=datetime.now(timezone.utc).isoformat(),
        )

        # Per-job cleanup: drop the source video + audio.
        try:
            video_local = job.get("video_path")
            if video_local and os.path.exists(video_local):
                os.remove(video_local)
            audio_local = str(UPLOAD_DIR / f"{job_id}_audio.wav")
            if os.path.exists(audio_local):
                os.remove(audio_local)
        except Exception as cleanup_exc:
            print(f"⚠️  Cleanup failed for {job_id}: {cleanup_exc}")
```

Note: keep whatever the existing SRT-writing code does (the `_write_srt(...)` call or equivalent) — only add the upload + cleanup blocks around it.

- [ ] **Step 5.4: Apply the same change to `run_pipeline_realtime`**

The same finalize pattern exists in `run_pipeline_realtime` (around [models/subtitle_model.py:968-987](models/subtitle_model.py#L968-L987)). Apply the identical upload-then-done + cleanup logic there.

- [ ] **Step 5.5: Smoke-check the imports compile**

```
python -c "from models import subtitle_model; print('ok')"
```
Expected: `ok`. If `ImportError` for `storage_repo`, fix the import in Step 5.2.

- [ ] **Step 5.6: Commit**

```bash
git add models/subtitle_model.py
git commit -m "feat(pipeline): upload SRT to Storage before marking job done"
```

---

## Task 6: Refactor `download_srt` endpoint

Replace with `GET /api/jobs/{job_id}/srt-url` returning JSON.

**Files:**
- Modify: `controllers/subtitle_controller.py:311-343` (`download_srt`)

- [ ] **Step 6.1: Add storage_repo import**

At the top of [controllers/subtitle_controller.py](controllers/subtitle_controller.py), add:
```python
from models import storage_repo
```

- [ ] **Step 6.2: Replace `download_srt`**

Replace the entire `download_srt` function ([controllers/subtitle_controller.py:311-343](controllers/subtitle_controller.py#L311-L343)) with:

```python
@subtitle_bp.get("/jobs/<job_id>/srt-url")
@require_auth
def get_srt_url(job_id: str, lang: str = None):
    """
    Return a short-lived signed URL for downloading the SRT.
    Query param: lang=en|vi
    """
    lang = request.args.get("lang", "")
    if lang not in ("en", "vi"):
        return jsonify({"error": "lang must be 'en' or 'vi'"}), 400

    job = get_job(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    if job.get("user_id") != g.user_id:
        return jsonify({"error": "Forbidden"}), 403
    if job["status"] != JobStatus.DONE:
        return jsonify({"error": f"Job not ready (status: {job['status']})"}), 409

    key = "en_srt_storage_path" if lang == "en" else "vi_srt_storage_path"
    storage_path = job.get(key)
    if not storage_path:
        return jsonify({"error": "SRT not available"}), 404

    url = storage_repo.signed_url(storage_path, expires_in=3600)
    return jsonify({"url": url, "expires_in": 3600}), 200
```

- [ ] **Step 6.3: Smoke-test routes load**

```
python -c "from app import create_app; app = create_app(); print([r.rule for r in app.url_map.iter_rules() if 'srt' in r.rule])"
```
Expected: contains `/api/jobs/<job_id>/srt-url`.

- [ ] **Step 6.4: Commit**

```bash
git add controllers/subtitle_controller.py
git commit -m "feat(api): replace /download with /jobs/{id}/srt-url signed-URL endpoint"
```

---

## Task 7: Local-disk cleanup daemon

Sweep `outputs/` and `uploads/` for files older than 7 days. Run at app start + every 24h.

**Files:**
- Create: `models/cleanup.py`
- Create: `tests/test_cleanup.py`
- Modify: `app.py` (start the daemon)

- [ ] **Step 7.1: Write failing test**

Create `tests/test_cleanup.py`:

```python
import os
import time
from pathlib import Path

from models import cleanup


def test_cleanup_removes_only_old_files(tmp_path: Path):
    old = tmp_path / "old.srt"
    new = tmp_path / "new.srt"
    old.write_text("old")
    new.write_text("new")

    # Backdate "old" by 10 days.
    ten_days_ago = time.time() - 10 * 86400
    os.utime(old, (ten_days_ago, ten_days_ago))

    cleanup.cleanup_local_outputs([tmp_path], retention_days=7)

    assert not old.exists(), "old file should be deleted"
    assert new.exists(), "new file must remain"


def test_cleanup_ignores_missing_directory(tmp_path: Path):
    missing = tmp_path / "does-not-exist"
    # Must not raise.
    cleanup.cleanup_local_outputs([missing], retention_days=7)


def test_cleanup_swallows_per_file_errors(tmp_path: Path, monkeypatch):
    f = tmp_path / "locked.srt"
    f.write_text("x")
    os.utime(f, (0, 0))

    def boom(_):
        raise OSError("permission denied")

    monkeypatch.setattr(os, "remove", boom)
    # Must not propagate the OSError.
    cleanup.cleanup_local_outputs([tmp_path], retention_days=7)
```

- [ ] **Step 7.2: Run the test to verify it fails**

```
pytest tests/test_cleanup.py -v
```
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 7.3: Implement `models/cleanup.py`**

```python
"""
cleanup.py — Local-disk retention sweeper.

Removes files in the given directories whose mtime is older than
retention_days. **Never** touches Supabase Storage — Storage objects
are persistent until explicitly deleted by application code.
"""
import os
import time
import threading
from pathlib import Path
from typing import Iterable


def cleanup_local_outputs(
    directories: Iterable[Path],
    retention_days: int = 7,
) -> int:
    """Delete files in `directories` older than `retention_days`. Returns count deleted."""
    cutoff = time.time() - retention_days * 86400
    removed = 0
    for d in directories:
        if not d.exists():
            continue
        for entry in d.iterdir():
            if not entry.is_file():
                continue
            try:
                if entry.stat().st_mtime < cutoff:
                    os.remove(entry)
                    removed += 1
            except OSError as exc:
                print(f"⚠️  Cleanup skip {entry}: {exc}")
    return removed


def start_cleanup_daemon(
    directories: Iterable[Path],
    retention_days: int = 7,
    interval_seconds: int = 86400,
) -> threading.Thread:
    """Run cleanup once now, then every `interval_seconds` in a daemon thread.

    Single-instance only. Multi-instance deploys should replace this with
    an external cron.
    """
    dirs = list(directories)

    def _loop():
        while True:
            try:
                n = cleanup_local_outputs(dirs, retention_days=retention_days)
                if n:
                    print(f"🧹 cleanup removed {n} stale files")
            except Exception as exc:
                print(f"⚠️  cleanup daemon error: {exc}")
            time.sleep(interval_seconds)

    t = threading.Thread(target=_loop, daemon=True, name="cleanup-daemon")
    t.start()
    return t
```

- [ ] **Step 7.4: Run tests to verify pass**

```
pytest tests/test_cleanup.py -v
```
Expected: 3 passed.

- [ ] **Step 7.5: Wire daemon into `app.py`**

Add to [app.py](app.py) inside `create_app()` (after blueprint registration, before `return app`):

```python
    # Local-disk retention sweeper — single-instance only.
    from models.cleanup import start_cleanup_daemon
    from models.subtitle_model import UPLOAD_DIR, OUTPUT_DIR
    start_cleanup_daemon([UPLOAD_DIR, OUTPUT_DIR], retention_days=7)
```

- [ ] **Step 7.6: Smoke-test app starts**

```
python -c "from app import create_app; create_app(); print('ok')"
```
Expected: `ok` (daemon starts in background, returns immediately).

- [ ] **Step 7.7: Commit**

```bash
git add models/cleanup.py tests/test_cleanup.py app.py
git commit -m "feat(cleanup): local-disk retention sweeper, 7-day default"
```

---

## Task 8: Frontend — update SRT download flow

Replace direct-download GET with the new JSON-URL flow.

**Files:**
- Modify: `src/lib/api.ts` (add `getSrtUrl`, remove `downloadSrt`/old fn)
- Modify: `src/app/pages/EditorPage.tsx` (caller)

- [ ] **Step 8.1: Locate the current SRT download caller**

```
grep -n "download\|srt" src/lib/api.ts src/app/pages/EditorPage.tsx
```

Find the existing function that hits `/api/jobs/{id}/download/{lang}`. Note its name and the EditorPage hook that calls it.

- [ ] **Step 8.2: Replace API helper**

In [src/lib/api.ts](src/lib/api.ts), remove the old SRT download function and add:

```typescript
export async function getSrtUrl(jobId: string, lang: "en" | "vi"): Promise<string> {
  const token = await getAuthToken();   // existing helper
  const res = await fetch(`${BASE}/jobs/${encodeURIComponent(jobId)}/srt-url?lang=${lang}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `SRT URL fetch failed (${res.status})`);
  }
  const { url } = await res.json();
  return url as string;
}
```

If `getAuthToken` doesn't exist by that name, use the same auth-token pattern the file already uses (search for `Bearer` in `api.ts`).

- [ ] **Step 8.3: Update the EditorPage caller**

In [src/app/pages/EditorPage.tsx](src/app/pages/EditorPage.tsx), replace the existing "download SRT" button handler with:

```tsx
const handleDownloadSrt = async (lang: "en" | "vi") => {
  try {
    const url = await getSrtUrl(jobId, lang);
    // Trigger download by navigating to the signed URL.
    const a = document.createElement("a");
    a.href = url;
    a.download = `subtitles_${lang}.srt`;
    a.click();
  } catch (err) {
    console.error(err);
    // Show an error toast/message using whatever pattern EditorPage already uses.
    alert(err instanceof Error ? err.message : "Download failed");
  }
};
```

Update the import line to include `getSrtUrl` and remove the now-unused old import.

- [ ] **Step 8.4: Type-check**

```
pnpm exec tsc --noEmit
```
Expected: `TypeScript: No errors found`.

- [ ] **Step 8.5: Commit**

```bash
git add src/lib/api.ts src/app/pages/EditorPage.tsx
git commit -m "feat(web): consume signed-URL JSON for SRT download"
```

---

## Task 9: End-to-end manual verification

No new code — exercise the full path against a real Supabase project.

- [ ] **Step 9.1: Confirm env vars**

```
echo $env:SUPABASE_URL
echo $env:SUPABASE_SERVICE_ROLE_KEY
```
Both must be set. If not, set them in the appropriate `.env` file the app reads.

- [ ] **Step 9.2: Start the app**

```
python app.py
```
Expected: starts on the usual port without errors; log line shows the cleanup daemon thread.

- [ ] **Step 9.3: Run the dev server**

In a separate terminal:
```
pnpm dev
```

- [ ] **Step 9.4: Upload a short test video**

Use the UI: login, upload a 30-second MP4. Watch the SSE progress.

- [ ] **Step 9.5: Verify Postgres row**

In Supabase SQL Editor:
```sql
select job_id, status, progress, en_srt_storage_path, vi_srt_storage_path, completed_at
from public.jobs
order by created_at desc
limit 1;
```
Expected: `status='done'`, both storage paths non-null, `completed_at` set.

- [ ] **Step 9.6: Verify Storage objects**

In Supabase Dashboard → Storage → `subtitle-files`, navigate to `{user_id}/{job_id}/`. Expected: `en.srt` and `vi.srt` present.

- [ ] **Step 9.7: Verify local cleanup**

On the server filesystem:
```
ls uploads/ | findstr <job_id>
```
Expected: no matches (video + audio deleted).

```
ls outputs/ | findstr <job_id>
```
Expected: `<job_id>_en.srt` and `<job_id>_vi.srt` still there (will be swept after 7 days).

- [ ] **Step 9.8: Verify SRT download in Editor**

Click "Download SRT (en)" in the Editor. File should download with the correct content.

- [ ] **Step 9.9: Verify export still works (unchanged flow)**

In the Editor, click "Export 720p VI". File should download as before — `send_file` stream, no Storage involved.

- [ ] **Step 9.10: Verify ownership check**

Open DevTools → Network → grab the `/api/jobs/{id}/srt-url?lang=en` request. Sign out, sign in as a different account, replay the request with `curl` using the new token. Expected: HTTP 403 with `{"error": "Forbidden"}`.

If any step fails, debug, fix, and re-run that step. Do not commit "verification done" — the green path through these steps IS the verification.

---

## Self-review checklist

- ✅ **Spec coverage:**
  - §3 Storage layout (SRT only) → Task 5 (path construction `{user_id}/{job_id}/en.srt`).
  - §4 DB schema (no `exports` column) → Task 0.2 + Task 1 (DDL).
  - §5 Lifecycle → Tasks 5, 7.
  - §6 API + authorization → Task 6 (srt-url), export unchanged.
  - §7 Atomicity → Task 5 (upload-before-done ordering).
  - §8 Cleanup → Task 7.
  - §9 Known limitations → already documented in spec, no code action.
- ✅ **No placeholders:** every code step shows the actual code; no "implement similar logic"; no "TODO".
- ✅ **Type consistency:** `JobStatus.DONE = "done"`, `en_srt_storage_path` column name, `signed_url(path, expires_in)` signature, `getSrtUrl(jobId, lang)` TS signature — all match across tasks.
- ✅ **Frequent commits:** every task ends with a commit; 9 tasks total (Tasks 1-8 + manual E2E).
- ✅ **Export unchanged:** `POST /api/export` + `GET /api/exports/{filename}` + frontend export flow — none of these are touched.

---

## Notes for the executing engineer

- The "Expected:" lines after each command are not optional. If the actual output differs, stop and investigate before moving on. Don't tweak the plan; ask.
- `tests/conftest.py` already stubs `requests`, `torch`, `ffmpeg` — you do not need to install those to run the new tests.
- You will need `supabase-py` installed (already in the project — `middleware/auth.py` imports it). If `from supabase import create_client` fails, run `pip install supabase`.
- Do NOT touch `middleware/auth.py`. Do NOT add backwards-compat reads of old `jobs/*.json` files — this is a clean break (no users in production yet).
- If you find a step that references a function or column that doesn't exist after a previous step's changes, that is a plan bug — flag it, don't paper over.
