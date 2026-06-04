# Tài liệu Kiểm thử thủ công — Hệ thống SubAI

Tài liệu trình bày các trường hợp kiểm thử (test case) thủ công cho **các luồng quan trọng nhất** của hệ thống SubAI: Xác thực, Upload & xử lý video, Editor (xem / sửa / tải SRT / xuất video), Thanh toán nâng cấp Premium, Quản lý tài khoản, và **Bảo mật & phân quyền truy cập tài nguyên**.

> Các test case dưới đây được viết **bám sát code thực tế** (các trang trong `src/app/pages/` và controller backend), nên thông báo lỗi, giá trị giới hạn và đường dẫn điều hướng là chính xác với hệ thống hiện tại.

## Cách sử dụng

1. Chạy hệ thống ở môi trường test (xem **Chuẩn bị môi trường**).
2. Thực hiện từng test case theo đúng **Các bước**.
3. So sánh **Kết quả thực tế** với **Kết quả mong đợi**, ghi **Pass / Fail** vào cột cuối.
4. Nếu Fail, ghi chú lỗi quan sát được (thông báo, ảnh chụp màn hình, mã lỗi…).

## Chuẩn bị môi trường (tiền điều kiện chung)

| Mục | Giá trị |
|---|---|
| Frontend | `http://localhost:5173` (`npm run dev`) |
| Backend | `app.py` (cổng 5000), API base `http://localhost:5000/api`, tunnel ngrok cho IPN MoMo |
| Supabase | Bật "Confirm email"; template **Confirm signup** dùng `{{ .ConfirmationURL }}`; Redirect URL có `http://localhost:5173/auth/callback` |
| MoMo | Cấu hình `MOMO_PARTNER_CODE/ACCESS_KEY/SECRET_KEY`, `NGROK_URL`, `FRONTEND_URL` (sandbox) |
| Email test | Hộp thư thật để nhận liên kết / OTP (có thể vào Spam) |
| TK Premium | Một tài khoản đã Premium để test Realtime |
| Video mẫu | Video hợp lệ (MP4, < 2 GB, < 4 giờ); 1 file sai định dạng (vd `.txt`) |

**Giá trị tham chiếu lấy từ code:**
- Định dạng hỗ trợ: **MP4, MOV, MKV, AVI, WEBM** · Tối đa **2 GB** · **4 giờ**.
- Hạn mức Free: **5 video/tháng**. Premium: **99.000đ/năm** qua **MoMo**.
- Ngôn ngữ: `en` = Tiếng Anh→Việt, `vi` = Tiếng Việt→Anh.
- Chế độ: **Normal** (mặc định) / **Realtime** (chỉ Premium).
- Độ phân giải xuất video: **360p / 720p / 1080p**.

**Quy ước:** TK = tài khoản; KQ = kết quả; ✅ Pass / ❌ Fail.

---

## 1. Nhóm Xác thực

### TC-AUTH — Đăng ký, Đăng nhập, Quên mật khẩu

