"""
payment_controller.py — MoMo payment endpoints
───────────────────────────────────────────────
Routes:
  POST /api/payment/create-order  — create MoMo order, return payment URL
  POST /api/payment/ipn           — receive MoMo IPN (server-to-server)
"""

import logging
import os
from datetime import datetime, timezone

import requests
from dateutil.relativedelta import relativedelta
from flask import Blueprint, g, request, jsonify

from middleware.auth import require_auth, get_profile, is_premium, _get_supabase_service
from extensions import limiter
from models.momo import create_momo_payment, verify_momo_ipn

payment_bp = Blueprint("payment", __name__)
logger = logging.getLogger(__name__)


@payment_bp.post("/create-order")
@require_auth
@limiter.limit("3/minute")
def create_order():
    """
    POST /api/payment/create-order
    Creates a MoMo payment order for premium upgrade (99,000 VND a year).
    Returns { payment_url } to redirect user to MoMo checkout.
    """
    try:
        profile = get_profile(g.user_id)
    except RuntimeError:
        return jsonify({"error": "Service temporarily unavailable"}), 503
    if not profile:
        return jsonify({"error": "Profile not found"}), 404

    if is_premium(profile):
        return jsonify({"error": "Already premium"}), 409

    partner_code = os.environ.get("MOMO_PARTNER_CODE", "")
    access_key   = os.environ.get("MOMO_ACCESS_KEY", "")
    secret_key   = os.environ.get("MOMO_SECRET_KEY", "")
    ngrok_url    = os.environ.get("NGROK_URL", "").rstrip("/")
    # redirectUrl = where MoMo sends the BROWSER back after payment. Use a local
    # URL (REDIRECT_BASE_URL, default the first FRONTEND_URL origin) so the user
    # lands directly on the app — routing the browser through the ngrok domain
    # triggers ngrok's free "You are about to visit" interstitial warning page.
    # ipnUrl = server-to-server callback; this MUST be the public ngrok tunnel.
    redirect_base = (
        os.environ.get("REDIRECT_BASE_URL", "").rstrip("/")
        or os.environ.get("FRONTEND_URL", "http://localhost:5000").split(",")[0].strip().rstrip("/")
    )

    if not all([partner_code, access_key, secret_key, ngrok_url]):
        return jsonify({"error": "MoMo not configured"}), 503

    amount       = 99000
    redirect_url = f"{redirect_base}/upgrade/success"
    ipn_url      = f"{ngrok_url}/api/payment/ipn"
    order_info   = "SubAI Premium (1 year)"

    logger.info("[CREATE] redirect_url=%s ipn_url=%s", redirect_url, ipn_url)
    try:
        momo_resp, order_id = create_momo_payment(amount, order_info, redirect_url, ipn_url)
    except requests.RequestException as exc:
        return jsonify({"error": f"MoMo request failed: {exc}"}), 502

    logger.info("[CREATE] MoMo response: %s", momo_resp)
    result_code = momo_resp.get("resultCode", -1)
    if result_code != 0:
        return jsonify({"error": momo_resp.get("message", "MoMo error")}), 502

    payment_url = momo_resp.get("payUrl", "")

    try:
        supabase = _get_supabase_service()
        supabase.table("payments").insert({
            "user_id":        g.user_id,
            "momo_order_id":  order_id,
            "amount":         amount,
            "currency":       "VND",
            "status":         "pending",
        }).execute()
    except Exception as exc:
        logger.error("Failed to insert payment record for user %s: %s", g.user_id, exc)
        return jsonify({"error": "Failed to record order"}), 503

    return jsonify({"payment_url": payment_url, "order_id": order_id}), 200


@payment_bp.post("/ipn")
def payment_ipn():
    """
    POST /api/payment/ipn
    Receives MoMo IPN callback (server-to-server, no user auth).
    Always returns 200 (MoMo retries on non-200 responses).
    Idempotent: safe to call multiple times with the same order.
    """
    data = request.get_json(silent=True) or {}

    # Log without the signature field to prevent replay attacks via log access
    safe_log = {k: v for k, v in data.items() if k != "signature"}
    logger.info("[IPN] received: %s", safe_log)

    if not verify_momo_ipn(data):
        logger.warning("[IPN] signature FAILED for orderId=%s", data.get("orderId"))
        # Still return 200 — MoMo must not retry on signature failure
        return jsonify({"ok": False, "error": "Invalid signature"}), 200

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
    except Exception as exc:
        logger.error("[IPN] DB lookup failed for orderId=%s: %s", order_id, exc)
        return jsonify({"ok": False, "error": "DB error"}), 200

    if not payment:
        logger.warning("[IPN] no payment record for orderId=%s", order_id)
        return jsonify({"ok": False, "error": "Payment record not found"}), 200

    if payment.get("status") == "paid":
        return jsonify({"ok": True}), 200

    user_id = payment["user_id"]
    now           = datetime.now(timezone.utc)
    # Use relativedelta to handle leap-year boundaries (e.g. Feb 29 + 1 year)
    premium_until = now + relativedelta(years=1)

    try:
        supabase.table("payments").update({
            "status":  "paid",
            "paid_at": now.isoformat(),
        }).eq("momo_order_id", order_id).execute()

        supabase.table("profiles").update({
            "premium_until": premium_until.isoformat(),
        }).eq("id", user_id).execute()
    except Exception as exc:
        logger.error("[IPN] Failed to update payment/profile for orderId=%s: %s", order_id, exc)
        return jsonify({"ok": False, "error": "DB update failed"}), 200

    return jsonify({"ok": True}), 200
