# Biểu đồ tuần tự — Nhóm Use Case Xác thực

Tài liệu này trình bày các biểu đồ tuần tự (sequence diagram) mô tả luồng tương tác giữa các thành phần của hệ thống SubAI cho nhóm Use Case Xác thực, bao gồm: **Đăng ký tài khoản**, **Đăng nhập** và **Quên mật khẩu**.

---

## 1. Đăng ký tài khoản (Magic Link)

Biểu đồ mô tả quá trình Khách tạo tài khoản mới (có đặt mật khẩu) và xác nhận tài khoản qua liên kết (Magic Link) gửi về email. Tài khoản được tạo bằng `signUp` của Supabase Auth nên mật khẩu được lưu lại; sau khi xác nhận, người dùng có thể đăng nhập bằng mật khẩu đã đặt. Liên kết xác nhận trỏ về trang `/auth/callback` để hệ thống tự tạo phiên đăng nhập.

```mermaid
sequenceDiagram
    actor Khach as Khách
    participant FE as Giao diện (Frontend)
    participant Auth as Supabase Auth
    participant DB as Cơ sở dữ liệu (auth.users)
    participant Mail as Dịch vụ Email

    Khach->>FE: Chọn chức năng đăng ký tài khoản
    FE-->>Khach: Hiển thị form đăng ký
    Khach->>FE: Nhập họ tên, email, mật khẩu, xác nhận mật khẩu

    FE->>FE: Kiểm tra hợp lệ (email, mật khẩu ≥ 8 ký tự, mật khẩu khớp)

    alt Thông tin không hợp lệ / mật khẩu không khớp
        FE-->>Khach: Hiển thị lỗi trên form
    else Thông tin hợp lệ
        FE->>Auth: signUp(email, password, data: full_name,<br/>emailRedirectTo = /auth/callback)
        Auth->>DB: Tạo tài khoản (lưu mật khẩu băm,<br/>trạng thái chờ xác nhận email)

        alt Email đã tồn tại
            Auth-->>FE: identities rỗng → email đã đăng ký
            FE-->>Khach: Thông báo email đã được đăng ký
        else Tạo thành công
            Auth->>Mail: Gửi email xác nhận (Confirm signup)<br/>chứa liên kết kèm token
            Mail-->>Khach: Email chứa liên kết xác nhận
            Auth-->>FE: Trả về thành công
            FE-->>Khach: Hiển thị màn hình "Kiểm tra email của bạn"

            opt Gửi lại liên kết (sau 60s)
                Khach->>FE: Bấm "Gửi lại liên kết"
                FE->>Auth: resend(type: signup, emailRedirectTo)
                Auth->>Mail: Gửi lại email xác nhận
                Mail-->>Khach: Email chứa liên kết mới
            end

            Khach->>Mail: Mở email và nhấn liên kết xác nhận
            Khach->>FE: Truy cập /auth/callback (kèm code / token_hash)
            FE->>Auth: exchangeCodeForSession / verifyOtp
            Auth->>DB: Kích hoạt tài khoản (xác nhận email)
            Auth-->>FE: Trả về phiên đăng nhập (session)
            FE-->>Khach: Chuyển đến trang Upload
        end
    end
```

---

## 2. Đăng nhập

Biểu đồ mô tả quá trình Khách đăng nhập, hệ thống xác thực tài khoản và tạo phiên đăng nhập.

```mermaid
sequenceDiagram
    actor Khach as Khách
    participant FE as Giao diện (Frontend)
    participant BE as Hệ thống (Backend)
    participant DB as Cơ sở dữ liệu

    Khach->>FE: Chọn chức năng đăng nhập
    FE-->>Khach: Hiển thị form đăng nhập
    Khach->>FE: Nhập email và mật khẩu
    FE->>BE: Gửi thông tin đăng nhập

    BE->>DB: Truy vấn tài khoản theo email
    DB-->>BE: Trả về thông tin tài khoản
    BE->>BE: Xác thực email và mật khẩu

    alt Thông tin không hợp lệ
        BE-->>FE: Thông báo đăng nhập thất bại
        FE-->>Khach: Hiển thị thông báo lỗi
    else Thông tin hợp lệ
        BE->>BE: Tạo phiên đăng nhập (session/token)
        BE->>DB: Lưu phiên đăng nhập
        BE-->>FE: Trả về phiên đăng nhập
        FE-->>Khach: Chuyển đến trang Upload
    end
```

