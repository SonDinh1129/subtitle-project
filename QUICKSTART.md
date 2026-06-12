# SubAI — Hướng dẫn sử dụng nhanh

> Bản tóm tắt. Tài liệu kỹ thuật đầy đủ (kiến trúc, thuật toán, từng tầng) xem [README.md](README.md).

SubAI: upload video → AI tạo & dịch phụ đề (EN/VI) → chỉnh trong editor → xuất SRT hoặc video gắn phụ đề.

- **Backend**: Flask (MVC) — `controllers/` (HTTP) → `models/` (logic + AI) → JSON
- **Frontend**: React 18 + Vite + Tailwind (`src/`)
- **Auth**: Supabase · **Thanh toán**: MoMo · **AI nặng**: Google Colab qua ngrok

---

## 1. Cài đặt

```powershell
pnpm install                                      # frontend
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt     # backend
Copy-Item .env.example .env                        # rồi điền giá trị
```

**Biến bắt buộc** trong `.env` (xem đầy đủ ở [.env.example](.env.example)):
`SECRET_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `COLAB_URL` (ngrok của Colab, **không để placeholder**).
Frontend dùng `VITE_*` trong `.env.local`. Thanh toán cần `MOMO_*` + `NGROK_URL`.

---

## 2. Chạy

```powershell
pnpm dev      # chạy Vite (5173) + Flask (5000) + ngrok cùng lúc
```

Hoặc riêng lẻ:

```powershell
.venv\Scripts\python.exe app.py    # backend → http://localhost:5000
pnpm vite --port 5173              # frontend → http://localhost:5173
```

> ⚠️ Bật VM Colab và trỏ đúng `COLAB_URL` trước — nếu là placeholder, backend sẽ báo lỗi khi khởi động.

---

## 3. Luồng sử dụng (người dùng)

1. Đăng ký / đăng nhập (`/signup`, `/signin`) — Supabase, có xác nhận email.
2. **Upload** video (`/upload`) — chọn ngôn ngữ nguồn + chế độ: *Normal* (xử lý cả file) hoặc *Realtime* (stream trực tiếp).
3. **Editor** (`/editor`) — xem/chỉnh phụ đề, đổi font/màu/vị trí, tối ưu (Premium).
4. **Export** — tải SRT hoặc video đã gắn phụ đề.

---

## 4. API tóm tắt (prefix `/api`)

Route dữ liệu cần đăng nhập (Bearer token Supabase). Download trong trình duyệt phải kèm `?token=`.

| Method | Endpoint | Mô tả |
|---|---|---|
| GET | `/health` | Server + kết nối Colab |
| POST | `/upload` | Upload → tạo job (≤5/phút) |
| GET | `/jobs/<id>` | Trạng thái job |
| GET | `/jobs/<id>/stream` | SSE — tiến độ realtime |
| GET | `/jobs/<id>/srt-url` | Link SRT đã ký |
| POST | `/export` · GET `/export-status/<id>` · `/exports/<file>` | Xuất & tải video |
| POST | `/jobs/<id>/optimize` | Tối ưu phụ đề |

**Auth** (`/api/auth`): `me`, `change-password`, `account` (DELETE), `sse-token`.
**Payment** (`/api/payment`): `create-order` (MoMo), `ipn` (callback, xác minh chữ ký).

---

## 5. Test & Build

```powershell
.venv\Scripts\python.exe -m pytest    # test backend
pnpm build                            # build frontend → views/static (Flask tự phục vụ tại /)
```

---

## 6. MoMo Sandbox (test thanh toán)

- Endpoint test mặc định: `https://test-payment.momo.vn/...`; IPN cần `NGROK_URL` public.
- Trên MoMo Test App: **OTP/mật khẩu = `000000`**; thẻ ATM test `9704 0000 0000 0018` (thành công).
