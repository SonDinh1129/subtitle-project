"""
auth_controller.py — Auth endpoints
────────────────────────────────────
Routes:
  GET /api/auth/me — return current user profile + computed is_premium
"""

import jwt
import time
import os

from flask import Blueprint, g, jsonify, request
from middleware.auth import require_auth, get_profile, is_premium, _get_supabase_service
from extensions import limiter

auth_bp = Blueprint('auth', __name__)

_SSE_TOKEN_TTL = 60


@auth_bp.get('/me')
@require_auth
@limiter.limit("60/minute")
def get_me():
    """
    GET /api/auth/me
    Returns the current user's profile with backend-computed is_premium.
    Frontend should NOT recompute is_premium from premium_until.
    """
    try:
        profile = get_profile(g.user_id)
    except RuntimeError:
        return jsonify({'error': 'Service temporarily unavailable'}), 503
    if not profile:
        return jsonify({'error': 'Profile not found'}), 404

    return jsonify({
        **profile,
        'is_premium': is_premium(profile),
    }), 200


@auth_bp.patch('/profile')
@require_auth
@limiter.limit("30/minute")
def update_profile():
    """
    PATCH /api/auth/profile
    Body: { "full_name": string }
    Returns: updated profile
    """
    data = request.get_json(silent=True) or {}
    full_name = data.get('full_name', '')

    if not isinstance(full_name, str):
        return jsonify({'error': 'full_name must be a string'}), 400

    full_name = full_name.strip()

    if len(full_name) > 200:
        return jsonify({'error': 'full_name too long (max 200 characters)'}), 400

    try:
        supabase = _get_supabase_service()
        result = supabase.table('profiles').update({
            'full_name': full_name or None,
        }).eq('id', g.user_id).execute()

        updated = result.data[0] if result.data else None
        if not updated:
            return jsonify({'error': 'Profile not found'}), 404

        if hasattr(g, '_profile'):
            del g._profile

        return jsonify({
            **updated,
            'is_premium': is_premium(updated),
        }), 200
    except Exception:
        from flask import current_app
        current_app.logger.exception("update_profile failed for user %s", g.user_id)
        return jsonify({'error': 'Failed to update profile'}), 500


@auth_bp.post('/change-password')
@require_auth
@limiter.limit("10/minute")
def change_password():
    """
    POST /api/auth/change-password
    Body: { "new_password": string }
    Uses Supabase Admin API — no old password required.
    """
    data = request.get_json(silent=True) or {}
    new_password = data.get('new_password', '')

    if not new_password or len(new_password) < 8:
        return jsonify({'error': 'Password must be at least 8 characters'}), 400

    if len(new_password) > 72:
        return jsonify({'error': 'Password too long (max 72 characters)'}), 400

    try:
        supabase = _get_supabase_service()
        supabase.auth.admin.update_user_by_id(
            g.user_id,
            {'password': new_password}
        )
        return jsonify({'message': 'Password updated successfully'}), 200
    except Exception:
        from flask import current_app
        current_app.logger.exception("change_password failed for user %s", g.user_id)
        return jsonify({'error': 'Failed to update password'}), 500


@auth_bp.delete('/account')
@require_auth
@limiter.limit("5/hour")
def delete_account():
    """
    DELETE /api/auth/account
    Deletes user profile data then Supabase Auth record.
    Frontend must call signOut() after this succeeds.
    """
    try:
        supabase = _get_supabase_service()

        # Delete profile data first (foreign key constraint)
        supabase.table('profiles').delete().eq('id', g.user_id).execute()

        # Delete from Supabase Auth (hard delete)
        supabase.auth.admin.delete_user(g.user_id)

        return jsonify({'message': 'Account deleted successfully'}), 200
    except Exception:
        from flask import current_app
        current_app.logger.exception("delete_account failed for user %s", g.user_id)
        return jsonify({'error': 'Failed to delete account'}), 500


@auth_bp.get('/confirmation-status')
@limiter.limit("20/minute")
def confirmation_status():
    """
    GET /api/auth/confirmation-status?email=<email>

    Public, unauthenticated endpoint used by the post-signup "check your email"
    screen to detect when the user has confirmed via the magic link — even when
    the link is opened in a different browser/device (implicit flow), where the
    waiting tab otherwise has no way to learn the confirmation happened.

    Returns { "confirmed": bool }. To avoid leaking account existence, it returns
    { "confirmed": false } for unknown emails and never errors on a missing user.
    """
    email = (request.args.get('email') or '').strip().lower()
    if not email or '@' not in email or len(email) > 254:
        return jsonify({'error': 'A valid email query param is required'}), 400

    try:
        supabase = _get_supabase_service()
        confirmed = _is_email_confirmed(supabase, email)
        return jsonify({'confirmed': confirmed}), 200
    except Exception:
        from flask import current_app
        current_app.logger.exception("confirmation_status failed")
        # Fail closed: treat as not-confirmed so the client keeps waiting.
        return jsonify({'confirmed': False}), 200


def _is_email_confirmed(supabase, email: str) -> bool:
    """Return True iff an auth user with this email has confirmed their address.

    Paginates admin.list_users defensively so the lookup stays correct as the
    user count grows. Unknown email → False (also avoids leaking existence).
    The Supabase/gotrue SDK has shifted shapes across versions, so this handles
    both the paginated-object and bare-list return forms and stops when a page
    comes back empty or smaller than requested.
    """
    per_page = 200
    for page in range(1, 51):  # hard cap: 10k users — far beyond expected scale
        try:
            resp = supabase.auth.admin.list_users(page=page, per_page=per_page)
        except TypeError:
            # Older SDK signature without pagination kwargs.
            resp = supabase.auth.admin.list_users()

        users = getattr(resp, 'users', None)
        if users is None:
            users = resp if isinstance(resp, list) else []

        for u in users:
            u_email = (getattr(u, 'email', None) or '').strip().lower()
            if u_email == email:
                return bool(getattr(u, 'email_confirmed_at', None))

        # Stop when there are no more pages to scan.
        if len(users) < per_page:
            break

    return False


@auth_bp.post('/sse-token')
@require_auth
@limiter.limit("30/minute")
def get_sse_token():
    """
    POST /api/auth/sse-token
    Issues a short-lived (60s) JWT for use as ?token= on EventSource SSE connections.
    The SSE stream endpoint validates this via _verify_user_id_with_local_jwt.
    """
    jwt_secret = os.getenv('SUPABASE_JWT_SECRET')
    if not jwt_secret:
        return jsonify({'error': 'SSE tokens not available (SUPABASE_JWT_SECRET not set)'}), 503

    now = int(time.time())
    payload = {
        'sub': g.user_id,
        'aud': 'authenticated',
        'iat': now,
        'exp': now + _SSE_TOKEN_TTL,
    }
    token = jwt.encode(payload, jwt_secret, algorithm='HS256')
    return jsonify({'token': token, 'expires_in': _SSE_TOKEN_TTL}), 200
