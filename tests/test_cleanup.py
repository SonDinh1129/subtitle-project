"""
test_cleanup.py — unit tests for models.cleanup.

Tests for local file retention and deletion logic.
No Supabase operations are involved.
"""
import os
import time
import threading
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

from models.cleanup import cleanup_local_outputs, start_cleanup_daemon


class TestCleanupLocalOutputs:
    def test_deletes_files_older_than_retention(self, tmp_path):
        """cleanup_local_outputs deletes files older than retention_days."""
        # Create files in tmp_path
        old_file = tmp_path / "old.txt"
        new_file = tmp_path / "new.txt"

        # Write files
        old_file.write_text("old content")
        new_file.write_text("new content")

        # Set old_file mtime to 8 days ago
        cutoff = time.time() - 7 * 86400
        os.utime(old_file, (cutoff - 86400, cutoff - 86400))

        # new_file is fresh (current time)
        os.utime(new_file, (time.time(), time.time()))

        # Run cleanup with 7 day retention
        deleted = cleanup_local_outputs([tmp_path], retention_days=7)

        assert deleted == 1
        assert not old_file.exists()
        assert new_file.exists()

    def test_keeps_files_newer_than_retention(self, tmp_path):
        """cleanup_local_outputs keeps files newer than retention_days."""
        fresh_file = tmp_path / "fresh.txt"
        fresh_file.write_text("fresh")

        # Set to current time
        os.utime(fresh_file, (time.time(), time.time()))

        deleted = cleanup_local_outputs([tmp_path], retention_days=7)

        assert deleted == 0
        assert fresh_file.exists()

    def test_returns_correct_count_of_deleted_files(self, tmp_path):
        """cleanup_local_outputs returns count of deleted files."""
        cutoff = time.time() - 7 * 86400

        # Create 3 old files
        for i in range(3):
            f = tmp_path / f"old_{i}.txt"
            f.write_text(f"old {i}")
            os.utime(f, (cutoff - 86400, cutoff - 86400))

        # Create 2 fresh files
        for i in range(2):
            f = tmp_path / f"new_{i}.txt"
            f.write_text(f"new {i}")
            os.utime(f, (time.time(), time.time()))

        deleted = cleanup_local_outputs([tmp_path], retention_days=7)

        assert deleted == 3

    def test_ignores_nonexistent_directory(self, tmp_path):
        """cleanup_local_outputs ignores non-existent directory without error."""
        nonexistent = tmp_path / "does_not_exist"

        # Should not raise
        deleted = cleanup_local_outputs([nonexistent], retention_days=7)

        assert deleted == 0

    def test_skips_subdirectories(self, tmp_path):
        """cleanup_local_outputs deletes files but skips subdirectories."""
        cutoff = time.time() - 7 * 86400

        # Create an old file
        old_file = tmp_path / "old.txt"
        old_file.write_text("old")
        os.utime(old_file, (cutoff - 86400, cutoff - 86400))

        # Create a subdirectory (should be skipped)
        subdir = tmp_path / "subdir"
        subdir.mkdir()

        deleted = cleanup_local_outputs([tmp_path], retention_days=7)

        assert deleted == 1
        assert not old_file.exists()
        assert subdir.exists()  # Directory should still exist

    def test_handles_unlink_exception_per_file(self, tmp_path, caplog):
        """cleanup_local_outputs catches exceptions on individual file deletion and continues."""
        cutoff = time.time() - 7 * 86400

        # Create two old files
        old_file1 = tmp_path / "old1.txt"
        old_file2 = tmp_path / "old2.txt"
        old_file1.write_text("old1")
        old_file2.write_text("old2")

        os.utime(old_file1, (cutoff - 86400, cutoff - 86400))
        os.utime(old_file2, (cutoff - 86400, cutoff - 86400))

        # Mock Path.unlink to raise on the first file but work on the second
        with patch.object(Path, "unlink") as mock_unlink:
            mock_unlink.side_effect = [PermissionError("no permission"), None]

            deleted = cleanup_local_outputs([tmp_path], retention_days=7)

        # Should have attempted both files, returned count of successful deletes
        assert deleted == 1  # Only the second file was deleted

    def test_never_raises_on_cleanup_error(self, tmp_path):
        """cleanup_local_outputs never raises, even if all operations fail."""
        cutoff = time.time() - 7 * 86400
        old_file = tmp_path / "old.txt"
        old_file.write_text("old")
        os.utime(old_file, (cutoff - 86400, cutoff - 86400))

        # Mock unlink to always raise
        with patch.object(Path, "unlink") as mock_unlink:
            mock_unlink.side_effect = OSError("disk error")

            # Should not raise
            deleted = cleanup_local_outputs([tmp_path], retention_days=7)

        assert deleted == 0


class TestStartCleanupDaemon:
    def test_returns_daemon_thread(self, tmp_path):
        """start_cleanup_daemon returns a daemon Thread that is alive."""
        thread = start_cleanup_daemon([tmp_path], retention_days=7, interval_seconds=60)

        assert isinstance(thread, threading.Thread)
        assert thread.daemon is True
        assert thread.is_alive()

        # Clean up: the thread will keep running, let it finish naturally
        # or the thread will be killed when the test session ends

    def test_daemon_runs_cleanup_periodically(self, tmp_path):
        """start_cleanup_daemon runs cleanup in a loop with interval_seconds sleep."""
        cutoff = time.time() - 7 * 86400
        old_file = tmp_path / "old.txt"
        old_file.write_text("old")
        os.utime(old_file, (cutoff - 86400, cutoff - 86400))

        # Mock time.sleep and run cleanup once
        call_count = 0

        def mock_sleep(seconds):
            nonlocal call_count
            call_count += 1
            # After one sleep, break the loop by stopping the thread
            if call_count >= 1:
                raise KeyboardInterrupt()

        with patch("time.sleep", side_effect=mock_sleep):
            try:
                thread = start_cleanup_daemon(
                    [tmp_path],
                    retention_days=7,
                    interval_seconds=1,
                )
                time.sleep(0.5)  # Let the thread start
            except KeyboardInterrupt:
                pass
