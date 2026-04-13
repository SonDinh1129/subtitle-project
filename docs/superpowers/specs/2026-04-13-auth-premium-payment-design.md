# SubAI — Auth, Premium & Payment Design

**Date:** 2026-04-13  
**Status:** Approved  
**Scope:** Authentication (Supabase), Premium gating, PayOS one-time payment, Realtime logic improvements

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                     FRONTEND (React)                     │
│  Supabase JS SDK → manages session, JWT token           │
│  AuthContext → cung cấp user/session/profile cho app    │
│  ProtectedRoute → redirect /signin nếu chưa login       │
│  authFetch() → mọi API call gửi kèm Authorization JWT   │
└────────────────────┬────────────────────────────────────┘
                     │ HTTPS + Authorization: Bearer <JWT>
┌────────────────────▼────────────────────────────────────┐
│                   BACKEND (Flask)                        │
│  @require_auth → validate JWT bằng PyJWT                │
│  @require_premium → check premium_until > now()         │
│  POST /api/payment/create-order → tạo PayOS link        │
│  POST /api/payment/webhook → nhận confirm từ PayOS      │
│  GET  /api/auth/me → trả profile + is_premium           │
└────────────────────┬────────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        ▼                         ▼
┌───────────────┐         ┌───────────────┐
│   Supabase    │         │     PayOS     │
│  Auth + DB    │         │  QR/Momo/...  │
│  profiles     │         │  Webhook →    │
│  payments     │         │  Flask        │
└───────────────┘         └───────────────┘
```

**Flow tổng quát:**
1. User đăng ký/đăng nhập qua Supabase JS (Google OAuth hoặc email/password)
2. Supabase cấp JWT token, lưu tự động trong session
3. Mọi request tới Flask mang JWT trong `Authorization: Bearer <token>` header
4. Flask decode JWT bằng Supabase JWT secret — không gọi Supabase mỗi request
5. Khi upgrade: Flask tạo PayOS order → user thanh toán → PayOS webhook → `profiles.premium_until` set vĩnh viễn

---

## 2. Database Schema (Supabase)

### `profiles` — mở rộng từ `auth.users` (1-1)

```sql
id                      uuid        PRIMARY KEY  -- = auth.users.id
email                   text        NOT NULL
full_name               text
premium_until           timestamptz DEFAULT NULL  -- NULL = free; có date = premium
videos_used_this_month  int         DEFAULT 0
usage_reset_at          timestamptz DEFAULT now()
created_at              timestamptz DEFAULT now()
```

**Check premium:** `premium_until IS NOT NULL AND premium_until > now()`

**Lazy reset:** Khi user upload, Flask kiểm tra `usage_reset_at`. Nếu `(now.year, now.month) > (reset_at.year, reset_at.month)` → reset `videos_used_this_month = 0`, cập nhật `usage_reset_at`.

**Atomic increment:** Dùng Supabase RPC thay vì read-then-write để tránh race condition khi upload đồng thời:
```sql
-- Supabase function: increment_video_count(uid uuid)
UPDATE profiles SET videos_used_this_month = videos_used_this_month + 1
WHERE id = uid
```

### `payments` — lịch sử thanh toán

```sql
id               uuid        PRIMARY KEY DEFAULT gen_random_uuid()
user_id          uuid        REFERENCES profiles(id)
payos_order_id   text        UNIQUE
amount           int                      -- 99000
currency         text        DEFAULT 'VND'
status           text                     -- "pending" | "paid" | "cancelled"
paid_at          timestamptz DEFAULT NULL -- set khi webhook confirm
created_at       timestamptz DEFAULT now()
```

### RLS (Row Level Security)

- `profiles`: user chỉ SELECT/UPDATE row của chính họ (`auth.uid() = id`)
- `payments`: user chỉ SELECT của mình; INSERT/UPDATE chỉ qua Flask **service role key**

### Trigger auto-create profile

```sql
-- Tự động tạo profiles row khi user đăng ký
CREATE FUNCTION handle_new_user() RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (new.id, new.email, new.raw_user_meta_data->>'full_name');
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
```

---

## 3. Auth Flow (Frontend)

### `src/lib/supabase.ts` (file mới)

```ts
import { createClient } from '@supabase/supabase-js'
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)
```

### `AuthContext` (`src/app/context/AuthContext.tsx`)

Expose: `{ user, session, profile, isLoading, signOut, refreshProfile }`

```ts
// onAuthStateChange — không dùng getSession() một lần
const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
  setSession(session)
  setUser(session?.user ?? null)
  setIsLoading(false)
  if (session) fetchProfile()  // load profile khi có session
})
return () => subscription.unsubscribe()

