"""
auth_controller.py — Auth endpoints
────────────────────────────────────
Routes:
  GET /api/auth/me — return current user profile + computed is_premium
"""

from flask import Blueprint, g, jsonify
from middleware.auth import require_auth, get_profile, is_premium
from extensions import limiter

auth_bp = Blueprint('auth', __name__)


@auth_bp.get('/me')
@require_auth
@limiter.limit("10/minute")
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
