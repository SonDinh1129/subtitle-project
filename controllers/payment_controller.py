"""
payment_controller.py — PayOS payment endpoints
─────────────────────────────────────────────────
Routes:
  POST /api/payment/create-order  — create PayOS order, return payment URL
  POST /api/payment/webhook       — receive PayOS payment confirmation
"""

import os
import hmac
import hashlib
import json
from datetime import datetime, timezone

import requests
from flask import Blueprint, g, request, jsonify, current_app

from middleware.auth import require_auth, get_profile, is_premium
from extensions import limiter

payment_bp = Blueprint("payment", __name__)

PAYOS_API_BASE = "https://api-merchant.payos.vn"


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _verify_payos_signature(data: dict, received_signature: str) -> bool:
    """Verify PayOS HMAC-SHA256 webhook signature."""
    checksum_key = os.environ.get("PAYOS_CHECKSUM_KEY", "")
    if not checksum_key:
        return False

    # Sort keys and build canonical string
    sorted_data = dict(sorted(data.items()))
    canonical = "&".join(f"{k}={v}" for k, v in sorted_data.items() if k != "signature")

    expected = hmac.new(
        checksum_key.encode("utf-8"),
        canonical.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    return hmac.compare_digest(expected, received_signature)


def _get_supabase_service():
    """Get Supabase service client."""
    from supabase import create_client
    return create_client(
        current_app.config["SUPABASE_URL"],
        current_app.config["SUPABASE_SERVICE_ROLE_KEY"],
    )


# ─── Routes ──────────────────────────────────────────────────────────────────

@payment_bp.post("/create-order")
@require_auth
@limiter.limit("3/minute")
def create_order():
    """
    POST /api/payment/create-order
    Creates a PayOS payment order for premium upgrade (99,000 VND one-time).
    Returns { payment_url } to redirect user to PayOS checkout.
    """
    profile = get_profile(g.user_id)
    if not profile:
        return jsonify({"error": "Profile not found"}), 404

    if is_premium(profile):
        return jsonify({"error": "Already premium"}), 409

    payos_client_id  = os.environ.get("PAYOS_CLIENT_ID", "")
    payos_api_key    = os.environ.get("PAYOS_API_KEY", "")
    payos_checksum   = os.environ.get("PAYOS_CHECKSUM_KEY", "")
    frontend_url     = os.environ.get("FRONTEND_URL", "http://localhost:5173")

    if not all([payos_client_id, payos_api_key, payos_checksum]):
        return jsonify({"error": "PayOS not configured"}), 503

    # Build order ID (unique, numeric, max 15 chars)
    import time
    order_code = int(time.time() * 1000) % 10**13  # 13-digit ms timestamp

    amount = 99000  # VND

    # Build signature
    sig_data = {
        "amount": amount,
        "cancelUrl": f"{frontend_url}/upgrade",
        "description": "SubAI Premium",
        "orderCode": order_code,
        "returnUrl": f"{frontend_url}/upgrade/success",
    }
    sorted_sig = dict(sorted(sig_data.items()))
    canonical = "&".join(f"{k}={v}" for k, v in sorted_sig.items())
    signature = hmac.new(
        payos_checksum.encode("utf-8"),
        canonical.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    payload = {
        **sig_data,
        "signature": signature,
        "buyerEmail": profile.get("email", ""),
        "buyerName": profile.get("full_name", ""),
        "items": [{"name": "SubAI Premium (lifetime)", "quantity": 1, "price": amount}],
    }

    try:
        resp = requests.post(
            f"{PAYOS_API_BASE}/v2/payment-requests",
            json=payload,
            headers={
                "x-client-id": payos_client_id,
                "x-api-key": payos_api_key,
                "Content-Type": "application/json",
            },
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()

        if data.get("code") != "00":
            return jsonify({"error": data.get("desc", "PayOS error")}), 502

        payment_url = data["data"]["checkoutUrl"]
        payos_order_id = str(order_code)

        # Persist payment record
        supabase = _get_supabase_service()
        supabase.table("payments").insert({
            "user_id": g.user_id,
            "payos_order_id": payos_order_id,
            "amount": amount,
            "currency": "VND",
            "status": "pending",
        }).execute()

        return jsonify({"payment_url": payment_url, "order_id": payos_order_id}), 200

    except requests.RequestException as exc:
        return jsonify({"error": f"PayOS request failed: {exc}"}), 502


@payment_bp.post("/webhook")
def payment_webhook():
    """
    POST /api/payment/webhook
    Receives PayOS payment confirmation.
    No auth — called by PayOS servers.
    Idempotent: safe to call multiple times with same order.
    """
    data = request.get_json(silent=True) or {}

    signature = data.pop("signature", "")
    if not _verify_payos_signature(data, signature):
        return jsonify({"error": "Invalid signature"}), 400

    order_code = str(data.get("orderCode", ""))
    status_code = data.get("code", "")

    if status_code != "00":
        # Payment not successful (cancelled, failed, etc.)
        return jsonify({"ok": True}), 200

    supabase = _get_supabase_service()

    # Look up the payment record (idempotency check)
    try:
        result = supabase.table("payments") \
            .select("id, user_id, status") \
            .eq("payos_order_id", order_code) \
            .single() \
            .execute()
        payment = result.data
    except Exception:
        return jsonify({"error": "Payment record not found"}), 404

    if not payment:
        return jsonify({"error": "Payment record not found"}), 404

    # Idempotent: skip if already processed
    if payment.get("status") == "paid":
        return jsonify({"ok": True}), 200

    user_id = payment["user_id"]
    now = datetime.now(timezone.utc).isoformat()

    # Mark payment as paid
    supabase.table("payments").update({
        "status": "paid",
        "paid_at": now,
    }).eq("payos_order_id", order_code).execute()

    # Activate premium (lifetime = far future date)
    supabase.table("profiles").update({
        "premium_until": "9999-12-31T23:59:59+00:00",
    }).eq("id", user_id).execute()

    return jsonify({"ok": True}), 200
