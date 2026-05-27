# SubAI — Use Cases

## UC-00: Tổng quan hệ thống

**Mô tả:** SubAI là ứng dụng tạo phụ đề tự động cho video. Người dùng upload video (tiếng Anh hoặc tiếng Việt), hệ thống nhận dạng giọng nói (ASR) và dịch sang ngôn ngữ đích, tạo file phụ đề SRT với timestamp chính xác. Hệ thống hỗ trợ 2 chế độ xử lý: Normal (batch qua HTTP) và Realtime (stream frame-by-frame qua WebSocket — chỉ dành cho Premium). Sử dụng 2 Colab VM: VM2 (Faster-Whisper + VinAI, normal mode + VI realtime) và VM1 (Kyutai stt-1b-en_fr + VinAI, EN realtime). Người dùng có thể chỉnh sửa phụ đề trong editor tích hợp, tải file SRT, hoặc export video đã burn subtitle (async). Hệ thống phân biệt Free (5 video/tháng, không có realtime) và Premium (trả 99.000đ qua MoMo, Premium 1 năm, unlimited + realtime).

**Actors:**
- **Guest** — chưa đăng nhập, chỉ xem landing page và đăng ký/đăng nhập
- **Free User** — đã đăng nhập, giới hạn 5 video/tháng, không có realtime
- **Premium User** — đã nâng cấp, unlimited video + realtime mode (Premium 1 năm)
- **MoMo** — hệ thống thanh toán bên ngoài, gửi IPN xác nhận
- **Colab VM2 (COLAB_URL)** — batch ASR+MT (Faster-Whisper + VinAI) + VI realtime (Silero VAD + PhoWhisper-large), endpoint `/transcribe_translate` và `/ws/transcribe_vi_realtime`
- **Colab VM1 (COLAB_REALTIME_URL)** — EN realtime (Kyutai stt-1b-en_fr + VinAI EN→VI), endpoint `/ws/transcribe_kyutai`

```
Guest → Đăng ký/Đăng nhập → Free User
                                  │
                         Upload video (Normal mode)
                                  │
                         Xem/Sửa subtitle trong Editor
                                  │
                         Download SRT hoặc Export video
                                  │
                         Nâng cấp Premium (MoMo 99.000đ)
                                  │
                            Premium User
                                  │
                         Upload video (Realtime mode)
                                  │
                         Xem subtitle stream realtime
                                  │
                         Download SRT hoặc Export video
```

---

## Actor: Guest (chưa đăng nhập)

| # | Use Case | Mô tả |
|---|----------|-------|
| UC-01 | Xem Landing Page | Xem giới thiệu, tính năng, pricing, docs |
| UC-02 | Chuyển đổi ngôn ngữ UI | Chuyển giữa Tiếng Việt / English |
| UC-03 | Chuyển đổi theme | Chuyển giữa Light / Dark mode |
| UC-04 | Đăng ký bằng email | Nhập name, email, password → nhận mã OTP 6 số qua email → nhập OTP để xác minh → redirect /upload |
| UC-05 | Đăng ký bằng Google OAuth | Redirect Google → tạo tài khoản → redirect /upload |
| UC-06 | Đăng ký bằng GitHub OAuth | Redirect GitHub → tạo tài khoản → redirect /upload |
| UC-07 | Đăng nhập bằng email | Nhập email + password → redirect /upload |
| UC-08 | Đăng nhập bằng Google | OAuth flow → redirect /upload |
| UC-09 | Đăng nhập bằng GitHub | OAuth flow → redirect /upload |
| UC-10 | Quên mật khẩu | Nhập email → nhận mã OTP 6 số qua email → nhập OTP → đặt mật khẩu mới → redirect /upload |
| UC-11 | Truy cập trang protected | Truy cập /upload hoặc /editor khi chưa login → redirect /signin |

---

## Actor: Free User (đã đăng nhập, chưa premium)

### Upload & Processing

| # | Use Case | Mô tả |
|---|----------|-------|
| UC-12 | Upload video | Kéo thả hoặc chọn file video (MP4/MOV/MKV/AVI/WEBM, max 2GB), chọn source_lang (en/vi) |
| UC-13 | Chọn chế độ xử lý Normal | Batch qua HTTP: Flask → Colab VM2 POST `/transcribe_translate` → trả kết quả một lần |
| UC-14 | Bị chặn chế độ Realtime | Thấy lock icon + badge "Premium", không thể chọn |
| UC-15 | Xem tiến trình xử lý | Progress bar: extracting → transcribing → generating → done |
| UC-16 | Upload bị giới hạn | Upload > 5 video/tháng → hiển thị thông báo "limit reached" + gợi ý upgrade |

