# SubAI — Bảng Use Case Detail

---

## Diagram 1 — Xác thực

---

### UC-04: Đăng ký Email

| Trường | Nội dung |
|--------|----------|
| **Mã UC** | UC-04 |
| **Tên** | Đăng ký tài khoản bằng Email |
| **Actor** | Guest |
| **Mô tả** | Guest điền form email + mật khẩu + họ tên, hệ thống tạo tài khoản và gửi OTP xác minh email |
| **Tiền điều kiện** | Guest chưa đăng nhập; email chưa được đăng ký |
| **Hậu điều kiện** | Tài khoản được tạo, email được xác minh, user được chuyển vào trạng thái Free User |
| **Luồng chính** | 1. Guest mở trang Đăng ký<br>2. Nhập họ tên, email, mật khẩu, tích chấp nhận điều khoản<br>3. Hệ thống gửi OTP 6 số về email<br>4. Guest nhập OTP<br>5. Hệ thống xác minh OTP → tạo tài khoản → chuyển đến trang Upload |
| **Luồng thay thế** | 4a. OTP sai hoặc hết hạn → hiện lỗi, cho phép nhập lại hoặc gửi lại<br>4b. Guest nhấn "Gửi lại" → hệ thống gửi OTP mới (countdown 60s) |
| **Luồng ngoại lệ** | 3a. Email đã tồn tại → hiện lỗi "Email này đã được đăng ký"<br>3b. Mật khẩu < 8 ký tự → hiện lỗi validation |
| **Quan hệ** | — |

---

### UC-05/06: Đăng ký / Đăng nhập OAuth (Google)

| Trường | Nội dung |
|--------|----------|
| **Mã UC** | UC-05/06 |
| **Tên** | Đăng ký / Đăng nhập bằng Google OAuth |
| **Actor** | Guest |
| **Mô tả** | Guest xác thực qua Google, hệ thống tự tạo hoặc nhận diện tài khoản |
| **Tiền điều kiện** | Guest chưa đăng nhập |
| **Hậu điều kiện** | Tài khoản được tạo mới (nếu lần đầu) hoặc đăng nhập thành công; user ở trạng thái Free User |
| **Luồng chính** | 1. Guest nhấn "Đăng nhập bằng Google"<br>2. Trình duyệt chuyển đến trang xác thực Google<br>3. Guest chọn tài khoản Google và cấp quyền<br>4. Google redirect về `/auth/callback` với authorization code<br>5. Hệ thống tạo session → chuyển đến trang Upload |
| **Luồng ngoại lệ** | 3a. Guest huỷ xác thực Google → quay lại trang đăng nhập<br>5a. Callback lỗi → hiện thông báo lỗi |
| **Quan hệ** | — |

---

### UC-07: Đăng nhập Email

| Trường | Nội dung |
|--------|----------|
| **Mã UC** | UC-07 |
| **Tên** | Đăng nhập bằng Email và mật khẩu |
| **Actor** | Guest |
| **Mô tả** | Guest nhập email + mật khẩu để đăng nhập vào tài khoản đã có |
| **Tiền điều kiện** | Guest chưa đăng nhập; đã có tài khoản |
| **Hậu điều kiện** | Session được tạo, user chuyển thành Free User hoặc Premium User tuỳ trạng thái |
| **Luồng chính** | 1. Guest mở trang Đăng nhập<br>2. Nhập email và mật khẩu<br>3. Hệ thống xác minh thông tin<br>4. Tạo session → chuyển đến trang trước đó hoặc Upload |
| **Luồng ngoại lệ** | 3a. Sai email hoặc mật khẩu → hiện lỗi chung "Thông tin không đúng"<br>3b. Quá nhiều lần thử (429) → hiện lỗi rate limit |
| **Quan hệ** | — |

---

### UC-10: Quên mật khẩu

| Trường | Nội dung |
|--------|----------|
| **Mã UC** | UC-10 |
| **Tên** | Đặt lại mật khẩu qua OTP |
| **Actor** | Guest |
| **Mô tả** | Guest nhập email, nhận OTP 6 số, xác minh OTP rồi đặt mật khẩu mới |
| **Tiền điều kiện** | Guest chưa đăng nhập; email đã tồn tại trong hệ thống |
| **Hậu điều kiện** | Mật khẩu được cập nhật; user được đăng nhập và chuyển đến Upload |
| **Luồng chính** | 1. Guest nhấn "Quên mật khẩu" trên trang Đăng nhập<br>2. Nhập địa chỉ email<br>3. Hệ thống gửi OTP 6 số về email<br>4. Guest nhập OTP<br>5. Hệ thống xác minh OTP (type: recovery)<br>6. Guest nhập mật khẩu mới + xác nhận<br>7. Hệ thống cập nhật mật khẩu → đăng nhập → chuyển đến Upload |
| **Luồng thay thế** | 4a. OTP sai hoặc hết hạn → hiện lỗi, cho phép nhập lại<br>4b. Guest nhấn "Gửi lại" → OTP mới (countdown 60s) |
| **Luồng ngoại lệ** | 2a. Email không tồn tại → hệ thống vẫn hiện "OTP đã được gửi" (tránh lộ thông tin)<br>6a. Mật khẩu mới < 8 ký tự → hiện lỗi validation |
| **Quan hệ** | — |