---

## 3. Quên mật khẩu (Xác thực OTP)

Biểu đồ mô tả quá trình Khách khôi phục mật khẩu bằng cách xác thực mã OTP gửi về email.

```mermaid
sequenceDiagram
    actor Khach as Khách
    participant FE as Giao diện (Frontend)
    participant BE as Hệ thống (Backend)
    participant DB as Cơ sở dữ liệu
    participant Mail as Dịch vụ Email

    Khach->>FE: Chọn chức năng quên mật khẩu
    FE-->>Khach: Yêu cầu nhập email đã đăng ký
    Khach->>FE: Nhập email
    FE->>BE: Gửi yêu cầu khôi phục mật khẩu

    BE->>DB: Kiểm tra email tồn tại
    DB-->>BE: Xác nhận tài khoản
    BE->>BE: Sinh mã OTP
    BE->>DB: Lưu OTP (kèm thời gian hết hạn)
    BE->>Mail: Gửi mã OTP đến email
    Mail-->>Khach: Email chứa mã OTP

    Khach->>FE: Nhập mã OTP
    FE->>BE: Gửi mã OTP để xác thực
    BE->>DB: Đối chiếu OTP và kiểm tra hạn

    alt OTP sai hoặc hết hạn
        BE-->>FE: Thông báo OTP không hợp lệ
        FE-->>Khach: Hiển thị thông báo lỗi
        opt Yêu cầu gửi lại OTP
            Khach->>FE: Yêu cầu gửi lại mã OTP
            FE->>BE: Gửi lại yêu cầu OTP
            BE->>Mail: Gửi mã OTP mới
            Mail-->>Khach: Email chứa mã OTP mới
        end
    else OTP hợp lệ
        BE-->>FE: Cho phép nhập mật khẩu mới
        FE-->>Khach: Hiển thị form đặt mật khẩu mới
        Khach->>FE: Nhập và xác nhận mật khẩu mới
        FE->>BE: Gửi mật khẩu mới
        BE->>BE: Kiểm tra tính hợp lệ của mật khẩu

        alt Mật khẩu mới không hợp lệ
            BE-->>FE: Thông báo lỗi
            FE-->>Khach: Hiển thị thông báo lỗi
        else Mật khẩu mới hợp lệ
            BE->>DB: Cập nhật mật khẩu mới
            BE-->>FE: Cập nhật mật khẩu thành công
            FE-->>Khach: Thông báo có thể đăng nhập bằng mật khẩu mới
        end
    end
```

---

## 4. Upload video (Normal)

Biểu đồ mô tả quá trình Người dùng tải video lên hệ thống, chọn chế độ dịch và yêu cầu xử lý phụ đề theo chế độ Normal thông qua Colab VM2.

