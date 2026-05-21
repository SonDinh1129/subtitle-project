"""
storage_repo.py — Supabase Storage access layer.

Bucket: subtitle-files (private)
Object key convention: {user_id}/{job_id}/en.srt  or  {user_id}/{job_id}/vi.srt

Uses SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars.
Service-role key bypasses RLS — do not expose to clients.
"""

import os
from supabase import create_client, Client

BUCKET = "subtitle-files"


def _client() -> Client:
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return create_client(url, key)


def upload_file(local_path: str, storage_path: str) -> None:
    """Upload a local file to the subtitle-files bucket.

    Raises on any error (Supabase client raises StorageException).
    """
    with open(local_path, "rb") as f:
        data = f.read()
    _client().storage.from_(BUCKET).upload(
        path=storage_path,
        file=data,
        file_options={"upsert": "true"},
    )


def signed_url(storage_path: str, expires_in: int = 3600) -> str:
    """Return a signed URL string for the given object path.

    expires_in: seconds until expiry (default 1 hour).
    Raises on any error.
    """
    result = _client().storage.from_(BUCKET).create_signed_url(
        path=storage_path,
        expires_in=expires_in,
    )
    return result["signedURL"]


def delete_object(storage_path: str) -> None:
    """Delete an object from the bucket. Silently ignores 404 (object not found)."""
    try:
        _client().storage.from_(BUCKET).remove([storage_path])
    except Exception as exc:
        if "Not Found" in str(exc) or "404" in str(exc):
            return
        raise
