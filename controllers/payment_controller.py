"""
payment_controller.py — MoMo payment endpoints
───────────────────────────────────────────────
Routes:
  POST /api/payment/create-order  — create MoMo order, return payment URL
  POST /api/payment/ipn           — receive MoMo IPN (server-to-server)
"""

import os
from datetime import datetime, timezone

import requests
from flask import Blueprint, g, request, jsonify

from middleware.auth import require_auth, get_profile, is_premium, _get_supabase_service
from extensions import limiter
from models.momo import create_momo_payment, verify_momo_ipn

payment_bp = Blueprint("payment", __name__)


@payment_bp.post("/create-order")
@require_auth
@limiter.limit("3/minute")
def create_order():
    """
    POST /api/payment/create-order
    Creates a MoMo payment order for premium upgrade (99,000 VND lifetime).
    Returns { payment_url } to redirect user to MoMo checkout.
    """
    profile = get_profile(g.user_id)
    if not profile:
        return jsonify({"error": "Profile not found"}), 404

    if is_premium(profile):
        return jsonify({"error": "Already premium"}), 409

    partner_code = os.environ.get("MOMO_PARTNER_CODE", "")
    access_key   = os.environ.get("MOMO_ACCESS_KEY", "")
    secret_key   = os.environ.get("MOMO_SECRET_KEY", "")
    ngrok_url    = os.environ.get("NGROK_URL", "").rstrip("/")
    frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:5173").rstrip("/")

    if not all([partner_code, access_key, secret_key, ngrok_url]):
        return jsonify({"error": "MoMo not configured"}), 503

    amount       = 99000
    redirect_url = f"{frontend_url}/upgrade/success"
    ipn_url      = f"{ngrok_url}/api/payment/ipn"
    order_info   = "SubAI Premium (lifetime)"

    try:
        momo_resp, order_id = create_momo_payment(amount, order_info, redirect_url, ipn_url)
    except requests.RequestException as exc:
        return jsonify({"error": f"MoMo request failed: {exc}"}), 502

    result_code = momo_resp.get("resultCode", -1)
    if result_code != 0:
        return jsonify({"error": momo_resp.get("message", "MoMo error")}), 502

    payment_url = momo_resp.get("payUrl", "")

    supabase = _get_supabase_service()
    supabase.table("payments").insert({
        "user_id":        g.user_id,
        "momo_order_id":  order_id,
        "amount":         amount,
        "currency":       "VND",
        "status":         "pending",
    }).execute()

    return jsonify({"payment_url": payment_url, "order_id": order_id}), 200


@payment_bp.post("/ipn")
def payment_ipn():
    """
    POST /api/payment/ipn
    Receives MoMo IPN callback (server-to-server, no user auth).
    Idempotent: safe to call multiple times with the same order.
    """
    data = request.get_json(silent=True) or {}

    if not verify_momo_ipn(data):
        return jsonify({"error": "Invalid signature"}), 400

    order_id    = data.get("orderId", "")
    result_code = data.get("resultCode", -1)

    if result_code != 0:
        return jsonify({"ok": True}), 200

    supabase = _get_supabase_service()

    try:
        result = (
            supabase.table("payments")
            .select("id, user_id, status")
            .eq("momo_order_id", order_id)
            .single()
            .execute()
        )
        payment = result.data
    except Exception:
        return jsonify({"error": "Payment record not found"}), 404

    if not payment:
        return jsonify({"error": "Payment record not found"}), 404

    if payment.get("status") == "paid":
        return jsonify({"ok": True}), 200

    user_id = payment["user_id"]
    now     = datetime.now(timezone.utc).isoformat()

    supabase.table("payments").update({
        "status":  "paid",
        "paid_at": now,
    }).eq("momo_order_id", order_id).execute()

    supabase.table("profiles").update({
        "premium_until": "9999-12-31T23:59:59+00:00",
    }).eq("id", user_id).execute()

    return jsonify({"ok": True}), 200