```mermaid
sequenceDiagram
    actor User as Người dùng
    participant FE as Giao diện (Frontend)
    participant BE as Hệ thống (Backend)
    participant Storage as Lưu trữ video
    participant DB as Cơ sở dữ liệu
    participant VM2 as Colab VM2

    User->>FE: Chọn chức năng Upload video
    FE-->>User: Hiển thị giao diện tải video
    User->>FE: Chọn video từ thiết bị
    User->>FE: Chọn chế độ dịch (include)
    FE->>BE: Gửi video và chế độ dịch

    BE->>BE: Kiểm tra định dạng và dung lượng video

    alt Video sai định dạng / vượt dung lượng
        BE-->>FE: Thông báo lỗi
        FE-->>User: Hiển thị thông báo lỗi, cho phép thử lại
    else Video hợp lệ
        BE->>Storage: Lưu video đã upload
        BE->>DB: Tạo tác vụ xử lý (chế độ Normal)
        BE-->>FE: Thông báo upload thành công, đang xử lý
        FE-->>User: Hiển thị trạng thái đang xử lý

        BE->>VM2: Gửi dữ liệu video + chế độ dịch (Xử lý Normal)

        alt Colab VM2 không phản hồi
            VM2-->>BE: Lỗi / không phản hồi
            BE->>DB: Cập nhật trạng thái tác vụ thất bại
            BE-->>FE: Thông báo lỗi xử lý
            FE-->>User: Hiển thị thông báo lỗi, cho phép thử lại
        else Colab VM2 xử lý thành công
            VM2->>VM2: Nhận dạng giọng nói (Speech-to-Text)
            VM2->>VM2: Dịch thuật theo chế độ dịch
            VM2->>VM2: Tạo phụ đề
            VM2-->>BE: Trả kết quả phụ đề
            BE->>DB: Lưu phụ đề và cập nhật trạng thái hoàn tất
            BE-->>FE: Thông báo xử lý hoàn tất
            FE-->>User: Hiển thị kết quả phụ đề
        end
    end
```

---

## 5. Xem video kèm phụ đề

Biểu đồ mô tả quá trình Người dùng mở và xem lại video đã được xử lý cùng với phụ đề tương ứng (phụ thuộc vào Use Case Upload video).

```mermaid
sequenceDiagram
    actor User as Người dùng
    participant FE as Giao diện (Frontend)
    participant BE as Hệ thống (Backend)
    participant Storage as Lưu trữ video
    participant DB as Cơ sở dữ liệu

    User->>FE: Mở video đã xử lý
    FE->>BE: Yêu cầu dữ liệu video và phụ đề
    BE->>Storage: Lấy dữ liệu video
    BE->>DB: Lấy dữ liệu phụ đề tương ứng

    alt Video / phụ đề không tồn tại
        BE-->>FE: Thông báo lỗi
        FE-->>User: Hiển thị lỗi, yêu cầu thực hiện lại quá trình upload
    else Dữ liệu hợp lệ
        Storage-->>BE: Trả về dữ liệu video
        DB-->>BE: Trả về dữ liệu phụ đề
        BE-->>FE: Trả về video và phụ đề
        FE->>FE: Hiển thị video trên trình phát
        FE->>FE: Đồng bộ phụ đề theo timestamp
        FE-->>User: Hiển thị video kèm phụ đề

        loop Người dùng kiểm tra nội dung
            User->>FE: Phát / tạm dừng / tua video
            FE->>FE: Cập nhật phụ đề theo mốc thời gian hiện tại
            FE-->>User: Hiển thị phụ đề đồng bộ
        end
    end
```

---

## 6. Chỉnh sửa phụ đề

Biểu đồ mô tả quá trình Người dùng điều chỉnh nội dung phụ đề đã được tạo tự động và lưu lại thay đổi (phụ thuộc Use Case Upload video, mở rộng bởi thao tác Lưu).

```mermaid
sequenceDiagram
    actor User as Người dùng
    participant FE as Giao diện (Frontend)
    participant BE as Hệ thống (Backend)
    participant DB as Cơ sở dữ liệu

    User->>FE: Mở video đã có phụ đề
    FE->>BE: Yêu cầu danh sách đoạn phụ đề
    BE->>DB: Lấy dữ liệu phụ đề

    alt Dữ liệu phụ đề không tồn tại
        BE-->>FE: Thông báo lỗi
        FE-->>User: Hiển thị lỗi, yêu cầu thử lại
    else Dữ liệu hợp lệ
        DB-->>BE: Trả về danh sách phụ đề
        BE-->>FE: Trả về danh sách đoạn phụ đề
        FE-->>User: Hiển thị danh sách đoạn phụ đề

        loop Chỉnh sửa các đoạn phụ đề
            User->>FE: Chọn đoạn phụ đề cần chỉnh sửa
            User->>FE: Thay đổi nội dung phụ đề
        end

        User->>FE: Thực hiện thao tác Lưu (Extends)
        FE->>BE: Gửi nội dung phụ đề đã chỉnh sửa
        BE->>DB: Cập nhật nội dung phụ đề

        alt Lưu thất bại
            DB-->>BE: Lỗi cập nhật
            BE-->>FE: Thông báo lưu thất bại
            FE-->>User: Hiển thị lỗi, yêu cầu thử lại
        else Lưu thành công
            DB-->>BE: Cập nhật thành công
            BE-->>FE: Xác nhận đã lưu
            FE-->>User: Thông báo cập nhật phụ đề thành công
        end
    end
```

