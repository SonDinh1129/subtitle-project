# Đặc tả Use Case hệ thống SubAI

## 1. Nhóm Use Case Xác thực

Biểu đồ phân rã Use Case nhóm Xác thực mô tả các chức năng cơ bản mà tác nhân Khách có thể thực hiện trước khi sử dụng hệ thống SubAI. Nhóm chức năng này bao gồm đăng ký tài khoản, đăng nhập và khôi phục mật khẩu. Khi đăng ký, người dùng cần thực hiện xác nhận thông qua Magic Link được gửi về email. Khi đăng nhập, hệ thống tiến hành xác thực tài khoản để đảm bảo thông tin hợp lệ. Trong trường hợp quên mật khẩu, người dùng cần xác thực OTP trước khi đặt lại mật khẩu mới. Nhóm Use Case này đóng vai trò nền tảng, giúp hệ thống quản lý phiên đăng nhập và bảo vệ các chức năng yêu cầu xác thực.

### Bảng 2.x. Use Case Detail — Đăng ký tài khoản

| Trường | Nội dung |
|---|---|
| Tên Use Case | Đăng ký tài khoản |
| Tác nhân | Khách |
| Mô tả | Khách tạo tài khoản mới bằng cách nhập thông tin đăng ký và xác thực email thông qua Magic Link. |
| Tiền điều kiện | Khách chưa đăng nhập vào hệ thống. Email chưa được sử dụng để đăng ký tài khoản trước đó. |
| Hậu điều kiện | Tài khoản được tạo thành công và người dùng có thể đăng nhập vào hệ thống. |
| Luồng chính | 1. Khách chọn chức năng đăng ký tài khoản.<br>2. Hệ thống hiển thị form đăng ký.<br>3. Khách nhập họ tên, email và mật khẩu.<br>4. Hệ thống kiểm tra tính hợp lệ của thông tin.<br>5. Hệ thống gửi Magic Link đến email của người dùng.<br>6. Khách mở email và xác nhận Magic Link.<br>7. Hệ thống hoàn tất quá trình đăng ký tài khoản. |
| Luồng thay thế | Khách có thể quay lại trang đăng nhập nếu đã có tài khoản. |
| Luồng ngoại lệ | Email đã tồn tại hoặc thông tin nhập không hợp lệ thì hệ thống hiển thị thông báo lỗi. |

Bảng 2.x trình bày đặc tả Use Case đăng ký tài khoản, bao gồm tác nhân thực hiện, điều kiện bắt đầu và kết quả sau khi hoàn tất chức năng. Nội dung đặc tả giúp làm rõ quy trình tạo tài khoản mới và cơ chế xác nhận email thông qua Magic Link, từ đó đảm bảo tài khoản được khởi tạo hợp lệ trước khi người dùng truy cập vào hệ thống.

### Bảng 2.x. Use Case Detail — Đăng nhập

| Trường | Nội dung |
|---|---|
| Tên Use Case | Đăng nhập |
| Tác nhân | Khách |
| Mô tả | Khách nhập thông tin tài khoản để đăng nhập và sử dụng các chức năng chính của hệ thống. |
| Tiền điều kiện | Khách đã có tài khoản trong hệ thống. |
| Hậu điều kiện | Người dùng đăng nhập thành công và được chuyển đến trang Upload. |
| Luồng chính | 1. Khách chọn chức năng đăng nhập.<br>2. Hệ thống hiển thị form đăng nhập.<br>3. Khách nhập email và mật khẩu.<br>4. Hệ thống xác thực thông tin tài khoản.<br>5. Nếu thông tin hợp lệ, hệ thống tạo phiên đăng nhập.<br>6. Người dùng được chuyển đến trang Upload. |
| Luồng thay thế | Khách có thể chọn chức năng quên mật khẩu nếu không nhớ mật khẩu. |
| Luồng ngoại lệ | Nếu email hoặc mật khẩu không đúng, hệ thống hiển thị thông báo đăng nhập thất bại. |