| ID | Mô tả | Tiền điều kiện | Các bước | Dữ liệu | Kết quả mong đợi | KQ thực tế | P/F |
|---|---|---|---|---|---|---|---|
| TC-AUTH-01 | Đăng ký thành công (Magic Link) | Email chưa đăng ký | 1. Mở `/signup`<br>2. Nhập họ tên, email, mật khẩu, **xác nhận mật khẩu** (khớp)<br>3. Bấm "Tạo tài khoản" | Mật khẩu ≥ 8 ký tự, 2 ô khớp | Hiện màn **"Kiểm tra email của bạn"** kèm email; có nút "Gửi lại liên kết". Không có ô nhập OTP. | | |
| TC-AUTH-02 | Xác nhận tài khoản qua liên kết | Đã làm TC-AUTH-01 | 1. Mở email, bấm liên kết xác nhận<br>2. Trình duyệt mở `/auth/callback` | | Tự đăng nhập và chuyển đến **`/upload`** | | |
| TC-AUTH-03 | Đăng ký — mật khẩu xác nhận không khớp | — | 1. Nhập 2 ô mật khẩu khác nhau<br>2. Bấm "Tạo tài khoản" | MK: `Abc12345`, XN: `Abc99999` | Báo lỗi **"Mật khẩu xác nhận không khớp"**, không gửi email | | |
| TC-AUTH-04 | Đăng ký — mật khẩu quá ngắn | — | 1. Nhập mật khẩu < 8 ký tự<br>2. Bấm "Tạo tài khoản" | MK: `123` | Báo lỗi **"Mật khẩu phải có ít nhất 8 ký tự"** | | |
| TC-AUTH-05 | Đăng ký — email không hợp lệ | — | 1. Nhập email sai định dạng<br>2. Bấm "Tạo tài khoản" | Email: `abc@@x` | Báo lỗi **"Vui lòng nhập địa chỉ email hợp lệ"** | | |
| TC-AUTH-06 | Đăng ký — email đã tồn tại | Email đã đăng ký | 1. Đăng ký lại bằng email đã có | | Báo lỗi **"Email này đã được đăng ký. Vui lòng đăng nhập."** | | |
| TC-AUTH-07 | Gửi lại liên kết xác nhận | Đang ở màn "Kiểm tra email" | 1. Đợi countdown 60s hết<br>2. Bấm "Gửi lại liên kết" | | Gửi lại email; countdown reset 60s | | |
| TC-AUTH-08 | Đăng nhập bằng mật khẩu | TK đã xác nhận (TC-AUTH-02) | 1. Mở `/signin`<br>2. Nhập email + mật khẩu đúng<br>3. Bấm "Đăng nhập" | MK đã đặt khi đăng ký | Đăng nhập thành công → **`/upload`** | | |
| TC-AUTH-09 | Đăng nhập — sai thông tin | TK tồn tại | 1. Nhập mật khẩu sai<br>2. Bấm "Đăng nhập" | | Báo lỗi **"Email hoặc mật khẩu không đúng"** | | |
| TC-AUTH-10 | Đăng nhập — mật khẩu quá ngắn | — | 1. Nhập mật khẩu < 6 ký tự<br>2. Bấm "Đăng nhập" | MK: `123` | Báo lỗi **"Mật khẩu phải có ít nhất 6 ký tự"** (validate client) | | |
| TC-AUTH-11 | Đăng nhập bằng Google | — | 1. Bấm "Tiếp tục với Google"<br>2. Hoàn tất OAuth | | Đăng nhập thành công → `/upload` | | |
| TC-AUTH-12 | Quên mật khẩu — gửi OTP | TK tồn tại | 1. Mở `/forgot-password`<br>2. Nhập email<br>3. Bấm "Gửi liên kết đặt lại" | | Chuyển sang màn nhập **OTP 6 số**; email nhận mã | | |
| TC-AUTH-13 | Quên mật khẩu — OTP sai/hết hạn | Đang ở màn OTP | 1. Nhập OTP sai<br>2. Bấm "Xác minh" | OTP: `000000` | Báo lỗi **"Mã OTP không hợp lệ hoặc đã hết hạn."** | | |
| TC-AUTH-14 | Quên mật khẩu — đặt mật khẩu mới | OTP đúng đã xác minh | 1. Nhập mật khẩu mới + xác nhận (≥ 8, khớp)<br>2. Bấm "Cập nhật mật khẩu" | | Cập nhật thành công → **`/upload`** | | |
| TC-AUTH-15 | Quên mật khẩu — mật khẩu mới không khớp | Màn đặt MK mới | 1. Nhập 2 ô khác nhau<br>2. Bấm "Cập nhật mật khẩu" | | Báo lỗi **"Mật khẩu không khớp"** | | |
| TC-AUTH-16 | Đăng nhập bằng mật khẩu mới | Đã đổi MK (TC-AUTH-14) | 1. Đăng xuất<br>2. Đăng nhập bằng MK mới | | Đăng nhập thành công | | |
| TC-AUTH-17 | Bảo vệ route khi chưa đăng nhập | Chưa đăng nhập | 1. Truy cập thẳng `/upload` (hoặc `/editor`, `/profile`) | | Bị chuyển hướng về trang đăng nhập (ProtectedRoute) | | |

---

## 2. Nhóm Upload & xử lý video