---

## 7. Tải file SRT

Biểu đồ mô tả quá trình Người dùng tải file phụ đề định dạng SRT về thiết bị (phụ thuộc Use Case Upload video, mở rộng từ Chỉnh sửa phụ đề).

```mermaid
sequenceDiagram
    actor User as Người dùng
    participant FE as Giao diện (Frontend)
    participant BE as Hệ thống (Backend)
    participant DB as Cơ sở dữ liệu

    User->>FE: Mở video đã có phụ đề
    FE-->>User: Hiển thị tùy chọn tải file SRT
    User->>FE: Chọn chức năng tải file SRT
    FE->>BE: Yêu cầu file SRT

    BE->>DB: Lấy dữ liệu phụ đề hiện tại

    alt Phụ đề chưa tồn tại / video chưa xử lý xong
        DB-->>BE: Không có dữ liệu phụ đề
        BE-->>FE: Thông báo lỗi
        FE-->>User: Hiển thị thông báo lỗi
    else Phụ đề hợp lệ
        DB-->>BE: Trả về nội dung phụ đề

        alt Phụ đề đã được chỉnh sửa (Extends)
            BE->>BE: Tạo file SRT theo nội dung phụ đề đã chỉnh sửa
        else Phụ đề gốc
            BE->>BE: Tạo / lấy file SRT theo phụ đề tự động
        end

        BE-->>FE: Gửi file SRT về trình duyệt

        alt Tải xuống thất bại
            FE-->>User: Hiển thị thông báo lỗi
        else Tải xuống thành công
            FE-->>User: Lưu file SRT về thiết bị
        end
    end
```

---

## 8. Nâng cấp Premium

Biểu đồ mô tả quá trình Người dùng nâng cấp tài khoản lên Premium thông qua cổng thanh toán MoMo (include Xử lý thanh toán từ MoMo).

```mermaid
sequenceDiagram
    actor User as Người dùng
    participant FE as Giao diện (Frontend)
    participant BE as Hệ thống (Backend)
    participant DB as Cơ sở dữ liệu
    participant Momo as Cổng thanh toán MoMo

    User->>FE: Chọn chức năng nâng cấp Premium
    FE->>BE: Yêu cầu thông tin gói Premium
    BE-->>FE: Trả về thông tin gói và chi phí
    FE-->>User: Hiển thị thông tin gói Premium và chi phí

    alt Người dùng hủy nâng cấp
        User->>FE: Hủy thao tác nâng cấp
        FE-->>User: Giữ nguyên trạng thái tài khoản
    else Người dùng xác nhận
        User->>FE: Xác nhận nâng cấp
        FE->>BE: Yêu cầu tạo giao dịch thanh toán
        BE->>Momo: Tạo yêu cầu thanh toán (include)
        Momo-->>BE: Trả về liên kết / mã thanh toán
        BE-->>FE: Chuyển hướng đến giao diện MoMo
        FE-->>User: Hiển thị giao diện thanh toán MoMo

        User->>Momo: Thực hiện thanh toán
        Momo->>Momo: Xử lý giao dịch
        Momo-->>BE: Gửi kết quả giao dịch (callback/IPN)

        alt Thanh toán thất bại / bị hủy / không nhận được xác nhận
            BE-->>FE: Thông báo thanh toán không thành công
            FE-->>User: Hiển thị thông báo, giữ nguyên trạng thái tài khoản
        else Thanh toán thành công
            BE->>BE: Xác nhận kết quả thanh toán
            BE->>DB: Cập nhật tài khoản lên Premium
            BE-->>FE: Thông báo nâng cấp thành công
            FE-->>User: Hiển thị tài khoản đã là Premium
        end
    end
```