Bảng 2.x trình bày đặc tả Use Case đăng nhập, bao gồm các thông tin về tác nhân chính, mục tiêu và điều kiện thực hiện chức năng. Nội dung đặc tả giúp mô tả rõ quy trình xác thực tài khoản, tạo phiên đăng nhập và đảm bảo chỉ những người dùng hợp lệ mới có thể truy cập vào các chức năng chính của hệ thống.

### Bảng 2.x. Use Case Detail — Quên mật khẩu

| Trường | Nội dung |
|---|---|
| Tên Use Case | Quên mật khẩu |
| Tác nhân | Khách |
| Mô tả | Khách thực hiện khôi phục mật khẩu bằng cách xác thực OTP được gửi về email. |
| Tiền điều kiện | Khách chưa đăng nhập và đã có tài khoản trong hệ thống. |
| Hậu điều kiện | Mật khẩu được cập nhật thành công và người dùng có thể đăng nhập bằng mật khẩu mới. |
| Luồng chính | 1. Khách chọn chức năng quên mật khẩu.<br>2. Hệ thống yêu cầu nhập email đã đăng ký.<br>3. Khách nhập email.<br>4. Hệ thống gửi mã OTP đến email của người dùng.<br>5. Khách nhập mã OTP để xác thực.<br>6. Hệ thống cho phép nhập mật khẩu mới.<br>7. Khách nhập và xác nhận mật khẩu mới.<br>8. Hệ thống cập nhật mật khẩu thành công. |
| Luồng thay thế | Khách có thể yêu cầu gửi lại mã OTP nếu chưa nhận được mã. |
| Luồng ngoại lệ | Nếu OTP sai, hết hạn hoặc mật khẩu mới không hợp lệ, hệ thống hiển thị thông báo lỗi. |

Bảng 2.x trình bày đặc tả Use Case quên mật khẩu, mô tả quá trình người dùng khôi phục quyền truy cập khi không nhớ mật khẩu cũ. Use Case này thể hiện rõ vai trò của cơ chế xác thực OTP trong việc kiểm tra đúng chủ sở hữu tài khoản trước khi cho phép đặt lại mật khẩu mới, góp phần nâng cao tính an toàn cho hệ thống.

## 2. Nhóm Use Case Upload và xử lý video

Biểu đồ phân rã Use Case Upload video (Normal) mô tả quá trình người dùng tải video lên hệ thống để tạo phụ đề theo chế độ xử lý thông thường. Trong luồng này, người dùng thực hiện chức năng Upload video, đồng thời hệ thống bao gồm bước chọn chế độ dịch để xác định ngôn ngữ xử lý phù hợp. Sau khi video được gửi lên, hệ thống chuyển dữ liệu đến Colab VM2 để thực hiện xử lý Normal. Thành phần Colab VM2 đảm nhiệm việc nhận dạng giọng nói, dịch thuật và trả kết quả phụ đề về hệ thống. Use Case này là một trong những chức năng cốt lõi của SubAI, giúp người dùng tạo phụ đề tự động từ video đầu vào.

### Bảng 2.x. Use Case Detail — Upload video (Normal)

| Trường | Nội dung |
|---|---|
| Tên Use Case | Upload video (Normal) |
| Tác nhân | Người dùng |
| Mô tả | Người dùng tải video lên hệ thống, chọn chế độ dịch và yêu cầu hệ thống xử lý phụ đề theo chế độ Normal. |
| Tiền điều kiện | Người dùng đã đăng nhập vào hệ thống. Video đầu vào có định dạng hợp lệ và dung lượng nằm trong giới hạn cho phép. |
| Hậu điều kiện | Video được tải lên thành công, hệ thống tạo tác vụ xử lý và gửi dữ liệu đến Colab VM2 để thực hiện nhận dạng giọng nói, dịch thuật và tạo phụ đề. |
| Luồng chính | 1. Người dùng chọn chức năng Upload video.<br>2. Hệ thống hiển thị giao diện tải video.<br>3. Người dùng chọn video từ thiết bị.<br>4. Người dùng chọn chế độ dịch phù hợp.<br>5. Hệ thống kiểm tra định dạng và dung lượng video.<br>6. Hệ thống tạo tác vụ xử lý ở chế độ Normal.<br>7. Hệ thống gửi dữ liệu đến Colab VM2 để xử lý.<br>8. Colab VM2 thực hiện nhận dạng giọng nói, dịch thuật và trả kết quả phụ đề về hệ thống. |
| Luồng thay thế | Người dùng có thể hủy thao tác upload trước khi gửi video lên hệ thống. |
| Luồng ngoại lệ | Nếu video sai định dạng, vượt quá dung lượng cho phép hoặc Colab VM2 không phản hồi, hệ thống hiển thị thông báo lỗi và cho phép người dùng thử lại. |

