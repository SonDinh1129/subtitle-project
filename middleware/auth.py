"""
auth.py — Authentication & authorization middleware
────────────────────────────────────────────────────
Provides:
  • require_auth    — decorator: validate Supabase JWT → set g.user_id
  • require_premium — decorator: check premium status (must be after require_auth)
  • get_profile     — fetch profile from Supabase (cached in g._profile)
  • is_premium      — check active premium from profile
  • needs_reset     — check if monthly usage counter should be reset
  • reset_usage     — reset monthly counter
"""

import os
from datetime import datetime, timezone
from functools import wraps

import jwt
from flask import g, request, jsonify
from supabase import create_client, Client


# ─── Supabase service client ─────────────────────────────────────────────────

def _get_supabase_service() -> Client:
    """Get or create Supabase service role client (bypasses RLS). Cached per request."""
    if not hasattr(g, '_supabase_service'):
        url = os.environ['SUPABASE_URL']
        key = os.environ['SUPABASE_SERVICE_ROLE_KEY']
        g._supabase_service = create_client(url, key)
    return g._supabase_service


# ─── Profile helpers ──────────────────────────────────────────────────────────

def get_profile(user_id: str) -> dict | None:
    """Fetch user profile from Supabase. Cached in g._profile for the request lifetime."""
    if hasattr(g, '_profile') and g._profile is not None:
        return g._profile
    try:
        supabase = _get_supabase_service()
        result = supabase.table('profiles').select('*').eq('id', user_id).single().execute()
        g._profile = result.data
        return g._profile
    except Exception:
        return None


def is_premium(profile: dict | None) -> bool:
    """Return True if profile has an active premium subscription."""
    if not profile:
        return False
    premium_until = profile.get('premium_until')
    if not premium_until:
        return False
    try:
        expiry = datetime.fromisoformat(str(premium_until).replace('Z', '+00:00'))
        if expiry.tzinfo is None:
            expiry = expiry.replace(tzinfo=timezone.utc)
        return expiry > datetime.now(timezone.utc)
    except Exception:
        return False


def needs_reset(profile: dict | None) -> bool:
    """Return True if the monthly video counter needs to be reset (new month).

    Phase 9 fix: handle timezone-naive datetimes from Supabase.
    Compare year/month tuples to handle year boundary (Dec → Jan) correctly.
    """
    if not profile:
        return False
    reset_at_str = profile.get('usage_reset_at')
    if not reset_at_str:
        return False
    try:
        reset_at = datetime.fromisoformat(str(reset_at_str).replace('Z', '+00:00'))
        if reset_at.tzinfo is None:
            reset_at = reset_at.replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        return (now.year, now.month) > (reset_at.year, reset_at.month)
    except Exception:
        return False


def reset_usage(user_id: str) -> None:
    """Reset monthly video count and update usage_reset_at to now."""
    try:
        supabase = _get_supabase_service()
        supabase.table('profiles').update({
            'videos_used_this_month': 0,
            'usage_reset_at': datetime.now(timezone.utc).isoformat(),
        }).eq('id', user_id).execute()
        # Invalidate cached profile so next get_profile() re-fetches
        if hasattr(g, '_profile'):
            del g._profile
    except Exception:
        pass  # Non-fatal — usage count may be slightly off this cycle


# ─── Auth decorators ──────────────────────────────────────────────────────────

def _verify_user_id_with_supabase(token: str) -> str | None:
    """Verify access token via Supabase Auth and return user id when valid."""
    try:
        supabase = _get_supabase_service()
        user_resp = supabase.auth.get_user(token)
        user = getattr(user_resp, 'user', None)
        user_id = getattr(user, 'id', None)
        return str(user_id) if user_id else None
    except Exception:
        return None


def _verify_user_id_with_local_jwt(token: str) -> str | None:
    """Verify access token locally with JWT secret (HS256 projects)."""
    jwt_secret = os.getenv('SUPABASE_JWT_SECRET')
    if not jwt_secret:
        return None

    payload = jwt.decode(
        token,
        jwt_secret,
        algorithms=['HS256'],
        audience='authenticated',
    )
    user_id = payload.get('sub')
    return str(user_id) if user_id else None


def require_auth(f):
    """
    Decorator: verify Supabase JWT and set g.user_id.

    Reads token from:
      1. Authorization: Bearer <token> header
      2. ?token=<token> query param (for SSE EventSource which can't send headers)

    Returns 401 on missing/invalid/expired token.
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None

        auth_header = request.headers.get('Authorization', '')
        if auth_header.startswith('Bearer '):
            token = auth_header[7:]

        if not token:
            token = request.args.get('token')

        if not token:
            return jsonify({'error': 'Authentication required'}), 401

        # Primary path: ask Supabase Auth to validate token.
        user_id = _verify_user_id_with_supabase(token)
        if user_id:
            g.user_id = user_id
            return f(*args, **kwargs)

        # Fallback path: local HS256 validation for legacy setups.
        try:
            user_id = _verify_user_id_with_local_jwt(token)
            if not user_id:
                return jsonify({'error': 'Invalid token'}), 401
            g.user_id = user_id
        except jwt.ExpiredSignatureError:
            return jsonify({'error': 'Token expired'}), 401
        except jwt.InvalidTokenError as exc:
            return jsonify({'error': f'Invalid token: {exc}'}), 401

        return f(*args, **kwargs)
    return decorated


def require_premium(f):
    """
    Decorator: check that authenticated user has active premium.

    Must be applied BELOW @require_auth (decorators wrap bottom-up):
        @require_auth
        @require_premium
        def my_view(): ...

    Returns 403 with code PREMIUM_REQUIRED if not premium.
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        if not hasattr(g, 'user_id'):
            return jsonify({'error': 'Authentication required'}), 401

        profile = get_profile(g.user_id)
        if not profile or not is_premium(profile):
            return jsonify({
                'error': 'Premium subscription required',
                'code': 'PREMIUM_REQUIRED',
            }), 403

        return f(*args, **kwargs)
    return decorated
