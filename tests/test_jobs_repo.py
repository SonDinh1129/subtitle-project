"""
test_jobs_repo.py — unit tests for models.jobs_repo.

All Supabase I/O is mocked; no real credentials needed.
"""
import sys
import types
import queue
from unittest.mock import MagicMock

# Stub supabase before importing jobs_repo (not installed in test env)
if "supabase" not in sys.modules:
    _supabase_mod = types.ModuleType("supabase")
    _supabase_mod.create_client = MagicMock()
    _supabase_mod.Client = object
    sys.modules["supabase"] = _supabase_mod

import pytest
from unittest.mock import patch, call

import models.jobs_repo as jobs_repo


def _make_mock_client():
    """Return a MagicMock that chains table().insert/update/select fluently."""
    mock_client = MagicMock()
    return mock_client


def _clear_cache():
    """Clear in-memory job caches between tests."""
    with jobs_repo._jobs_lock:
        jobs_repo._jobs.clear()
    with jobs_repo._job_event_lock:
        jobs_repo._job_event_queues.clear()


class TestCreateJob:
    def setup_method(self):
        _clear_cache()

    def test_insert_called_with_correct_row(self):
        """create_job inserts a row with expected fields into the jobs table."""
        mock_client = _make_mock_client()

        with patch("models.jobs_repo._client", return_value=mock_client):
            result = jobs_repo.create_job(
                filename="video.mp4",
                translation_mode="full",
                user_id="user-abc",
                source_lang="en",
            )

        # Assert table("jobs").insert(...).execute() was called
        mock_client.table.assert_called_with("jobs")
        insert_call = mock_client.table("jobs").insert
        insert_call.assert_called_once()
        inserted_row = insert_call.call_args[0][0]
        assert inserted_row["filename"] == "video.mp4"
        assert inserted_row["translation_mode"] == "full"
        assert inserted_row["user_id"] == "user-abc"
        assert inserted_row["source_lang"] == "en"
        assert inserted_row["status"] == "queued"
        assert inserted_row["progress"] == 0

    def test_return_value_has_correct_fields(self):
        """create_job returns a dict with job_id, status=queued, and user_id."""
        mock_client = _make_mock_client()

        with patch("models.jobs_repo._client", return_value=mock_client):
            result = jobs_repo.create_job(
                filename="clip.mp4",
                translation_mode="none",
                user_id="user-xyz",
            )

        assert "job_id" in result
        assert result["status"] == "queued"
        assert result["user_id"] == "user-xyz"
        assert result["filename"] == "clip.mp4"
        assert result["progress"] == 0
        assert result["source_lang"] == "en"

    def test_creates_event_queue_for_job(self):
        """After create_job, get_job_event_queue returns a queue.Queue for the job."""
        mock_client = _make_mock_client()

        with patch("models.jobs_repo._client", return_value=mock_client):
            result = jobs_repo.create_job(
                filename="video.mp4",
                translation_mode="full",
                user_id="user-abc",
            )

        q = jobs_repo.get_job_event_queue(result["job_id"])
        assert isinstance(q, queue.Queue)

    def test_no_video_path_in_row(self):
        """create_job does not store video_path in the Postgres row."""
        mock_client = _make_mock_client()

        with patch("models.jobs_repo._client", return_value=mock_client):
            result = jobs_repo.create_job(
                filename="video.mp4",
                translation_mode="full",
                user_id="user-abc",
            )

        insert_call = mock_client.table("jobs").insert
        inserted_row = insert_call.call_args[0][0]
        assert "video_path" not in inserted_row
        assert "video_path" not in result