async function refreshProfile() {
  const data = await authFetch('/auth/me').then(r => r.json()).catch(() => null)
  setProfile(data)
}
```

### `ProtectedRoute` (`src/app/components/ProtectedRoute.tsx`)

```tsx
if (isLoading) return <Spinner />          // chờ Supabase check session
if (!user) return <Navigate to="/signin" />
return children
```

**Routes được bảo vệ:** `/upload`, `/editor`

### SignIn/SignUp — thay mock bằng Supabase calls

```ts
// SignIn
await supabase.auth.signInWithPassword({ email, password })
await supabase.auth.signInWithOAuth({
  provider: 'google',
  options: { redirectTo: `${window.location.origin}/upload` }
})

// SignUp
const { data } = await supabase.auth.signUp({
  email, password,
  options: { data: { full_name } }
})
// Handle email-already-exists:
if (data.user?.identities?.length === 0) { /* show "Email đã tồn tại" */ }
// Handle confirmation email:
else { /* show "Kiểm tra email để xác nhận tài khoản" */ }
```

---

## 4. Flask JWT Middleware

### Dependencies mới

```
PyJWT>=2.8.0
supabase>=2.0.0   # service role client cho webhook
```

### `middleware/auth.py`

```python
import jwt, os, hmac, hashlib
from functools import wraps
from flask import request, jsonify, g
from datetime import datetime, timezone

SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET")

def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
        # SSE stream: fallback đọc token từ query param
        if not token:
            token = request.args.get("token", "")
        if not token:
            return jsonify({"error": "Unauthenticated"}), 401
        try:
            payload = jwt.decode(token, SUPABASE_JWT_SECRET,
                                 algorithms=["HS256"], audience="authenticated")
            g.user_id = payload["sub"]
        except jwt.ExpiredSignatureError:
            return jsonify({"error": "Token expired"}), 401
        except jwt.InvalidTokenError:
            return jsonify({"error": "Invalid token"}), 401
        return f(*args, **kwargs)
    return decorated