Bảng 2.x trình bày đặc tả Use Case Upload video (Normal), bao gồm actor thực hiện, điều kiện đầu vào, luồng xử lý chính và các trường hợp lỗi có thể xảy ra. Nội dung đặc tả giúp làm rõ quy trình người dùng tải video lên hệ thống, lựa chọn chế độ dịch và chuyển dữ liệu sang Colab VM2 để tạo phụ đề tự động.

### Bảng 2.x. Use Case Detail — Upload video (Realtime)

Biểu đồ phân rã Use Case Upload video (Realtime) mô tả chức năng dành cho người dùng Premium khi muốn tạo phụ đề theo chế độ thời gian thực. Chức năng này yêu cầu tài khoản đã được nâng cấp Premium, đồng thời bao gồm các bước chọn chế độ dịch và xử lý Realtime. Sau khi người dùng tải video lên, hệ thống chuyển dữ liệu đến các máy chủ Colab để xử lý. Colab VM1 hỗ trợ xử lý Realtime cho video tiếng Anh, trong khi Colab VM2 hỗ trợ xử lý Realtime cho video tiếng Việt. Use Case này thể hiện tính năng nâng cao của SubAI, giúp phụ đề được hiển thị dần trong quá trình xử lý video.

| Trường | Nội dung |
|---|---|
| Tên Use Case | Upload video (Realtime) |
| Tác nhân | Người dùng Premium |
| Mô tả | Người dùng Premium tải video lên hệ thống và yêu cầu xử lý phụ đề theo chế độ Realtime. |
| Tiền điều kiện | Người dùng đã đăng nhập và tài khoản đang ở trạng thái Premium. Video đầu vào có định dạng hợp lệ và nằm trong giới hạn cho phép. |
| Hậu điều kiện | Video được tải lên thành công, hệ thống tạo tác vụ xử lý Realtime và hiển thị phụ đề dần theo từng đoạn trong quá trình xử lý. |
| Luồng chính | 1. Người dùng Premium chọn chức năng Upload video Realtime.<br>2. Hệ thống kiểm tra trạng thái Premium của tài khoản.<br>3. Người dùng chọn video từ thiết bị.<br>4. Người dùng chọn chế độ dịch phù hợp.<br>5. Hệ thống kiểm tra định dạng và dung lượng video.<br>6. Hệ thống tạo tác vụ xử lý Realtime.<br>7. Hệ thống gửi dữ liệu đến Colab VM1 hoặc Colab VM2 tùy theo ngôn ngữ đầu vào.<br>8. Colab xử lý âm thanh và trả kết quả phụ đề theo từng đoạn.<br>9. Hệ thống hiển thị phụ đề Realtime cho người dùng. |
| Luồng thay thế | Người dùng có thể hủy thao tác upload trước khi gửi video lên hệ thống. |
| Luồng ngoại lệ | Nếu tài khoản chưa được nâng cấp Premium, hệ thống yêu cầu người dùng nâng cấp tài khoản. Nếu video không hợp lệ hoặc máy chủ Colab không phản hồi, hệ thống hiển thị thông báo lỗi và cho phép người dùng thử lại. |