---

## 9. Xem thông tin tài khoản

Biểu đồ mô tả quá trình Người dùng xem và quản lý thông tin tài khoản (include Đăng nhập; mở rộng bởi Đổi tên, Đổi mật khẩu, Xóa tài khoản).

```mermaid
sequenceDiagram
    actor User as Người dùng
    participant FE as Giao diện (Frontend)
    participant BE as Hệ thống (Backend)
    participant DB as Cơ sở dữ liệu

    User->>FE: Chọn chức năng xem thông tin tài khoản
    FE->>BE: Yêu cầu thông tin tài khoản
    BE->>BE: Kiểm tra trạng thái đăng nhập (include)

    alt Chưa đăng nhập
        BE-->>FE: Yêu cầu đăng nhập
        FE-->>User: Chuyển hướng đến trang đăng nhập
    else Đã đăng nhập
        BE->>DB: Tải thông tin tài khoản

        alt Không tải được dữ liệu
            DB-->>BE: Lỗi truy vấn
            BE-->>FE: Thông báo lỗi
            FE-->>User: Hiển thị thông báo lỗi
        else Tải thành công
            DB-->>BE: Trả về thông tin tài khoản
            BE-->>FE: Trả về email, họ tên, trạng thái tài khoản
            FE-->>User: Hiển thị thông tin tài khoản

            opt Đổi tên (Extends)
                User->>FE: Nhập tên mới
                FE->>BE: Gửi yêu cầu đổi tên
                BE->>DB: Cập nhật họ tên
                BE-->>FE: Xác nhận cập nhật
                FE-->>User: Thông báo đổi tên thành công
            end

            opt Đổi mật khẩu (Extends)
                User->>FE: Nhập mật khẩu cũ và mật khẩu mới
                FE->>BE: Gửi yêu cầu đổi mật khẩu
                BE->>BE: Xác thực mật khẩu cũ và kiểm tra mật khẩu mới
                BE->>DB: Cập nhật mật khẩu
                BE-->>FE: Xác nhận cập nhật
                FE-->>User: Thông báo đổi mật khẩu thành công
            end

            opt Xóa tài khoản (Extends)
                User->>FE: Chọn xóa tài khoản
                FE-->>User: Yêu cầu xác nhận
                User->>FE: Xác nhận xóa
                FE->>BE: Gửi yêu cầu xóa tài khoản
                BE->>DB: Xóa tài khoản và dữ liệu liên quan
                BE-->>FE: Xác nhận đã xóa
                FE-->>User: Thông báo xóa tài khoản thành công, đăng xuất
            end
        end
    end
```

---

## 10. Xuất video kèm phụ đề

Biểu đồ mô tả quá trình Người dùng xuất video mới có phụ đề gắn trực tiếp vào khung hình (phụ thuộc Upload video; mở rộng bởi Chỉnh sửa phụ đề và Tùy chỉnh độ phân giải).