def require_premium(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not hasattr(g, 'user_id'):          # guard nếu quên @require_auth
            return jsonify({"error": "Unauthenticated"}), 401
        profile = get_profile(g.user_id)
        if not profile or not is_premium(profile):
            return jsonify({"error": "Premium required"}), 403
        return f(*args, **kwargs)
    return decorated
```

**Decorator order — require_auth luôn ở trên:**
```python
@require_auth      # chạy trước
@require_premium   # chạy sau khi đã có g.user_id
def upload(): ...
```

### Helper functions

```python
def get_profile(user_id: str) -> dict:
    """Cache profile vào g để tránh gọi Supabase nhiều lần per request."""
    if not hasattr(g, 'profile'):
        resp = supabase_service.table("profiles") \
            .select("*").eq("id", user_id).single().execute()
        g.profile = resp.data
    return g.profile

def is_premium(profile: dict) -> bool:
    pt = profile.get("premium_until")
    if not pt:
        return False
    premium_until = datetime.fromisoformat(pt)
    return premium_until > datetime.now(timezone.utc)

def needs_reset(profile: dict) -> bool:
    reset_at = datetime.fromisoformat(profile["usage_reset_at"])
    now = datetime.now(timezone.utc)
    return (now.year, now.month) > (reset_at.year, reset_at.month)
```

### Thay đổi routes hiện tại

```python
# /api/upload — thêm auth + free limit check
@subtitle_bp.post("/upload")
@require_auth
def upload_video():
    profile = get_profile(g.user_id)

    # Lazy reset tháng mới
    if needs_reset(profile):
        supabase_service.table("profiles").update({
            "videos_used_this_month": 0,
            "usage_reset_at": datetime.now(timezone.utc).isoformat()
        }).eq("id", g.user_id).execute()
        profile["videos_used_this_month"] = 0

    # Free limit
    if not is_premium(profile) and profile["videos_used_this_month"] >= 5:
        return jsonify({"error": "Monthly limit reached", "limit": 5}), 403

    # Realtime gate
    if process_mode == "realtime" and not is_premium(profile):
        return jsonify({"error": "Realtime requires Premium"}), 403

    # ... existing upload logic ...

    # Atomic increment sau khi upload thành công
    supabase_service.rpc('increment_video_count', {'uid': g.user_id}).execute()

# /api/jobs/<job_id>/stream — thêm auth + ownership
@subtitle_bp.get("/jobs/<job_id>/stream")
@require_auth
def stream_job_realtime(job_id: str):
    job = get_job(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    if job["user_id"] != g.user_id:
        return jsonify({"error": "Forbidden"}), 403
    # ... existing SSE logic ...

# /api/jobs/<job_id> — thêm ownership check
@subtitle_bp.get("/jobs/<job_id>")
@require_auth
def get_job_status(job_id: str):
    job = get_job(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    if job["user_id"] != g.user_id:
        return jsonify({"error": "Forbidden"}), 403
    # ... existing logic ...

# /api/auth/me — endpoint mới
@auth_bp.get("/auth/me")
@require_auth
def get_me():
    profile = get_profile(g.user_id)
    return jsonify({**profile, "is_premium": is_premium(profile)}), 200
```

---

## 5. PayOS Integration

### Env vars mới

```
PAYOS_CLIENT_ID=...
PAYOS_API_KEY=...
PAYOS_CHECKSUM_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_URL=...
FRONTEND_URL=http://localhost:5173
```

### `controllers/payment_controller.py` (file mới)

```python
@payment_bp.post("/payment/create-order")
@require_auth
def create_order():
    profile = get_profile(g.user_id)
    if is_premium(profile):
        return jsonify({"error": "Already premium"}), 400

    order_id = str(uuid.uuid4())

    supabase_service.table("payments").insert({
        "user_id": g.user_id,
        "payos_order_id": order_id,
        "amount": 99000,
        "status": "pending"
    }).execute()

    payos_response = payos_client.create_payment_link(
        order_id=order_id,
        amount=99000,
        description="SubAI Premium",
        return_url=f"{FRONTEND_URL}/upgrade/success",
        cancel_url=f"{FRONTEND_URL}/upgrade/cancel",
    )

    return jsonify({"payment_url": payos_response["checkoutUrl"]}), 200


@payment_bp.post("/payment/webhook")
def payment_webhook():
    payload   = request.get_json()
    signature = request.headers.get("x-payos-signature", "")

    if not verify_payos_signature(payload, signature, PAYOS_CHECKSUM_KEY):
        return jsonify({"error": "Invalid signature"}), 400

    order_id = payload.get("orderCode")
    status   = payload.get("status")

    # Fetch payment record
    payment = supabase_service.table("payments") \
        .select("status, user_id") \
        .eq("payos_order_id", order_id).single().execute()

    # Idempotent — skip nếu đã xử lý
    if payment.data["status"] == "paid":
        return jsonify({"ok": True}), 200

    if status != "PAID":
        supabase_service.table("payments").update({"status": "cancelled"}) \
            .eq("payos_order_id", order_id).execute()
        return jsonify({"ok": True}), 200

    user_id = payment.data["user_id"]

    supabase_service.table("payments").update({
        "status": "paid",
        "paid_at": datetime.now(timezone.utc).isoformat()
    }).eq("payos_order_id", order_id).execute()

    # One-time premium vĩnh viễn
    supabase_service.table("profiles").update({
        "premium_until": "9999-12-31T00:00:00+00:00"
    }).eq("id", user_id).execute()

    return jsonify({"ok": True}), 200


def verify_payos_signature(payload: dict, signature: str, checksum_key: str) -> bool:
    data_str = "&".join(f"{k}={v}" for k, v in sorted(payload.items()))
    h = hmac.HMAC(checksum_key.encode(), data_str.encode(), digestmod=hashlib.sha256)
    return hmac.compare_digest(h.hexdigest(), signature)
```

### Frontend — upgrade flow

```ts
// Nút "Nâng cấp"
const { payment_url } = await authFetch('/payment/create-order', { method: 'POST' }).then(r => r.json())
window.location.href = payment_url

// /upgrade/success — poll tối đa 10 lần × 2s
for (let i = 0; i < 10; i++) {
  const profile = await authFetch('/auth/me').then(r => r.json())
  if (profile.is_premium) {
    await refreshProfile()   // update AuthContext
    navigate('/upload')
    return
  }
  await new Promise(r => setTimeout(r, 2000))
}
// Timeout → "Thanh toán đang xử lý, vui lòng chờ"
```

---

## 6. Realtime Logic Improvements

### Vấn đề 1 — Không có `max_duration` cap (critical)

Video có speech liên tục → 1 chunk rất dài → Colab timeout + UX tệ.

**Fix — tách `split_long_segment` + thêm `max_duration` vào `merge_short_segments`:**

```python
def split_long_segment(seg: dict, max_duration: float = 25.0) -> list[dict]:
    if seg["end"] - seg["start"] <= max_duration:
        return [seg]
    parts, start = [], seg["start"]
    while start < seg["end"]:
        end = min(start + max_duration, seg["end"])
        parts.append({"start": round(start, 2), "end": round(end, 2)})
        start = end
    return parts

def merge_short_segments(
    segments: list[dict],
    min_duration: float = 2.0,
    max_duration: float = 25.0,
) -> list[dict]:
    merged, buffer = [], None
    for seg in segments:
        if buffer is None:
            buffer = seg.copy()
        else:
            if seg["end"] - buffer["start"] > max_duration:
                merged.append(buffer)
                buffer = seg.copy()
            else:
                buffer = {**buffer, "end": seg["end"]}
        if buffer["end"] - buffer["start"] >= min_duration:
            merged.append(buffer)
            buffer = None
    if buffer:
        merged.append(buffer)
    return merged

# Pipeline — split trước, merge sau:
flat_segments = []
for seg in raw_segments:
    flat_segments.extend(split_long_segment(seg))
segments = merge_short_segments(flat_segments,
    min_duration=1.5 if process_mode == "realtime" else 2.0)
```

### Vấn đề 2 — Queue memory leak

```python
def _cleanup_job_queue(job_id: str):
    with _job_event_lock:
        _job_event_queues.pop(job_id, None)

# Trong finally block của run_pipeline_realtime:
finally:
    _cleanup_job_queue(job_id)
    if os.path.exists(audio_path):
        os.remove(audio_path)
```

### Vấn đề 3 — SSE stream không auth (EventSource không support custom headers)

```ts
// Frontend — pass token qua query param
const token = session.access_token
new EventSource(`${BASE}/jobs/${jobId}/stream?token=${token}`)
```

```python
# Backend — đọc token từ query param nếu header không có
token = request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
if not token:
    token = request.args.get("token", "")
```

### Vấn đề 4 — Progress range bất đối xứng

```python
# Mở rộng transcribe range từ 40-85 → 30-90
progress = 30 + int(((idx + 1) / total) * 60)
```

### Vấn đề 5 — Colab skip segment làm lệch progress

```python
# Colab — yield kể cả khi skip, không dùng continue
yield f"data: {json.dumps({'index': idx, 'total': total, 'english_words': [], 'vietnamese_words': [], 'skipped': True})}\n\n"
```

```ts
// Frontend — bỏ qua khi render subtitle nhưng vẫn update progress
if (event.skipped) return  // skip append, progress vẫn update
```

---

## 7. Frontend Changes Summary

### Files mới
| File | Mục đích |
|------|----------|
| `src/lib/supabase.ts` | Supabase client singleton |
| `src/app/context/AuthContext.tsx` | Session, user, profile, refreshProfile |
| `src/app/components/ProtectedRoute.tsx` | Auth guard với isLoading spinner |
| `src/app/pages/UpgradePage.tsx` | So sánh Free/Premium + nút thanh toán |
| `src/app/pages/UpgradeSuccessPage.tsx` | Poll premium status sau thanh toán |

### Files sửa
| File | Thay đổi |
|------|----------|
| `src/lib/api.ts` | Thêm `authFetch()`, `getAuthHeader()`, sửa XHR upload |
| `src/app/App.tsx` | Wrap `AuthContext` |
| `src/app/routes.ts` | Wrap `/upload`, `/editor` bằng `ProtectedRoute`; thêm `/upgrade` routes |
| `src/app/pages/SignInPage.tsx` | Thay mock bằng Supabase calls thực |
| `src/app/pages/SignUpPage.tsx` | Thay mock, thêm email confirmation flow |
| `src/app/pages/UploadPage.tsx` | Premium gate trên Realtime button, dùng `useAuth().profile` |
| `src/app/pages/EditorPage.tsx` | Guard `jobId` từ location state |
| `src/app/components/Header.tsx` | User info + Crown icon premium badge |

### `getAuthHeader()` và `authFetch()` trong `api.ts`

```ts
// authFetch — chỉ cho JSON calls
async function authFetch(path: string, init?: RequestInit): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Unauthenticated')
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }
  })
}

