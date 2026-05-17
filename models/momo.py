"""
momo.py — MoMo payment helpers (HMAC-SHA256, create/verify).
"""

import hashlib
import hmac
import json
import os
import time
import uuid

import requests


MOMO_ENDPOINT = os.environ.get("MOMO_ENDPOINT", "https://test-payment.momo.vn/v2/gateway/api/create")


def _sign(secret_key: str, raw: str) -> str:
    return hmac.new(secret_key.encode(), raw.encode(), hashlib.sha256).hexdigest()


def create_momo_payment(amount: int, order_info: str, redirect_url: str, ipn_url: str) -> dict:
    """
    Call MoMo create-payment API. Returns the full JSON response from MoMo.
    Raises requests.RequestException on network failure.
    """
    partner_code = os.environ.get("MOMO_PARTNER_CODE", "")
    access_key   = os.environ.get("MOMO_ACCESS_KEY", "")
    secret_key   = os.environ.get("MOMO_SECRET_KEY", "")
    endpoint     = os.environ.get("MOMO_ENDPOINT", MOMO_ENDPOINT)

    request_id = str(uuid.uuid4())
    order_id   = f"{partner_code}_{int(time.time() * 1000)}"
    extra_data = ""
    request_type = "payWithMethod"

    raw = (
        f"accessKey={access_key}"
        f"&amount={amount}"
        f"&extraData={extra_data}"
        f"&ipnUrl={ipn_url}"
        f"&orderId={order_id}"
        f"&orderInfo={order_info}"
        f"&partnerCode={partner_code}"
        f"&redirectUrl={redirect_url}"
        f"&requestId={request_id}"
        f"&requestType={request_type}"
    )
    signature = _sign(secret_key, raw)

    payload = {
        "partnerCode":   partner_code,
        "accessKey":     access_key,
        "requestId":     request_id,
        "amount":        str(amount),
        "orderId":       order_id,
        "orderInfo":     order_info,
        "redirectUrl":   redirect_url,
        "ipnUrl":        ipn_url,
        "extraData":     extra_data,
        "requestType":   request_type,
        "signature":     signature,
        "lang":          "vi",
    }

    resp = requests.post(endpoint, json=payload, timeout=15)
    resp.raise_for_status()
    return resp.json(), order_id


def verify_momo_ipn(data: dict) -> bool:
    """
    Verify MoMo IPN HMAC-SHA256 signature.
    IPN fields used (alphabetical): accessKey, amount, extraData, message,
    orderId, orderInfo, orderType, partnerCode, payType, requestId,
    responseTime, resultCode, transId.
    """
    secret_key = os.environ.get("MOMO_SECRET_KEY", "")
    if not secret_key:
        return False

    received_sig = data.get("signature", "")
    raw = (
        f"accessKey={os.environ.get('MOMO_ACCESS_KEY', '')}"
        f"&amount={data.get('amount', '')}"
        f"&extraData={data.get('extraData', '')}"
        f"&message={data.get('message', '')}"
        f"&orderId={data.get('orderId', '')}"
        f"&orderInfo={data.get('orderInfo', '')}"
        f"&orderType={data.get('orderType', '')}"
        f"&partnerCode={data.get('partnerCode', '')}"
        f"&payType={data.get('payType', '')}"
        f"&requestId={data.get('requestId', '')}"
        f"&responseTime={data.get('responseTime', '')}"
        f"&resultCode={data.get('resultCode', '')}"
        f"&transId={data.get('transId', '')}"
    )
    expected = _sign(secret_key, raw)
    return hmac.compare_digest(expected, received_sig)