Bảng 2.x trình bày đặc tả Use Case Upload video Realtime, bao gồm điều kiện sử dụng, quy trình xử lý và các thành phần liên quan. Nội dung đặc tả giúp làm rõ rằng đây là chức năng dành cho người dùng Premium, đồng thời thể hiện vai trò của Colab VM1 và Colab VM2 trong quá trình xử lý phụ đề theo thời gian thực.

## 3. Nhóm Use Case xem và chỉnh sửa phụ đề

Biểu đồ phân rã Use Case Xem video kèm phụ đề mô tả chức năng cho phép người dùng xem lại video đã được xử lý cùng với phụ đề tương ứng. Để thực hiện chức năng này, hệ thống cần có dữ liệu video và phụ đề được tạo ra từ Use Case Upload video trước đó. Sau khi video đã được xử lý thành công, người dùng có thể mở trình phát video, xem phụ đề hiển thị theo đúng timestamp và kiểm tra lại nội dung trước khi chỉnh sửa hoặc xuất kết quả. Use Case này đóng vai trò trung gian quan trọng giữa quá trình tạo phụ đề tự động và các chức năng hậu xử lý như chỉnh sửa phụ đề, tải file SRT hoặc xuất video gắn phụ đề.

### Bảng 2.x. Use Case Detail — Xem video kèm phụ đề

| Trường | Nội dung |
|---|---|
| Tên Use Case | Xem video kèm phụ đề |
| Tác nhân | Người dùng |
| Mô tả | Người dùng xem lại video đã tải lên cùng với phụ đề được hệ thống tạo tự động. |
| Tiền điều kiện | Người dùng đã đăng nhập vào hệ thống. Video đã được upload và xử lý thành công. |
| Hậu điều kiện | Video và phụ đề được hiển thị đồng bộ trên giao diện xem video. |
| Luồng chính | 1. Người dùng mở video đã xử lý.<br>2. Hệ thống tải dữ liệu video và phụ đề tương ứng.<br>3. Hệ thống hiển thị video trên trình phát.<br>4. Phụ đề được hiển thị theo đúng mốc thời gian của video.<br>5. Người dùng có thể phát, tạm dừng hoặc tua video để kiểm tra nội dung phụ đề. |
| Luồng thay thế | Người dùng có thể quay lại danh sách video hoặc chuyển sang chức năng chỉnh sửa phụ đề. |
| Luồng ngoại lệ | Nếu video hoặc dữ liệu phụ đề không tồn tại, hệ thống hiển thị thông báo lỗi và yêu cầu người dùng thực hiện lại quá trình upload. |

Bảng 2.x trình bày đặc tả Use Case xem video kèm phụ đề, bao gồm điều kiện thực hiện, luồng xử lý chính và các trường hợp lỗi có thể xảy ra. Nội dung đặc tả giúp làm rõ cách hệ thống hiển thị video cùng phụ đề đã được tạo tự động, đảm bảo người dùng có thể kiểm tra kết quả trước khi chỉnh sửa hoặc xuất file phụ đề.

### Bảng 2.x. Use Case Detail — Chỉnh sửa phụ đề

Biểu đồ phân rã Use Case Chỉnh sửa phụ đề mô tả chức năng cho phép người dùng điều chỉnh nội dung phụ đề sau khi hệ thống đã tạo phụ đề tự động từ video. Chức năng này phụ thuộc vào Use Case Upload video, vì người dùng cần có video và dữ liệu phụ đề trước khi tiến hành chỉnh sửa. Trong quá trình chỉnh sửa, người dùng có thể cập nhật nội dung phụ đề và thực hiện thao tác lưu để ghi nhận các thay đổi. Use Case này giúp người dùng kiểm tra, hiệu chỉnh và hoàn thiện phụ đề trước khi tải file SRT hoặc xuất video gắn phụ đề.