// getAuthHeader — cho XHR upload (KHÔNG set Content-Type)
async function getAuthHeader(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Unauthenticated')
  return `Bearer ${session.access_token}`
}
```

### Profile trong AuthContext (tránh fetch riêng từng page)

```ts
// Mọi page dùng:
const { profile, refreshProfile } = useAuth()

// UploadPage — profile.is_premium thay vì local state
// Header — profile.is_premium cho Crown badge
// UpgradeSuccessPage — gọi refreshProfile() sau poll thành công
```

---

## 8. Environment Variables

### Frontend (`.env`)
```
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
VITE_API_URL=http://localhost:5000/api
```

### Backend (`.env`)
```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_JWT_SECRET=...          # từ Supabase dashboard > Settings > JWT
PAYOS_CLIENT_ID=...
PAYOS_API_KEY=...
PAYOS_CHECKSUM_KEY=...
COLAB_URL=https://xxx.ngrok-free.dev
SECRET_KEY=...
FRONTEND_URL=http://localhost:5173
```

---

## 9. Implementation Order

1. **Supabase setup** — tạo project, schema, RLS, trigger
2. **Flask middleware** — `require_auth`, `require_premium`, `get_profile`, env vars
3. **Auth endpoints** — `GET /api/auth/me`
4. **Frontend auth** — `supabase.ts`, `AuthContext`, `ProtectedRoute`, sửa SignIn/SignUp
5. **Job ownership** — gắn `user_id` vào job, thêm ownership check
6. **Free tier gating** — limit 5 video/tháng, block realtime
7. **PayOS** — `payment_controller.py`, `/upgrade` page, `/upgrade/success` poll
8. **Realtime fixes** — `split_long_segment`, max_duration, queue cleanup, SSE auth, progress range