### TC-UPLOAD — Upload Normal & Realtime

| ID | Mô tả | Tiền điều kiện | Các bước | Dữ liệu | Kết quả mong đợi | KQ thực tế | P/F |
|---|---|---|---|---|---|---|---|
| TC-UPLOAD-01 | Upload Normal thành công | Đăng nhập, chế độ Normal | 1. Mở `/upload`<br>2. Chọn ngôn ngữ (vd Anh→Việt)<br>3. Chọn/kéo-thả video hợp lệ | MP4 hợp lệ | Hiện thanh **"Đang tải lên… %"** → màn **"Đang xử lý"** (vòng tròn %, ETA, các bước Nhận dạng/Căn chỉnh/Định dạng) | | |
| TC-UPLOAD-02 | Hoàn tất xử lý Normal | Đã làm TC-UPLOAD-01 | 1. Chờ xử lý xong | | Hiện màn **"Đã tạo phụ đề!"** với nút **"Mở trong Editor"** và "Tải video khác" | | |
| TC-UPLOAD-03 | Mở Editor sau khi xong | TC-UPLOAD-02 | 1. Bấm "Mở trong Editor" | | Chuyển sang `/editor`, hiển thị video + phụ đề | | |
| TC-UPLOAD-04 | Upload — sai định dạng (chọn file) | Đăng nhập | 1. Chọn file không phải video | File `.txt` | Báo lỗi **"Định dạng tệp không được hỗ trợ. Hãy dùng MP4, MOV, MKV, AVI hoặc WEBM."**; tự về trạng thái ban đầu sau ~3s | | |
| TC-UPLOAD-05 | Upload — sai định dạng (kéo thả) | Đăng nhập | 1. Kéo-thả file không hợp lệ vào vùng drop | File `.txt` | Báo lỗi định dạng (như trên) | | |
| TC-UPLOAD-06 | Upload — codec không hợp lệ | Đăng nhập | 1. Upload file có đuôi video nhưng nội dung hỏng | | Báo lỗi **"Tệp video không hợp lệ hoặc codec không được hỗ trợ…"**, cho thử lại | | |
| TC-UPLOAD-07 | Hết hạn mức Free | TK Free đã dùng 5 video/tháng | 1. Upload video thứ 6 | | Báo lỗi **"Đã đạt giới hạn 5 video/tháng. Nâng cấp Premium để tiếp tục."** + link **Nâng cấp** | | |
| TC-UPLOAD-08 | Bộ đếm video Free | TK Free | 1. Quan sát mục "Video đã dùng tháng này" | | Hiển thị đúng số đã dùng dạng **x/5** | | |
| TC-UPLOAD-09 | Realtime bị khóa với TK Free | Đăng nhập TK Free | 1. Xem mục "Chế độ phụ đề" | | Tùy chọn **Realtime bị khóa** (icon Lock, badge **"Premium"**), không chọn được | | |
| TC-UPLOAD-10 | Realtime — TK Premium thành công | Đăng nhập TK Premium | 1. Chọn chế độ **Realtime**<br>2. Chọn ngôn ngữ<br>3. Upload video hợp lệ | EN → VM1, VI → VM2 | Hiện màn **"Đang khởi động Realtime"** (~2.5s) rồi tự chuyển `/editor?mode=realtime&job_id=…` | | |
| TC-UPLOAD-11 | Realtime — stream phụ đề | TC-UPLOAD-10 | 1. Ở Editor, quan sát thanh trạng thái Realtime | | Thanh **"Realtime đang xử lý… %"**, phụ đề hiện **dần theo từng đoạn** | | |
| TC-UPLOAD-12 | Hủy/đổi video trước khi gửi | Đang ở trạng thái uploading | 1. Bấm nút X (reset) | | Quay về trạng thái idle, xóa file đã chọn | | |

---

## 3. Nhóm Editor — Xem / Chỉnh sửa / Tải SRT / Xuất video

> Lưu ý: Editor đọc dữ liệu job từ `sessionStorage`. Truy cập `/editor` mà không có job → **tự chuyển về `/upload`**.