| Trường | Nội dung |
|---|---|
| Tên Use Case | Chỉnh sửa phụ đề |
| Tác nhân | Người dùng |
| Mô tả | Người dùng chỉnh sửa nội dung phụ đề đã được hệ thống tạo tự động từ video đã upload. |
| Tiền điều kiện | Người dùng đã đăng nhập vào hệ thống. Video đã được upload và phụ đề đã được tạo thành công. |
| Hậu điều kiện | Nội dung phụ đề được cập nhật theo chỉnh sửa của người dùng. |
| Luồng chính | 1. Người dùng mở video đã có phụ đề.<br>2. Hệ thống hiển thị danh sách các đoạn phụ đề tương ứng với video.<br>3. Người dùng chọn đoạn phụ đề cần chỉnh sửa.<br>4. Người dùng thay đổi nội dung phụ đề.<br>5. Người dùng thực hiện thao tác lưu.<br>6. Hệ thống cập nhật nội dung phụ đề đã chỉnh sửa. |
| Luồng thay thế | Người dùng có thể hủy chỉnh sửa hoặc tiếp tục chỉnh sửa các đoạn phụ đề khác. |
| Luồng ngoại lệ | Nếu dữ liệu phụ đề không tồn tại hoặc quá trình lưu thất bại, hệ thống hiển thị thông báo lỗi và yêu cầu người dùng thử lại. |

Bảng 2.x trình bày đặc tả Use Case chỉnh sửa phụ đề, bao gồm điều kiện thực hiện, quy trình chỉnh sửa và thao tác lưu kết quả. Nội dung đặc tả giúp làm rõ cách người dùng hiệu chỉnh phụ đề sau khi hệ thống tạo tự động, từ đó nâng cao chất lượng nội dung trước khi tải xuống hoặc xuất video hoàn chỉnh.

## 4. Nhóm Use Case xuất kết quả

Biểu đồ phân rã Use Case Tải file SRT mô tả chức năng cho phép người dùng tải phụ đề đã được hệ thống tạo ra về máy dưới định dạng SRT. Chức năng này phụ thuộc vào Use Case Upload video, vì người dùng cần tải video lên và hệ thống phải xử lý tạo phụ đề trước khi có thể tải file. Ngoài ra, Use Case này có thể được mở rộng từ chức năng Chỉnh sửa phụ đề, trong trường hợp người dùng muốn tải xuống phiên bản phụ đề đã được hiệu chỉnh. Chức năng tải file SRT giúp người dùng lưu trữ, sử dụng hoặc chỉnh sửa phụ đề bằng các phần mềm khác bên ngoài hệ thống.

### Bảng 2.x. Use Case Detail — Tải file SRT

| Trường | Nội dung |
|---|---|
| Tên Use Case | Tải file SRT |
| Tác nhân | Người dùng |
| Mô tả | Người dùng tải file phụ đề SRT được hệ thống tạo tự động hoặc đã chỉnh sửa về thiết bị cá nhân. |
| Tiền điều kiện | Người dùng đã đăng nhập vào hệ thống. Video đã được upload và phụ đề đã được tạo thành công. |
| Hậu điều kiện | File phụ đề định dạng SRT được tải về thiết bị của người dùng. |
| Luồng chính | 1. Người dùng mở video đã có phụ đề.<br>2. Hệ thống hiển thị tùy chọn tải file SRT.<br>3. Người dùng chọn chức năng tải file SRT.<br>4. Hệ thống tạo hoặc lấy file SRT tương ứng với phụ đề hiện tại.<br>5. Hệ thống gửi file về trình duyệt.<br>6. Người dùng lưu file SRT về thiết bị. |
| Luồng thay thế | Nếu người dùng đã chỉnh sửa phụ đề, hệ thống có thể tạo file SRT dựa trên nội dung phụ đề sau chỉnh sửa. |
| Luồng ngoại lệ | Nếu file phụ đề chưa tồn tại, video chưa xử lý xong hoặc quá trình tải xuống thất bại, hệ thống hiển thị thông báo lỗi cho người dùng. |

Bảng 2.x trình bày đặc tả Use Case tải file SRT, bao gồm điều kiện thực hiện, quy trình tải xuống và các trường hợp lỗi có thể xảy ra. Nội dung đặc tả giúp làm rõ cách người dùng nhận kết quả phụ đề từ hệ thống sau khi video đã được xử lý, đồng thời hỗ trợ tải xuống cả phụ đề gốc và phụ đề đã được chỉnh sửa.