---

### UC-11: Kiểm tra xác thực

| Trường | Nội dung |
|--------|----------|
| **Mã UC** | UC-11 |
| **Tên** | Kiểm tra trạng thái xác thực (internal) |
| **Actor** | System (internal — không do actor kích hoạt trực tiếp) |
| **Mô tả** | Hệ thống xác minh JWT token hợp lệ trước khi cho phép thực hiện các UC yêu cầu đăng nhập |
| **Tiền điều kiện** | Có JWT token trong request |
| **Hậu điều kiện** | Token hợp lệ → tiếp tục UC gốc; token không hợp lệ → redirect đến trang đăng nhập |
| **Luồng chính** | 1. UC gốc gọi UC-11 (<<include>>)<br>2. Backend verify JWT với Supabase<br>3. Trích xuất `user_id` từ token<br>4. Trả kết quả về UC gốc |
| **Luồng ngoại lệ** | 2a. Token hết hạn → 401, redirect đăng nhập<br>2b. Token không hợp lệ → 401, redirect đăng nhập |
| **Quan hệ** | `<<include>>` bởi UC-12, UC-32, UC-17 |

---

## Diagram 2 — Upload & Xử lý / Editor / Xuất kết quả

---

### UC-12/13/15: Upload Normal Mode

| Trường | Nội dung |
|--------|----------|
| **Mã UC** | UC-12/13/15 |
| **Tên** | Upload video và xử lý chế độ Normal |
| **Actor** | Free User |
| **Mô tả** | User upload file video, hệ thống xử lý phiên âm theo chế độ Normal (chờ kết quả), kết quả trả về khi hoàn tất |
| **Tiền điều kiện** | User đã đăng nhập; chưa vượt giới hạn 5 video/tháng (Free) |
| **Hậu điều kiện** | Job được tạo và xử lý; user được chuyển đến Editor khi xong |
| **Luồng chính** | 1. User chọn file video (mp4/mkv/mov...)<br>2. Chọn ngôn ngữ và chế độ Normal<br>3. Hệ thống upload file, tạo job<br>4. Hiển thị progress bar tiến trình<br>5. Colab VM2 xử lý xong → trả kết quả<br>6. Hệ thống chuyển user vào Editor |
| **Luồng thay thế** | 5a. Xử lý lỗi → hiện thông báo lỗi, cho phép thử lại |
| **Luồng ngoại lệ** | 1a. File không đúng định dạng → hiện lỗi validation<br>1b. File quá lớn → hiện lỗi size limit |
| **Quan hệ** | `<<include>>` UC-11<br>`<<extend>>` bởi UC-14 (khi bị chặn)<br>`<<uses>>` Colab VM2 |

---

### UC-32/33: Upload Realtime Mode

| Trường | Nội dung |
|--------|----------|
| **Mã UC** | UC-32/33 |
| **Tên** | Upload video và xử lý chế độ Realtime |
| **Actor** | Premium User |
| **Mô tả** | User upload video, hệ thống stream kết quả phiên âm theo từng đoạn realtime qua SSE |
| **Tiền điều kiện** | User là Premium; đã đăng nhập |
| **Hậu điều kiện** | Subtitle được tạo từng phần realtime; user chuyển vào Editor khi hoàn tất |
| **Luồng chính** | 1. User chọn file video<br>2. Chọn ngôn ngữ (EN hoặc VI) và chế độ Realtime<br>3. Hệ thống upload, tạo job<br>4. Kết nối SSE stream từ backend<br>5. Colab VM1 (EN) hoặc VM2 (VI) xử lý và stream kết quả từng chunk<br>6. Frontend hiển thị subtitle tích luỹ realtime<br>7. Stream kết thúc → chuyển vào Editor |
| **Luồng ngoại lệ** | 2a. User không phải Premium → UC-14 extend (bị chặn)<br>5a. Mất kết nối SSE → hiện lỗi, cho phép reconnect |
| **Quan hệ** | `<<include>>` UC-11<br>`<<extend>>` UC-12 (mở rộng từ Normal flow)<br>`<<uses>>` Colab VM1 (EN), Colab VM2 (VI) |