class TestGetJob:
    def setup_method(self):
        _clear_cache()

    def test_cache_hit_does_not_call_client_again(self):
        """get_job returns from memory cache after create_job without a second DB call."""
        mock_client = _make_mock_client()

        with patch("models.jobs_repo._client", return_value=mock_client) as patched:
            result = jobs_repo.create_job(
                filename="video.mp4",
                translation_mode="full",
                user_id="user-abc",
            )
            job_id = result["job_id"]
            # Reset call count after create
            patched.reset_mock()

            fetched = jobs_repo.get_job(job_id)

        # _client should NOT have been called again (cache hit)
        patched.assert_not_called()
        assert fetched["job_id"] == job_id
        assert fetched["status"] == "queued"

    def test_cache_miss_fetches_from_postgres(self):
        """get_job fetches from Postgres when job_id is not in memory cache."""
        mock_client = _make_mock_client()
        db_row = {
            "job_id": "missing-job-id",
            "user_id": "user-abc",
            "filename": "remote.mp4",
            "status": "done",
            "progress": 100,
            "translation_mode": "full",
            "source_lang": "en",
            "english_text": None,
            "vietnamese_text": None,
            "english_words": None,
            "vietnamese_words": None,
            "en_srt_storage_path": None,
            "vi_srt_storage_path": None,
            "error": None,
            "completed_at": None,
        }
        mock_client.table("jobs").select("*").eq("job_id", "missing-job-id").execute.return_value = MagicMock(data=[db_row])

        with patch("models.jobs_repo._client", return_value=mock_client):
            result = jobs_repo.get_job("missing-job-id")

        assert result is not None
        assert result["job_id"] == "missing-job-id"
        assert result["status"] == "done"
        assert result["filename"] == "remote.mp4"

    def test_returns_none_when_not_found(self):
        """get_job returns None when Postgres returns empty data."""
        mock_client = _make_mock_client()
        mock_client.table("jobs").select("*").eq("job_id", "no-such-id").execute.return_value = MagicMock(data=[])

        with patch("models.jobs_repo._client", return_value=mock_client):
            result = jobs_repo.get_job("no-such-id")

        assert result is None


class TestUpdateJob:
    def setup_method(self):
        _clear_cache()

    def test_update_calls_postgres_with_correct_fields(self):
        """update_job calls table('jobs').update(fields).eq('job_id', ...).execute()."""
        mock_client = _make_mock_client()

        with patch("models.jobs_repo._client", return_value=mock_client):
            # Seed the cache
            job = jobs_repo.create_job(
                filename="video.mp4",
                translation_mode="full",
                user_id="user-abc",
            )
            job_id = job["job_id"]
            mock_client.reset_mock()

            jobs_repo.update_job(job_id, status="processing", progress=50)

        mock_client.table.assert_called_with("jobs")
        update_call = mock_client.table("jobs").update
        update_call.assert_called_once_with({"status": "processing", "progress": 50})
        eq_call = mock_client.table("jobs").update({"status": "processing", "progress": 50}).eq
        eq_call.assert_called_once_with("job_id", job_id)

    def test_update_returns_merged_dict(self):
        """update_job returns a dict merging original cached fields with updated fields."""
        mock_client = _make_mock_client()

        with patch("models.jobs_repo._client", return_value=mock_client):
            job = jobs_repo.create_job(
                filename="video.mp4",
                translation_mode="full",
                user_id="user-abc",
            )
            job_id = job["job_id"]

            updated = jobs_repo.update_job(job_id, status="processing", progress=75)

        assert updated["status"] == "processing"
        assert updated["progress"] == 75
        assert updated["filename"] == "video.mp4"
        assert updated["user_id"] == "user-abc"

    def test_update_refreshes_memory_cache(self):
        """After update_job, get_job returns the updated fields from cache."""
        mock_client = _make_mock_client()

        with patch("models.jobs_repo._client", return_value=mock_client):
            job = jobs_repo.create_job(
                filename="video.mp4",
                translation_mode="full",
                user_id="user-abc",
            )
            job_id = job["job_id"]
            jobs_repo.update_job(job_id, status="done", progress=100)

            # get_job should hit cache — reset mock to detect any DB call
            mock_client.reset_mock()
            fetched = jobs_repo.get_job(job_id)

        mock_client.assert_not_called()
        assert fetched["status"] == "done"
        assert fetched["progress"] == 100


class TestEmitJobEvent:
    def setup_method(self):
        _clear_cache()

    def test_emit_puts_event_on_queue(self):
        """emit_job_event puts the event dict onto the job's event queue."""
        mock_client = _make_mock_client()

        with patch("models.jobs_repo._client", return_value=mock_client):
            job = jobs_repo.create_job(
                filename="video.mp4",
                translation_mode="full",
                user_id="user-abc",
            )
            job_id = job["job_id"]

        event = {"type": "progress", "value": 42}
        jobs_repo.emit_job_event(job_id, event)

        q = jobs_repo.get_job_event_queue(job_id)
        received = q.get_nowait()
        assert received == event

    def test_emit_creates_queue_if_not_exists(self):
        """emit_job_event works even if no queue existed for the job yet."""
        jobs_repo.emit_job_event("orphan-job-id", {"type": "done"})
        q = jobs_repo.get_job_event_queue("orphan-job-id")
        received = q.get_nowait()
        assert received == {"type": "done"}