### Bảng 2.x. Use Case Detail — Xuất video kèm phụ đề

Biểu đồ phân rã Use Case Xuất video kèm phụ đề mô tả chức năng cho phép người dùng tạo ra một video mới có phụ đề được gắn trực tiếp vào nội dung video. Chức năng này phụ thuộc vào Use Case Upload video, vì hệ thống cần có video đầu vào và dữ liệu phụ đề được tạo trước đó. Ngoài ra, Use Case này có thể được mở rộng từ chức năng Chỉnh sửa phụ đề trong trường hợp người dùng muốn xuất video với nội dung phụ đề đã được hiệu chỉnh. Người dùng cũng có thể tùy chỉnh độ phân giải trước khi xuất video nhằm phù hợp với nhu cầu sử dụng.

| Trường | Nội dung |
|---|---|
| Tên Use Case | Xuất video kèm phụ đề |
| Tác nhân | Người dùng |
| Mô tả | Người dùng xuất video mới có phụ đề được gắn trực tiếp vào khung hình video. |
| Tiền điều kiện | Người dùng đã đăng nhập vào hệ thống. Video đã được upload và phụ đề đã được tạo thành công. |
| Hậu điều kiện | Video mới có phụ đề được tạo thành công và người dùng có thể tải về thiết bị. |
| Luồng chính | 1. Người dùng mở video đã có phụ đề.<br>2. Người dùng chọn chức năng xuất video kèm phụ đề.<br>3. Hệ thống hiển thị các tùy chọn xuất video.<br>4. Người dùng chọn độ phân giải mong muốn.<br>5. Hệ thống sử dụng video và phụ đề hiện tại để tạo video mới.<br>6. Hệ thống hoàn tất quá trình xuất video.<br>7. Người dùng tải video đã gắn phụ đề về thiết bị. |
| Luồng thay thế | Nếu người dùng đã chỉnh sửa phụ đề, hệ thống sử dụng nội dung phụ đề sau chỉnh sửa để xuất video. |
| Luồng ngoại lệ | Nếu video chưa xử lý xong, dữ liệu phụ đề không tồn tại hoặc quá trình xuất video thất bại, hệ thống hiển thị thông báo lỗi và cho phép người dùng thử lại. |

Bảng 2.x trình bày đặc tả Use Case xuất video kèm phụ đề, bao gồm điều kiện thực hiện, quy trình xuất video và các chức năng mở rộng liên quan. Nội dung đặc tả giúp làm rõ cách hệ thống tạo video đầu ra có phụ đề được gắn trực tiếp, đồng thời cho phép người dùng lựa chọn độ phân giải và sử dụng phụ đề đã chỉnh sửa nếu có.

## 5. Nhóm Use Case tài khoản và thanh toán

Biểu đồ phân rã Use Case Nâng cấp Premium mô tả chức năng cho phép người dùng nâng cấp tài khoản để sử dụng các tính năng mở rộng của hệ thống SubAI. Chức năng này bao gồm quá trình khởi tạo yêu cầu nâng cấp và xử lý thanh toán thông qua cổng thanh toán MoMo. Sau khi người dùng thực hiện thanh toán thành công, hệ thống cập nhật trạng thái tài khoản sang Premium. Use Case này giúp hệ thống phân quyền rõ ràng giữa người dùng thông thường và người dùng Premium, đặc biệt đối với các tính năng nâng cao như xử lý Realtime.

### Bảng 2.x. Use Case Detail — Nâng cấp Premium