| ID | Mô tả | Tiền điều kiện | Các bước | Dữ liệu | Kết quả mong đợi | KQ thực tế | P/F |
|---|---|---|---|---|---|---|---|
| TC-EDIT-01 | Xem video kèm phụ đề | Job đã xong, ở Editor | 1. Bấm Play | | Video phát, phụ đề hiện đồng bộ theo timestamp; badge **"Subtitles Ready"** | | |
| TC-EDIT-02 | Vào Editor không có job | Chưa upload | 1. Mở thẳng `/editor` | | Tự chuyển hướng về **`/upload`** | | |
| TC-EDIT-03 | Đổi chế độ hiển thị phụ đề | Ở Editor | 1. Mở menu Subtitle options<br>2. Chọn Off / English Only / Vietnamese Only / Dual | | Overlay phụ đề thay đổi theo lựa chọn | | |
| TC-EDIT-04 | Tua / phát / tạm dừng | Ở Editor | 1. Kéo thanh tiến trình; bấm ±5s; Play/Pause | | Video tua đúng vị trí, phụ đề khớp mốc thời gian | | |
| TC-EDIT-05 | Chỉnh sửa nội dung phụ đề | Ở Editor | 1. Chọn 1 đoạn phụ đề<br>2. Sửa nội dung | | Nội dung cập nhật, overlay phản ánh ngay | | |
| TC-EDIT-06 | Thêm / Xóa đoạn phụ đề | Ở Editor | 1. Bấm thêm đoạn mới<br>2. Xóa 1 đoạn | | Danh sách phụ đề cập nhật tương ứng | | |
| TC-EDIT-07 | Lưu thay đổi | Đã chỉnh sửa | 1. Bấm **Save** | | Nút hiện **"Saved"** ~2s; thay đổi lưu vào draft (sessionStorage) | | |
| TC-EDIT-08 | Undo / Redo | Đã chỉnh sửa | 1. Bấm Undo rồi Redo | | Undo hoàn tác thay đổi, Redo khôi phục; nút disable khi hết stack | | |
| TC-EDIT-09 | Tìm kiếm phụ đề | Ở Editor | 1. Nhập từ khóa vào ô tìm kiếm | | Danh sách lọc theo nội dung khớp | | |
| TC-EDIT-10 | Tải file SRT | Ở Editor | 1. Bấm **Download SRT** | | Tải về file **`subtitles.srt`**, nội dung khớp phụ đề ngôn ngữ đang hiển thị | | |
| TC-EDIT-11 | Tải SRT sau khi chỉnh sửa | Đã sửa + đang xem ngôn ngữ đó | 1. Sửa phụ đề<br>2. Bấm Download SRT | | File SRT chứa nội dung **đã chỉnh sửa** | | |
| TC-EDIT-12 | Xuất video — chọn độ phân giải | Job xong (không Realtime đang chạy) | 1. Bấm **Export Video**<br>2. Chọn 360p / 720p / 1080p | | Nút đổi thành **"Exporting {res}..."**; xử lý xong tự tải video gắn phụ đề | | |
| TC-EDIT-13 | Xuất video — dùng phụ đề đã sửa | Đã chỉnh sửa phụ đề | 1. Xuất video | | Video xuất ra dùng phụ đề theo ngôn ngữ/nội dung đang chọn | | |
| TC-EDIT-14 | Xuất video — chặn khi Realtime chưa xong | Realtime đang stream | 1. Quan sát nút Export | | Nút hiển thị **"Waiting Realtime..."** và bị **vô hiệu hóa** | | |
| TC-EDIT-15 | Xuất video — lỗi | Mô phỏng lỗi export backend | 1. Xuất video | | Hiện banner lỗi đỏ (thông báo export thất bại) | | |

---

## 4. Nhóm Thanh toán nâng cấp Premium

### TC-PAY — Nâng cấp Premium qua MoMo