---

### UC-14/16: Bị chặn / Limit

| Trường | Nội dung |
|--------|----------|
| **Mã UC** | UC-14/16 |
| **Tên** | Bị chặn do giới hạn tài khoản |
| **Actor** | Free User |
| **Mô tả** | Hệ thống chặn hành động khi user vượt giới hạn (5 video/tháng) hoặc cố dùng tính năng Premium |
| **Tiền điều kiện** | User đang thực hiện UC-12 hoặc UC-32 |
| **Hậu điều kiện** | Hành động bị từ chối; user được hướng đến trang Nâng cấp |
| **Luồng chính** | 1. User kích hoạt UC-12 hoặc UC-32<br>2. Hệ thống kiểm tra quota hoặc quyền Premium<br>3. Phát hiện vượt giới hạn → hiện thông báo<br>4. Hiện nút "Nâng cấp Premium" → navigate đến UC-31 |
| **Quan hệ** | `<<extend>>` UC-12 |

---

### UC-17: Xem video + subtitle

| Trường | Nội dung |
|--------|----------|
| **Mã UC** | UC-17 |
| **Tên** | Xem video kèm subtitle trong Editor |
| **Actor** | Free User |
| **Mô tả** | User xem lại video đã upload với subtitle được overlay và đồng bộ theo thời gian |
| **Tiền điều kiện** | User đã đăng nhập; job xử lý hoàn tất |
| **Hậu điều kiện** | Video và subtitle hiển thị đồng bộ trong Editor |
| **Luồng chính** | 1. User vào trang Editor (sau khi job xong)<br>2. Hệ thống load video và dữ liệu subtitle<br>3. Video player hiển thị với subtitle overlay<br>4. User có thể play/pause/seek |
| **Quan hệ** | `<<include>>` UC-11<br>`<<include>>` bởi UC-18, UC-26, UC-28 |

---

### UC-18/19/20: Chỉnh sửa subtitle

| Trường | Nội dung |
|--------|----------|
| **Mã UC** | UC-18/19/20 |
| **Tên** | Chỉnh sửa nội dung subtitle |
| **Actor** | Free User |
| **Mô tả** | User chỉnh sửa text, thời gian, style của từng subtitle segment trong Editor |
| **Tiền điều kiện** | UC-17 đang active (đang xem video trong Editor) |
| **Hậu điều kiện** | Subtitle được cập nhật và đồng bộ với video |
| **Luồng chính** | 1. User click vào subtitle segment cần sửa<br>2. Nhập text mới hoặc chỉnh thời gian bắt đầu/kết thúc<br>3. Thay đổi được áp dụng realtime trên video<br>4. User có thể chỉnh font, size, màu sắc subtitle |
| **Quan hệ** | `<<include>>` UC-17 |

---

### UC-26/27: Download SRT

| Trường | Nội dung |
|--------|----------|
| **Mã UC** | UC-26/27 |
| **Tên** | Tải file subtitle định dạng SRT |
| **Actor** | Free User |
| **Mô tả** | User tải file .srt của subtitle đã chỉnh sửa về máy |
| **Tiền điều kiện** | UC-17 đang active; job đã có kết quả subtitle |
| **Hậu điều kiện** | File .srt được tải về máy user |
| **Luồng chính** | 1. User nhấn "Download SRT" trong Editor<br>2. Hệ thống tạo file .srt từ dữ liệu subtitle hiện tại<br>3. Trình duyệt tải file về máy |
| **Quan hệ** | `<<include>>` UC-17 |

---

### UC-28: Export video burned

| Trường | Nội dung |
|--------|----------|
| **Mã UC** | UC-28 |
| **Tên** | Xuất video đã burn subtitle |
| **Actor** | Free User |
| **Mô tả** | User chọn độ phân giải và xuất video với subtitle được burn cứng vào frame |
| **Tiền điều kiện** | UC-17 đang active; job đã có kết quả subtitle |
| **Hậu điều kiện** | Video mới với subtitle burned được tạo; user tải về hoặc nhận link download |
| **Luồng chính** | 1. User nhấn "Export video" trong Editor<br>2. Chọn độ phân giải (360p / 720p / 1080p)<br>3. Hệ thống xử lý burn subtitle vào video (backend)<br>4. Hiển thị progress<br>5. Hoàn tất → hiện nút tải về |
| **Luồng ngoại lệ** | 3a. Xử lý lỗi → hiện thông báo lỗi |
| **Quan hệ** | `<<include>>` UC-17 |

---

## Diagram 3 — Tài khoản & Thanh toán