| Trường | Nội dung |
|---|---|
| Tên Use Case | Nâng cấp Premium |
| Tác nhân | Người dùng |
| Mô tả | Người dùng thực hiện nâng cấp tài khoản lên Premium thông qua cổng thanh toán MoMo để sử dụng các tính năng nâng cao của hệ thống. |
| Tiền điều kiện | Người dùng đã đăng nhập vào hệ thống và chưa ở trạng thái Premium. |
| Hậu điều kiện | Tài khoản của người dùng được cập nhật lên trạng thái Premium sau khi thanh toán thành công. |
| Luồng chính | 1. Người dùng chọn chức năng nâng cấp Premium.<br>2. Hệ thống hiển thị thông tin gói Premium và chi phí thanh toán.<br>3. Người dùng xác nhận nâng cấp.<br>4. Hệ thống tạo yêu cầu thanh toán qua MoMo.<br>5. Người dùng thực hiện thanh toán trên giao diện MoMo.<br>6. MoMo xử lý giao dịch và gửi kết quả về hệ thống.<br>7. Hệ thống xác nhận thanh toán thành công và cập nhật tài khoản người dùng lên Premium. |
| Luồng thay thế | Người dùng có thể hủy thao tác nâng cấp trước khi thực hiện thanh toán. |
| Luồng ngoại lệ | Nếu thanh toán thất bại, bị hủy hoặc hệ thống không nhận được xác nhận từ MoMo, tài khoản người dùng vẫn giữ nguyên trạng thái hiện tại và hệ thống hiển thị thông báo phù hợp. |

Bảng 2.x trình bày đặc tả Use Case nâng cấp Premium, bao gồm tác nhân thực hiện, điều kiện đầu vào, quy trình thanh toán và kết quả sau khi hoàn tất giao dịch. Nội dung đặc tả giúp làm rõ cách hệ thống tích hợp với MoMo để xử lý thanh toán, đồng thời đảm bảo tài khoản chỉ được kích hoạt Premium khi giao dịch được xác nhận thành công.

### Bảng 2.x. Use Case Detail — Xem thông tin tài khoản

Biểu đồ phân rã Use Case Xem thông tin tài khoản mô tả chức năng cho phép người dùng truy cập và quản lý thông tin cá nhân trong hệ thống SubAI. Chức năng này yêu cầu người dùng đã đăng nhập vào hệ thống. Từ trang thông tin tài khoản, người dùng có thể thực hiện các thao tác mở rộng như đổi tên, đổi mật khẩu hoặc xóa tài khoản. Use Case này giúp người dùng chủ động quản lý hồ sơ cá nhân và đảm bảo thông tin tài khoản luôn được cập nhật chính xác.

| Trường | Nội dung |
|---|---|
| Tên Use Case | Xem thông tin tài khoản |
| Tác nhân | Người dùng |
| Mô tả | Người dùng xem thông tin cá nhân, trạng thái tài khoản và thực hiện các thao tác quản lý tài khoản. |
| Tiền điều kiện | Người dùng đã đăng nhập vào hệ thống. |
| Hậu điều kiện | Thông tin tài khoản được hiển thị; các thay đổi nếu có được cập nhật vào hệ thống. |
| Luồng chính | 1. Người dùng chọn chức năng xem thông tin tài khoản.<br>2. Hệ thống kiểm tra trạng thái đăng nhập.<br>3. Hệ thống tải thông tin tài khoản của người dùng.<br>4. Hệ thống hiển thị email, họ tên, trạng thái tài khoản và các thông tin liên quan.<br>5. Người dùng xem thông tin hoặc chọn các thao tác quản lý tài khoản. |
| Luồng thay thế | Người dùng có thể chọn đổi tên, đổi mật khẩu hoặc xóa tài khoản từ trang thông tin tài khoản. |
| Luồng ngoại lệ | Nếu người dùng chưa đăng nhập, hệ thống chuyển hướng đến trang đăng nhập. Nếu không tải được dữ liệu tài khoản, hệ thống hiển thị thông báo lỗi. |

Bảng 2.x trình bày đặc tả Use Case xem thông tin tài khoản, bao gồm điều kiện thực hiện, quy trình hiển thị thông tin và các chức năng mở rộng liên quan. Nội dung đặc tả giúp làm rõ cách người dùng truy cập hồ sơ cá nhân, kiểm tra trạng thái tài khoản và thực hiện các thao tác quản lý thông tin trong hệ thống.