| ID | Mô tả | Tiền điều kiện | Các bước | Dữ liệu | Kết quả mong đợi | KQ thực tế | P/F |
|---|---|---|---|---|---|---|---|
| TC-PAY-01 | Hiển thị trang nâng cấp | Đăng nhập TK Free | 1. Mở `/upgrade` | | Hiện 2 gói: Free (0đ) và Premium (**99.000đ/năm**), nút "Nâng cấp ngay — 99.000đ" | | |
| TC-PAY-02 | Tạo đơn & chuyển sang MoMo | TK Free | 1. Bấm "Nâng cấp ngay" | | Gọi `POST /payment/create-order`, chuyển hướng đến trang thanh toán **MoMo** (payUrl) | | |
| TC-PAY-03 | Thanh toán thành công | Đang ở MoMo (sandbox) | 1. Thanh toán thành công<br>2. Quay về `/upgrade/success` | | Trang **"Đang xác nhận thanh toán…"** poll `/auth/me` → **"Chào mừng đến Premium!"**, sau 3s chuyển `/upload` | | |
| TC-PAY-04 | Chờ IPN lâu (timeout) | IPN chưa về sau 20s | 1. Ở `/upgrade/success` chờ >20s (10×2s) | | Hiện **"Thanh toán đang xử lý"**, gợi ý refresh, nút "Về trang Upload" | | |
| TC-PAY-05 | Hủy / thất bại thanh toán | Đang ở MoMo | 1. Hủy giao dịch | | TK **giữ nguyên** Free; (IPN resultCode≠0 → không nâng cấp) | | |
| TC-PAY-06 | Đã Premium thì không nâng cấp lại | Đăng nhập TK Premium | 1. Mở `/upgrade` | | Hiện nhãn **"Đã là Premium"**, không có nút thanh toán | | |
| TC-PAY-07 | Chặn tạo đơn khi đã Premium (API) | TK Premium | 1. Gọi `POST /payment/create-order` | | Trả về **409 "Already premium"** | | |
| TC-PAY-08 | Giới hạn tần suất tạo đơn | — | 1. Bấm "Nâng cấp" >3 lần/phút | | Bị chặn (rate limit **3/phút**) | | |
| TC-PAY-09 | Quyền Realtime sau nâng cấp | Sau TC-PAY-03 | 1. Vào `/upload`, xem chế độ | | **Realtime mở khóa** (không còn icon Lock) | | |

---

## 5. Nhóm Quản lý tài khoản (Profile)

### TC-PROFILE — Xem & quản lý thông tin tài khoản

| ID | Mô tả | Tiền điều kiện | Các bước | Dữ liệu | Kết quả mong đợi | KQ thực tế | P/F |
|---|---|---|---|---|---|---|---|
| TC-PROFILE-01 | Xem thông tin tài khoản | Đã đăng nhập | 1. Mở `/profile` | | Hiện Email (khóa, không sửa), Họ tên, ngày "Tham gia" | | |
| TC-PROFILE-02 | Đổi tên thành công | Ở `/profile` | 1. Sửa Họ tên<br>2. Bấm "Lưu thay đổi" | | Hiện **"Đã lưu thay đổi"**; tên cập nhật | | |
| TC-PROFILE-03 | Đổi mật khẩu thành công | Ở `/profile` | 1. Nhập MK hiện tại đúng + MK mới + xác nhận (≥8, khớp)<br>2. Bấm "Đổi mật khẩu" | | Hiện **"Đã đổi mật khẩu thành công"**; các ô được xóa | | |
| TC-PROFILE-04 | Đổi mật khẩu — sai MK hiện tại | Ở `/profile` | 1. Nhập MK hiện tại sai<br>2. Bấm "Đổi mật khẩu" | | Báo lỗi **"Mật khẩu hiện tại không đúng"** | | |
| TC-PROFILE-05 | Đổi mật khẩu — mới không khớp | Ở `/profile` | 1. Nhập 2 ô MK mới khác nhau | | Báo lỗi **"Mật khẩu mới không khớp"** | | |
| TC-PROFILE-06 | Đổi mật khẩu — quá ngắn | Ở `/profile` | 1. Nhập MK mới < 8 ký tự | | Báo lỗi **"Mật khẩu tối thiểu 8 ký tự"** | | |
| TC-PROFILE-07 | Xóa tài khoản — nút bị khóa | Ở `/profile` | 1. Quan sát nút "Xóa tài khoản" khi email chưa khớp | | Nút **disabled** cho tới khi gõ đúng email + nhập mật khẩu | | |
| TC-PROFILE-08 | Xóa tài khoản — sai mật khẩu | Ở `/profile` | 1. Gõ đúng email, nhập MK sai<br>2. Bấm "Xóa tài khoản" | | Báo lỗi **"Mật khẩu không đúng"**, không xóa | | |
| TC-PROFILE-09 | Xóa tài khoản thành công | Ở `/profile` | 1. Gõ đúng email + MK đúng<br>2. Bấm "Xóa tài khoản" | | Xóa TK, đăng xuất, chuyển về trang chủ `/` | | |