### Editor

| # | Use Case | Mô tả |
|---|----------|-------|
| UC-17 | Xem video với subtitle | Video player hiển thị subtitle EN/VI realtime theo timestamp |
| UC-18 | Chuyển đổi hiển thị subtitle | Off / EN-only / VI-only / Dual (VI top) / Dual (EN top) |
| UC-19 | Chỉnh sửa subtitle text | Click vào subtitle → sửa nội dung |
| UC-20 | Chỉnh sửa timestamp | Sửa start/end time của từng subtitle |
| UC-21 | Thêm subtitle mới | Thêm subtitle segment tại vị trí bất kỳ |
| UC-22 | Xóa subtitle | Xóa subtitle segment đã chọn |
| UC-23 | Undo / Redo | Hoàn tác / làm lại thay đổi |
| UC-24 | Tìm kiếm subtitle | Search text trong danh sách subtitle |
| UC-25 | Tùy chỉnh font/size/màu | Thay đổi font, cỡ chữ, màu sắc subtitle preview |

### Export & Download

| # | Use Case | Mô tả |
|---|----------|-------|
| UC-26 | Tải file SRT tiếng Anh | Download subtitles_en.srt |
| UC-27 | Tải file SRT tiếng Việt | Download subtitles_vi.srt |
| UC-28 | Export video burned subtitle | Chọn ngôn ngữ + resolution (360p/720p/1080p) → POST /export → 202 + polling → tải video với subtitle đã burn |
| UC-41 | Đánh giá chất lượng bản dịch | GET /api/jobs/:id/translation-quality → gửi toàn bộ cặp EN/VI lên ChatGPT → trả điểm trung bình + chi tiết từng cặp (LLM-as-judge) |

### Account

| # | Use Case | Mô tả |
|---|----------|-------|
| UC-29 | Xem thông tin tài khoản | Xem email, tên, trạng thái (Free), số video đã dùng trong tháng |
| UC-30 | Đăng xuất | Sign out → xóa session → redirect landing page |
| UC-31 | Xem trang Upgrade | So sánh Free vs Premium, xem giá 99.000đ |

---

## Actor: Premium User (đã nâng cấp)

| # | Use Case | Mô tả |
|---|----------|-------|
| UC-32 | Chọn chế độ Realtime | Chọn realtime + source_lang → upload → redirect ngay sang Editor |
| UC-33 | Xem subtitle realtime | Subtitle hiện dần qua SSE; backend stream PCM frames tới Colab WebSocket (EN: VM1 `/ws/transcribe_kyutai` 80ms/24kHz, VI: VM2 `/ws/transcribe_vi_realtime` 32ms/16kHz) |
| UC-34 | Upload không giới hạn | Không bị chặn sau 5 video/tháng |
| UC-35 | Xem badge Premium | Crown icon trên Header, badge trên profile |

> UC-12, UC-13, UC-15, UC-17 đến UC-30 áp dụng cho cả Premium user.

---

## Actor: MoMo (hệ thống bên ngoài)

| # | Use Case | Mô tả |
|---|----------|-------|
| UC-36 | Gửi IPN thanh toán | Sau user thanh toán → gọi POST /api/payment/ipn → Flask verify MoMo signature → activate premium 1 năm; luôn trả 200 |

---

## Actor: Colab VM2 — COLAB_URL (hệ thống bên ngoài)

| # | Use Case | Mô tả |
|---|----------|-------|
| UC-37 | Normal ASR+MT (EN) | Flask gửi base64 audio segments → VM2 Faster-Whisper large-v3 + VinAI EN→VI → trả kết quả |
| UC-37b | Normal ASR (VI) | Flask gửi base64 audio → VM2 PhoWhisper-large → trả kết quả tiếng Việt |
| UC-38 | VI Realtime WebSocket | Flask stream 32ms/16kHz PCM frames → VM2 `/ws/transcribe_vi_realtime` (Silero VAD + PhoWhisper-large) → yield segments |
| UC-39 | Health check | Flask kiểm tra VM2 connection qua GET /health |

## Actor: Colab VM1 — COLAB_REALTIME_URL (hệ thống bên ngoài)

| # | Use Case | Mô tả |
|---|----------|-------|
| UC-40 | EN Realtime WebSocket | Flask stream 80ms/24kHz PCM frames → VM1 `/ws/transcribe_kyutai` (Kyutai stt-1b-en_fr + VinAI EN→VI) → yield segments |
