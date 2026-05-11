"""
auth_controller.py — Auth endpoints
────────────────────────────────────
Routes:
  GET /api/auth/me — return current user profile + computed is_premium
"""

from flask import Blueprint, g, jsonify, request
from middleware.auth import require_auth, get_profile, is_premium, _get_supabase_service
from extensions import limiter

auth_bp = Blueprint('auth', __name__)


@auth_bp.get('/me')
@require_auth
@limiter.limit("60/minute")
def get_me():
    """
    GET /api/auth/me
    Returns the current user's profile with backend-computed is_premium.
    Frontend should NOT recompute is_premium from premium_until.
    """
    profile = get_profile(g.user_id)
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