---

## 6. Nhóm Bảo mật & Phân quyền truy cập tài nguyên

> Đây là các test ở **tầng API backend** (gọi trực tiếp bằng `curl`/Postman), nhằm chứng minh hệ thống chống truy cập trái phép. Mọi endpoint job-based đều kiểm tra `job.user_id == token.user_id` và trả **403 "Forbidden"** nếu không khớp (chống **IDOR** — Insecure Direct Object Reference).
>
> **Chuẩn bị:** 2 tài khoản A và B. Đăng nhập từng tài khoản lấy `access_token` (qua Supabase, xem mục 13.2 của README). Tạo trước 1 job thuộc **A** (`JOB_A`) và 1 export thuộc A (`EXPORT_A`). Dùng `TOKEN_A`, `TOKEN_B`.

### 6.1 Xác thực token (Authentication)

| ID | Mô tả | Tiền điều kiện | Các bước | Kết quả mong đợi | KQ thực tế | P/F |
|---|---|---|---|---|---|---|
| TC-SEC-01 | Gọi API không kèm token | — | `GET /api/jobs/<JOB_A>` không có header Authorization | **401** `{"error":"Authentication required"}` | | |
| TC-SEC-02 | Token sai/giả mạo | — | Gọi API với `Authorization: Bearer abc.def.ghi` (token rác) | **401** `Invalid token` | | |
| TC-SEC-03 | Token hết hạn | Có token đã expired | Gọi API với token hết hạn | **401** `Token expired` (hoặc Invalid token) | | |
| TC-SEC-04 | Truy cập route được bảo vệ ở FE khi chưa đăng nhập | Chưa đăng nhập | Mở thẳng `/upload`, `/editor`, `/profile`, `/upgrade` | Bị chuyển hướng về trang đăng nhập (ProtectedRoute) | | |
| TC-SEC-05 | SSE qua query token | Đã đăng nhập | `GET /api/jobs/<JOB_A>/stream?token=<TOKEN_A>` | Kết nối SSE thành công (token nhận qua query param) | | |
| TC-SEC-06 | SSE thiếu token | — | `GET /api/jobs/<JOB_A>/stream` không token | **401** | | |

### 6.2 Phân quyền sở hữu tài nguyên (IDOR / Ownership)

| ID | Mô tả | Tiền điều kiện | Các bước | Kết quả mong đợi | KQ thực tế | P/F |
|---|---|---|---|---|---|---|
| TC-SEC-07 | B xem job của A | JOB_A thuộc A | `GET /api/jobs/<JOB_A>` với `TOKEN_B` | **403** `{"error":"Forbidden"}` | | |
| TC-SEC-08 | B lấy SRT của A | JOB_A có SRT | `GET /api/jobs/<JOB_A>/srt-url?lang=vi` với `TOKEN_B` | **403** `Forbidden` | | |
| TC-SEC-09 | B xuất video từ job của A | JOB_A done | `POST /api/export` body `{job_id: JOB_A}` với `TOKEN_B` | **403** `Forbidden` | | |
| TC-SEC-10 | B xem trạng thái export của A | EXPORT_A thuộc A | `GET /api/export-status/<EXPORT_A>` với `TOKEN_B` | **403** `Forbidden` | | |
| TC-SEC-11 | B đọc quality report của A | JOB_A done | `GET /api/jobs/<JOB_A>/report?lang=vi` với `TOKEN_B` | **403** `Forbidden` | | |
| TC-SEC-12 | B optimize job của A | JOB_A done, B là Premium | `POST /api/jobs/<JOB_A>/optimize` với `TOKEN_B` | **403** `Forbidden` (ownership chặn trước cả khi B là Premium) | | |
| TC-SEC-13 | B đánh giá dịch thuật job của A | JOB_A done | `GET /api/jobs/<JOB_A>/translation-quality` với `TOKEN_B` | **403** `Forbidden` | | |
| TC-SEC-14 | Truy cập job không tồn tại | — | `GET /api/jobs/<UUID-ngẫu-nhiên>` với `TOKEN_A` | **404** `Job not found` (không lộ thông tin job người khác) | | |
| TC-SEC-15 | B tải video gốc của A | Video JOB_A còn trên server | `GET /api/video/<JOB_A>_<tên>.mp4` với `TOKEN_B` | **403** `Forbidden` | | |
| TC-SEC-16 | B tải video export của A | File export JOB_A tồn tại | `GET /api/exports/<JOB_A>_vi_720p.mp4` với `TOKEN_B` | **403** `Forbidden` | | |

