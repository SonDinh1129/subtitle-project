"""
cleanup.py — Local file retention sweeper.

Deletes files in uploads/ and outputs/ older than retention_days.
Never touches Supabase Storage objects.

Run once at startup and every 24 hours via start_cleanup_daemon().
"""

import os
import time
import threading
import logging
from pathlib import Path

logger = logging.getLogger(__name__)


def cleanup_local_outputs(directories: list[str | Path], retention_days: int = 7) -> int:
    """Delete files in directories older than retention_days.

    Returns count of deleted files.
    Never raises — logs errors and continues.
    Never touches Supabase Storage.
    """
    cutoff = time.time() - retention_days * 86400
    deleted = 0
    for directory in directories:
        d = Path(directory)
        if not d.exists():
            continue
        for f in d.iterdir():
            if not f.is_file():
                continue
            try:
                if f.stat().st_mtime < cutoff:
                    f.unlink()
                    deleted += 1
                    logger.info("cleanup: deleted %s", f)
            except Exception as exc:
                logger.warning("cleanup: failed to delete %s: %s", f, exc)
    return deleted


def start_cleanup_daemon(
    directories: list[str | Path],
    retention_days: int = 7,
    interval_seconds: int = 86400,
) -> threading.Thread:
    """Start a background daemon thread that runs cleanup every interval_seconds.

    Runs once immediately at startup (in the thread), then sleeps interval_seconds.
    Thread is daemon=True so it doesn't block process exit.

    Production note: Replace with an external cron for multi-instance deploy.
    """
    def _loop():
        while True:
            cleanup_local_outputs(directories, retention_days)
            time.sleep(interval_seconds)

    t = threading.Thread(target=_loop, daemon=True, name="cleanup-daemon")
    t.start()
    return t
