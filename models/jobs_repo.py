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


def _client() -> Client:
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return create_client(url, key)


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
            _jobs[job_id] = dict(row)
        return dict(row)
    return None


def update_job(job_id: str, **fields) -> dict:
    """Update job fields in Postgres and refresh the memory cache.

    Returns the updated job dict (merged from cache + fields).
    """
    with _jobs_lock:
        cached = dict(_jobs.get(job_id, {}))
    cached.update(fields)
    _client().table("jobs").update(fields).eq("job_id", job_id).execute()
    with _jobs_lock:
        _jobs[job_id] = dict(cached)
    return dict(cached)


def get_job_event_queue(job_id: str) -> queue.Queue:
    """Return the SSE event queue for a job, creating one if it doesn't exist."""
    with _job_event_lock:
        return _job_event_queues.setdefault(job_id, queue.Queue())


def emit_job_event(job_id: str, event: dict) -> None:
    """Put an event dict onto the job's SSE event queue."""
    get_job_event_queue(job_id).put(dict(event))