### 6.3 Phân quyền tính năng Premium

| ID | Mô tả | Tiền điều kiện | Các bước | Kết quả mong đợi | KQ thực tế | P/F |
|---|---|---|---|---|---|---|
| TC-SEC-17 | TK Free gọi optimize (Premium-only) | A là Free, JOB_A thuộc A | `POST /api/jobs/<JOB_A>/optimize` với `TOKEN_A` | **403** code **`PREMIUM_REQUIRED`** | | |
| TC-SEC-18 | TK Free upload Realtime (API) | A là Free | `POST /api/upload` `process_mode=realtime` với `TOKEN_A` | **403** code **`PREMIUM_REQUIRED`** | | |
| TC-SEC-19 | TK Free vượt hạn mức video | A đã dùng 5 video/tháng | `POST /api/upload` (Normal) video thứ 6 | **403** code **`LIMIT_REACHED`** | | |
| TC-SEC-20 | TK Free tạo đơn rồi tự gọi lại khi đã Premium | A vừa thành Premium | `POST /api/payment/create-order` với `TOKEN_A` | **409** `Already premium` | | |

### 6.4 Lạm dụng & rò rỉ thông tin

| ID | Mô tả | Tiền điều kiện | Các bước | Kết quả mong đợi | KQ thực tế | P/F |
|---|---|---|---|---|---|---|
| TC-SEC-21 | Path traversal khi tải file | — | `GET /api/exports/..%2F..%2F.env` với `TOKEN_A` | Không lộ file ngoài thư mục outputs (tên file bị chuẩn hóa về basename) → **404** | | |
| TC-SEC-22 | Rate limit upload | Đã đăng nhập | Gọi `POST /api/upload` > 5 lần/phút | Bị chặn **429 Too Many Requests** | | |
| TC-SEC-23 | Rate limit tạo đơn thanh toán | Đã đăng nhập | Gọi `POST /api/payment/create-order` > 3 lần/phút | Bị chặn **429** | | |
| TC-SEC-24 | Rate limit đổi mật khẩu | Đã đăng nhập | Gọi `POST /api/auth/change-password` > 10 lần/phút | Bị chặn **429** | | |
| TC-SEC-25 | Response job không lộ đường dẫn nội bộ | JOB_A done | `GET /api/jobs/<JOB_A>` với `TOKEN_A` | Body chỉ chứa field an toàn (job_id, status, words, text…); **không** có `video_path` / storage path nội bộ | | |
| TC-SEC-26 | MoMo IPN từ chối chữ ký giả | — | `POST /api/payment/ipn` với body chữ ký sai | Trả 200 nhưng **không** nâng cấp Premium (verify chữ ký thất bại → bỏ qua) | | |

---

## Bảng tổng hợp kết quả

| Nhóm | Tổng số TC | Pass | Fail | Ghi chú |
|---|---|---|---|---|
| Xác thực (TC-AUTH) | 17 | | | |
| Upload (TC-UPLOAD) | 12 | | | |
| Editor (TC-EDIT) | 15 | | | |
| Thanh toán (TC-PAY) | 9 | | | |
| Tài khoản (TC-PROFILE) | 9 | | | |
| Bảo mật & Phân quyền (TC-SEC) | 26 | | | |
| **Tổng** | **88** | | | |