---

### UC-29: Xem thông tin tài khoản

| Trường | Nội dung |
|--------|----------|
| **Mã UC** | UC-29 |
| **Tên** | Xem và chỉnh sửa thông tin tài khoản |
| **Actor** | Free User |
| **Mô tả** | User xem thông tin cá nhân, chỉnh sửa họ tên, đổi mật khẩu, hoặc xóa tài khoản |
| **Tiền điều kiện** | User đã đăng nhập |
| **Hậu điều kiện** | Thông tin được cập nhật trên hệ thống |
| **Luồng chính** | 1. User vào trang `/profile` qua menu Header<br>2. Hệ thống hiển thị email (read-only), họ tên, ngày tham gia<br>3. User có thể chỉnh sửa họ tên → nhấn "Lưu thay đổi"<br>4. User có thể đổi mật khẩu: nhập mật khẩu hiện tại → mật khẩu mới → xác nhận<br>5. Hệ thống xác minh mật khẩu cũ trước khi cập nhật |
| **Luồng thay thế** | 4a. Mật khẩu hiện tại sai → hiện lỗi, không thực hiện đổi<br>6a. User nhấn "Xóa tài khoản" → nhập lại email xác nhận → xóa toàn bộ dữ liệu → đăng xuất |
| **Luồng ngoại lệ** | 3a. Họ tên > 200 ký tự → hiện lỗi validation |
| **Quan hệ** | — |

---

### UC-30: Đăng xuất

| Trường | Nội dung |
|--------|----------|
| **Mã UC** | UC-30 |
| **Tên** | Đăng xuất khỏi hệ thống |
| **Actor** | Free User |
| **Mô tả** | User kết thúc phiên làm việc, hệ thống huỷ session |
| **Tiền điều kiện** | User đã đăng nhập |
| **Hậu điều kiện** | Session bị huỷ; user quay về trạng thái Guest; chuyển về trang chủ |
| **Luồng chính** | 1. User nhấn "Đăng xuất" trong menu Header<br>2. Hệ thống gọi `supabase.auth.signOut()`<br>3. Xoá session local<br>4. Redirect về trang chủ `/` |
| **Quan hệ** | — |

---

### UC-31: Nâng cấp Premium

| Trường | Nội dung |
|--------|----------|
| **Mã UC** | UC-31 |
| **Tên** | Nâng cấp tài khoản lên Premium |
| **Actor** | Free User |
| **Mô tả** | User chọn gói Premium, thanh toán qua PayOS, hệ thống kích hoạt quyền Premium sau khi xác nhận |
| **Tiền điều kiện** | User đã đăng nhập; chưa có Premium hoặc Premium đã hết hạn |
| **Hậu điều kiện** | Trường `premium_until` được cập nhật; user có quyền Premium |
| **Luồng chính** | 1. User vào trang `/upgrade`<br>2. Nhấn "Nâng cấp ngay"<br>3. Hệ thống tạo payment order → nhận `payment_url` từ PayOS<br>4. Trình duyệt redirect đến trang thanh toán PayOS<br>5. User hoàn tất thanh toán<br>6. PayOS gọi webhook UC-36 → hệ thống kích hoạt Premium<br>7. User được redirect về `/upgrade/success` |
| **Luồng ngoại lệ** | 4a. User huỷ thanh toán → quay lại trang Upgrade<br>6a. Webhook thất bại → Premium chưa được kích hoạt, cần liên hệ hỗ trợ |
| **Quan hệ** | `<<include>>` UC-36 |

---

### UC-36: Webhook xác nhận thanh toán

| Trường | Nội dung |
|--------|----------|
| **Mã UC** | UC-36 |
| **Tên** | Xử lý webhook xác nhận thanh toán từ PayOS |
| **Actor** | PayOS (hệ thống ngoài) |
| **Mô tả** | PayOS gọi endpoint backend sau khi thanh toán thành công để kích hoạt Premium cho user |
| **Tiền điều kiện** | User đã hoàn tất thanh toán trên PayOS |
| **Hậu điều kiện** | `premium_until` được cập nhật; user có quyền Premium |
| **Luồng chính** | 1. PayOS POST đến `/payment/webhook` với thông tin giao dịch<br>2. Backend xác minh chữ ký webhook<br>3. Tìm user theo order ID<br>4. Cập nhật `premium_until` trong database<br>5. Trả `200 OK` cho PayOS |
| **Luồng ngoại lệ** | 2a. Chữ ký không hợp lệ → trả `400`, bỏ qua<br>3a. Không tìm thấy order → trả `404`, log lỗi |
| **Quan hệ** | `<<include>>` bởi UC-31 |
