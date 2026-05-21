"""
test_storage_repo.py — unit tests for models.storage_repo.

All Supabase I/O is mocked; no real credentials needed.
"""
import sys
import types
from unittest.mock import MagicMock

# Stub supabase before importing storage_repo (not installed in test env)
if "supabase" not in sys.modules:
    _supabase_mod = types.ModuleType("supabase")
    _supabase_mod.create_client = MagicMock()
    _supabase_mod.Client = object
    sys.modules["supabase"] = _supabase_mod

import pytest
from unittest.mock import patch, mock_open

import models.storage_repo as storage_repo

BUCKET = storage_repo.BUCKET


class TestUploadFile:
    def test_upload_calls_supabase_with_correct_args(self, tmp_path):
        """upload_file reads the local file and calls .upload() with correct path and upsert."""
        local_file = tmp_path / "en.srt"
        local_file.write_bytes(b"1\n00:00:01,000 --> 00:00:02,000\nHello\n")

        mock_client = MagicMock()
        with patch("models.storage_repo._client", return_value=mock_client):
            storage_repo.upload_file(str(local_file), "user1/job1/en.srt")

        mock_client.storage.from_(BUCKET).upload.assert_called_once_with(
            path="user1/job1/en.srt",
            file=b"1\n00:00:01,000 --> 00:00:02,000\nHello\n",
            file_options={"upsert": "true"},
        )

    def test_upload_propagates_storage_exception(self, tmp_path):
        """upload_file re-raises any exception from the Supabase client."""
        local_file = tmp_path / "en.srt"
        local_file.write_bytes(b"data")

        mock_client = MagicMock()
        mock_client.storage.from_(BUCKET).upload.side_effect = RuntimeError("storage error")

        with patch("models.storage_repo._client", return_value=mock_client):
            with pytest.raises(RuntimeError, match="storage error"):
                storage_repo.upload_file(str(local_file), "user1/job1/en.srt")


class TestSignedUrl:
    def test_returns_signed_url_string(self):
        """signed_url extracts and returns the signedURL value from the response dict."""
        mock_client = MagicMock()
        mock_client.storage.from_(BUCKET).create_signed_url.return_value = {
            "signedURL": "https://example.com/signed?token=abc"
        }

        with patch("models.storage_repo._client", return_value=mock_client):
            url = storage_repo.signed_url("user1/job1/en.srt")

        assert url == "https://example.com/signed?token=abc"

    def test_passes_expires_in(self):
        """signed_url forwards the expires_in parameter to create_signed_url."""
        mock_client = MagicMock()
        mock_client.storage.from_(BUCKET).create_signed_url.return_value = {
            "signedURL": "https://example.com/signed"
        }

        with patch("models.storage_repo._client", return_value=mock_client):
            storage_repo.signed_url("user1/job1/vi.srt", expires_in=7200)

        mock_client.storage.from_(BUCKET).create_signed_url.assert_called_once_with(
            path="user1/job1/vi.srt",
            expires_in=7200,
        )

    def test_default_expires_in_is_3600(self):
        """signed_url defaults expires_in to 3600 seconds."""
        mock_client = MagicMock()
        mock_client.storage.from_(BUCKET).create_signed_url.return_value = {
            "signedURL": "https://example.com/signed"
        }

        with patch("models.storage_repo._client", return_value=mock_client):
            storage_repo.signed_url("user1/job1/en.srt")

        mock_client.storage.from_(BUCKET).create_signed_url.assert_called_once_with(
            path="user1/job1/en.srt",
            expires_in=3600,
        )


class TestDeleteObject:
    def test_delete_calls_remove_with_list(self):
        """delete_object calls .remove() with the path wrapped in a list."""
        mock_client = MagicMock()

        with patch("models.storage_repo._client", return_value=mock_client):
            storage_repo.delete_object("user1/job1/en.srt")

        mock_client.storage.from_(BUCKET).remove.assert_called_once_with(
            ["user1/job1/en.srt"]
        )

    def test_delete_silently_ignores_404(self):
        """delete_object does not raise when the client raises a 404 Not Found error."""
        mock_client = MagicMock()
        mock_client.storage.from_(BUCKET).remove.side_effect = Exception("404 Not Found")

        with patch("models.storage_repo._client", return_value=mock_client):
            # Should not raise
            storage_repo.delete_object("user1/job1/en.srt")

    def test_delete_silently_ignores_not_found(self):
        """delete_object does not raise when the client raises a 'Not Found' error."""
        mock_client = MagicMock()
        mock_client.storage.from_(BUCKET).remove.side_effect = Exception("Not Found")

        with patch("models.storage_repo._client", return_value=mock_client):
            storage_repo.delete_object("user1/job1/en.srt")

    def test_delete_propagates_other_exceptions(self):
        """delete_object re-raises non-404 errors from the Supabase client."""
        mock_client = MagicMock()
        mock_client.storage.from_(BUCKET).remove.side_effect = RuntimeError("network failure")

        with patch("models.storage_repo._client", return_value=mock_client):
            with pytest.raises(RuntimeError, match="network failure"):
                storage_repo.delete_object("user1/job1/en.srt")
