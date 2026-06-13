"""
test_ipn.py — Gửi một IPN giả lập (ký HMAC đúng như MoMo) tới Flask local
để xác minh luồng kích hoạt premium hoạt động, độc lập với sandbox MoMo.

Cách dùng:
    .venv\\Scripts\\python.exe scripts\\test_ipn.py MOMOBKUN20180529_1781314345729

orderId phải là một order đã tồn tại trong bảng `payments` (status=pending),
lấy từ dòng [CREATE] MoMo response trong log Flask.
"""
import hashlib
import hmac
import os
import sys

import requests
from dotenv import load_dotenv

# Nạp giống app.py: .env rồi .env.local override
load_dotenv(".env")
load_dotenv(".env.local", override=True)

ACCESS_KEY = os.environ.get("MOMO_ACCESS_KEY", "")
SECRET_KEY = os.environ.get("MOMO_SECRET_KEY", "")
PARTNER    = os.environ.get("MOMO_PARTNER_CODE", "")

if len(sys.argv) < 2:
    print("Thiếu orderId. Ví dụ: python scripts/test_ipn.py MOMOBKUN20180529_1781314345729")
    sys.exit(1)

order_id = sys.argv[1]

# Các field IPN — phải khớp THỨ TỰ ALPHABET trong verify_momo_ipn()
data = {
    "partnerCode":  PARTNER,
    "orderId":      order_id,
    "requestId":    order_id,
    "amount":       "99000",
    "orderInfo":    "SubAI Premium (1 year)",
    "orderType":    "momo_wallet",
    "transId":      "9999999999",
    "resultCode":   "0",
    "message":      "Successful.",
    "payType":      "qr",
    "responseTime": "1781314346245",
    "extraData":    "",
}

raw = (
    f"accessKey={ACCESS_KEY}"
    f"&amount={data['amount']}"
    f"&extraData={data['extraData']}"
    f"&message={data['message']}"
    f"&orderId={data['orderId']}"
    f"&orderInfo={data['orderInfo']}"
    f"&orderType={data['orderType']}"
    f"&partnerCode={data['partnerCode']}"
    f"&payType={data['payType']}"
    f"&requestId={data['requestId']}"
    f"&responseTime={data['responseTime']}"
    f"&resultCode={data['resultCode']}"
    f"&transId={data['transId']}"
)
data["signature"] = hmac.new(SECRET_KEY.encode(), raw.encode(), hashlib.sha256).hexdigest()

print(f"Gửi IPN giả lập cho orderId={order_id} ...")
resp = requests.post("http://localhost:5000/api/payment/ipn", json=data, timeout=15)
print(f"HTTP {resp.status_code}: {resp.text}")
