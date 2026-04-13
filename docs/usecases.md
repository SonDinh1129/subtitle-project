# SubAI — Use Cases

## UC-00: Tổng quan hệ thống

**Mô tả:** SubAI là ứng dụng tạo phụ đề tự động cho video. Người dùng upload video tiếng Anh, hệ thống nhận dạng giọng nói (ASR) bằng Whisper, dịch sang tiếng Việt (MT) bằng VinAI Translate, và tạo file phụ đề SRT với timestamp chính xác. Hệ thống hỗ trợ 2 chế độ xử lý: Normal (xử lý toàn bộ rồi trả kết quả) và Realtime (stream từng segment ngay khi xong — chỉ dành cho Premium). Người dùng có thể chỉnh sửa phụ đề trong editor tích hợp, tải file SRT, hoặc export video đã burn subtitle. Hệ thống phân biệt Free (5 video/tháng, không có realtime) và Premium (trả 99.000đ một lần, dùng mãi, unlimited + realtime).

**Actors:**
- **Guest** — chưa đăng nhập, chỉ xem landing page và đăng ký/đăng nhập
- **Free User** — đã đăng nhập, giới hạn 5 video/tháng, không có realtime
- **Premium User** — đã nâng cấp, unlimited video + realtime mode
- **PayOS** — hệ thống thanh toán bên ngoài, gửi webhook xác nhận
- **Colab Server** — hệ thống AI bên ngoài (Whisper + VinAI), xử lý ASR + MT

```
Guest → Đăng ký/Đăng nhập → Free User
                                  │
                         Upload video (Normal mode)
                                  │
                         Xem/Sửa subtitle trong Editor
                                  │
                         Download SRT hoặc Export video
                                  │
                         Nâng cấp Premium (PayOS 99.000đ)
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
| UC-04 | Đăng ký bằng email | Nhập name, email, password → nhận email xác nhận |
| UC-05 | Đăng ký bằng Google OAuth | Redirect Google → tạo tài khoản → redirect /upload |
| UC-06 | Đăng ký bằng GitHub OAuth | Redirect GitHub → tạo tài khoản → redirect /upload |
| UC-07 | Đăng nhập bằng email | Nhập email + password → redirect /upload |
| UC-08 | Đăng nhập bằng Google | OAuth flow → redirect /upload |
| UC-09 | Đăng nhập bằng GitHub | OAuth flow → redirect /upload |
| UC-10 | Quên mật khẩu | Nhập email → nhận link reset password |
| UC-11 | Truy cập trang protected | Truy cập /upload hoặc /editor khi chưa login → redirect /signin |

---

## Actor: Free User (đã đăng nhập, chưa premium)

### Upload & Processing

| # | Use Case | Mô tả |
|---|----------|-------|
| UC-12 | Upload video | Kéo thả hoặc chọn file video (MP4/MOV/MKV/AVI/WEBM, max 2GB) |
| UC-13 | Chọn chế độ xử lý Normal | Xử lý toàn bộ video rồi trả kết quả một lần |
| UC-14 | Bị chặn chế độ Realtime | Thấy lock icon + badge "Premium", không thể chọn |
| UC-15 | Xem tiến trình xử lý | Progress bar: extracting → VAD → transcribing → generating → done |
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
| UC-28 | Export video burned subtitle | Chọn ngôn ngữ + resolution (360p/720p/1080p) → tải video với subtitle đã burn |

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
| UC-32 | Chọn chế độ Realtime | Chọn realtime → upload → nhận subtitle từng segment qua SSE stream |
| UC-33 | Xem subtitle realtime | Subtitle hiện dần trong editor khi Colab xử lý từng segment |
| UC-34 | Upload không giới hạn | Không bị chặn sau 5 video/tháng |
| UC-35 | Xem badge Premium | Crown icon trên Header, badge trên profile |

> UC-12, UC-13, UC-15, UC-17 đến UC-30 áp dụng cho cả Premium user.

---

## Actor: PayOS (hệ thống bên ngoài)

| # | Use Case | Mô tả |
|---|----------|-------|
| UC-36 | Gửi webhook thanh toán | Sau user thanh toán → gọi POST /api/payment/webhook → Flask verify signature → activate premium |

---

## Actor: Colab Server (hệ thống bên ngoài)

| # | Use Case | Mô tả |
|---|----------|-------|
| UC-37 | Nhận audio segments | Flask gửi base64 audio → Colab xử lý ASR (Whisper) + MT (VinAI) |
| UC-38 | Stream kết quả realtime | Colab yield từng segment qua SSE → Flask relay → Frontend |
| UC-39 | Health check | Flask kiểm tra Colab connection qua GET /health |