```mermaid
sequenceDiagram
    actor User as Người dùng
    participant FE as Giao diện (Frontend)
    participant BE as Hệ thống (Backend)
    participant Storage as Lưu trữ video
    participant DB as Cơ sở dữ liệu
    participant Render as Bộ xử lý xuất video

    User->>FE: Mở video đã có phụ đề
    User->>FE: Chọn chức năng xuất video kèm phụ đề
    FE-->>User: Hiển thị các tùy chọn xuất video

    opt Tùy chỉnh độ phân giải (Extends)
        User->>FE: Chọn độ phân giải mong muốn
    end

    User->>FE: Xác nhận xuất video
    FE->>BE: Gửi yêu cầu xuất video (kèm độ phân giải)

    BE->>Storage: Lấy video gốc
    BE->>DB: Lấy dữ liệu phụ đề

    alt Video chưa xử lý xong / phụ đề không tồn tại
        BE-->>FE: Thông báo lỗi
        FE-->>User: Hiển thị lỗi, cho phép thử lại
    else Dữ liệu hợp lệ
        alt Phụ đề đã chỉnh sửa (Extends)
            DB-->>BE: Trả về phụ đề đã chỉnh sửa
        else Phụ đề gốc
            DB-->>BE: Trả về phụ đề tự động
        end

        BE->>Render: Yêu cầu gắn phụ đề vào video (kèm độ phân giải)
        Render->>Render: Ghép phụ đề và mã hóa video

        alt Xuất video thất bại
            Render-->>BE: Lỗi xử lý
            BE-->>FE: Thông báo lỗi
            FE-->>User: Hiển thị lỗi, cho phép thử lại
        else Xuất video thành công
            Render-->>BE: Trả về video đã gắn phụ đề
            BE->>Storage: Lưu video đầu ra
            BE-->>FE: Thông báo hoàn tất, cung cấp liên kết tải
            FE-->>User: Tải video đã gắn phụ đề về thiết bị
        end
    end
```

---

## 11. Upload video (Realtime)

Biểu đồ mô tả quá trình Người dùng Premium tải video lên và yêu cầu xử lý phụ đề theo chế độ Realtime (include Nâng cấp Premium, Chọn chế độ dịch và Xử lý Realtime qua Colab VM1/VM2).

```mermaid
sequenceDiagram
    actor User as Người dùng Premium
    participant FE as Giao diện (Frontend)
    participant BE as Hệ thống (Backend)
    participant DB as Cơ sở dữ liệu
    participant VM1 as Colab VM1 (Tiếng Anh)
    participant VM2 as Colab VM2 (Tiếng Việt)

    User->>FE: Chọn chức năng Upload video Realtime
    FE->>BE: Kiểm tra trạng thái Premium (include)

    alt Tài khoản chưa Premium
        BE-->>FE: Yêu cầu nâng cấp Premium
        FE-->>User: Chuyển đến chức năng Nâng cấp Premium
    else Tài khoản Premium
        BE-->>FE: Cho phép tải video
        User->>FE: Chọn video từ thiết bị
        User->>FE: Chọn chế độ dịch (include)
        FE->>BE: Gửi video và chế độ dịch

        BE->>BE: Kiểm tra định dạng và dung lượng video

        alt Video không hợp lệ
            BE-->>FE: Thông báo lỗi
            FE-->>User: Hiển thị lỗi, cho phép thử lại
        else Video hợp lệ
            BE->>DB: Tạo tác vụ xử lý Realtime

            alt Video tiếng Anh
                BE->>VM1: Gửi dữ liệu xử lý Realtime
                loop Theo từng đoạn âm thanh
                    VM1->>VM1: Nhận dạng giọng nói + dịch thuật
                    VM1-->>BE: Trả phụ đề theo đoạn
                    BE-->>FE: Đẩy phụ đề Realtime
                    FE-->>User: Hiển thị phụ đề dần theo đoạn
                end
            else Video tiếng Việt
                BE->>VM2: Gửi dữ liệu xử lý Realtime
                loop Theo từng đoạn âm thanh
                    VM2->>VM2: Nhận dạng giọng nói + dịch thuật
                    VM2-->>BE: Trả phụ đề theo đoạn
                    BE-->>FE: Đẩy phụ đề Realtime
                    FE-->>User: Hiển thị phụ đề dần theo đoạn
                end
            end

            alt Colab không phản hồi
                BE->>DB: Cập nhật trạng thái tác vụ thất bại
                BE-->>FE: Thông báo lỗi xử lý
                FE-->>User: Hiển thị lỗi, cho phép thử lại
            else Hoàn tất
                BE->>DB: Lưu phụ đề và cập nhật trạng thái hoàn tất
                BE-->>FE: Thông báo xử lý hoàn tất
                FE-->>User: Hiển thị phụ đề Realtime đầy đủ
            end
        end
    end
```
