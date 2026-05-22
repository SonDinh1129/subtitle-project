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

import time as _time

_job_timestamps: dict[str, float] = {}  # job_id → monotonic timestamp at cache insertion
_JOB_CACHE_TTL = 7200  # 2 hours in seconds


def _evict_stale_jobs() -> None:
    """Remove jobs older than _JOB_CACHE_TTL from the in-memory cache.
    Must be called with _jobs_lock held.
    """
    cutoff = _time.monotonic() - _JOB_CACHE_TTL
    stale = [jid for jid, ts in _job_timestamps.items() if ts < cutoff]
    for jid in stale:
        _jobs.pop(jid, None)
        _job_timestamps.pop(jid, None)


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
        _job_timestamps[job_id] = _time.monotonic()
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
                _job_timestamps[job_id] = _time.monotonic()
                _evict_stale_jobs()
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
