1  # <a name="_toc231502370"></a>**NGHIỆP VỤ XỬ LÝ VÀ THUẬT TOÁN**
   1  ## <a name="_toc231502371"></a>Nghiệp vụ xử lý video và âm thanh
      1  ### <a name="_toc231502372"></a>**Tổng quan và mục tiêu**
         Phân hệ xử lý video và âm thanh đóng vai trò là tầng tiền xử lý của toàn bộ hệ thống tạo phụ đề tự động. Mục tiêu chính của phân hệ này là nhận đầu vào là một tệp video tùy ý từ người dùng, sau đó thực hiện chuỗi biến đổi có kiểm soát để tạo ra các đoạn âm thanh đã được chuẩn hóa, sẵn sàng đưa vào mô hình nhận dạng tiếng nói ở tầng tiếp theo.

         Phân hệ này phải đảm bảo bốn yêu cầu cốt lõi:

- Tính chính xác — chỉ trích xuất những vùng thực sự có tiếng nói, loại bỏ khoảng lặng và nhiễu nền nhằm tránh lãng phí tài nguyên nhận dạng tiếng nói và giảm xác suất xuất hiện hallucination.
- Tính tương thích — đầu ra phải đáp ứng đúng định dạng và thông số kỹ thuật mà mô hình ASR yêu cầu (16 kHz, mono, PCM float32).
- Tính hiệu quả — toàn bộ quá trình chạy ở luồng nền không blocking giao diện người dùng, đồng thời hỗ trợ cả chế độ batch lẫn realtime.
- Tính bền vững — kiểm soát được các trường hợp bất thường: video không có tiếng nói, file hỏng, định dạng không hỗ trợ, thời lượng quá dài, hoặc kết nối tới VM bị gián đoạn.
  1  ### <a name="_toc231502373"></a>**Luồng xử lý tổng thể**
     Khi người dùng tải lên tệp video qua giao diện web, frontend gửi yêu cầu HTTP POST tới endpoint upload. Controller thực hiện xác thực người dùng và kiểm tra rate limit trước khi tiếp nhận tệp. Sau đó, tệp video được lưu vào thư mục uploads/ trên server, đồng thời hệ thống tạo một bản ghi công việc lưu dưới dạng JSON trong thư mục jobs/ (hoặc cơ sở dữ liệu), gồm các trường định danh job, trạng thái khởi tạo, đường dẫn tệp liên quan và thời gian tạo.

     Ngay sau khi job được khởi tạo, controller kích hoạt một luồng nền thực thi nhằm đảm bảo API upload trả về phản hồi tức thì cho người dùng (kèm job\_id), trong khi toàn bộ pipeline xử lý nặng chạy bất đồng bộ ở nền. Frontend sau đó sử dụng job\_id để theo dõi tiến độ qua kênh Server-Sent Events.

     Luồng tổng thể được mô tả như sau:

     ![](Aspose.Words.a6de2fd4-e022-4cec-8bf0-cd9efd52d66f.001.png)

     <a name="_toc231346667"></a>*Hình *3*.*1*: Luồng xử lý nghiệp vụ xử lý video và âm thanh*

     Trạng thái job được biểu diễn bằng một enum hữu hạn (JobStatus) gồm các giá trị PENDING, EXTRACTING, VAD, ENCODING, TRANSCRIBING, POST\_PROCESSING, DONE, FAILED. Mỗi lần chuyển trạng thái, hàm update\_job đồng thời cập nhật phần trăm tiến độ ví dụ 0 → 10 → 20 → 40 → 80 → 95 → 100 và đẩy sự kiện vào hàng đợi SSE để frontend hiển thị thanh tiến trình mượt mà.
  1  ### <a name="_toc231502374"></a>**Tiền xử lý: Trích xuất và chuẩn hóa âm thanh**
     Bước đầu tiên trong pipeline là tách luồng âm thanh ra khỏi tệp video gốc bằng công cụ FFmpeg. Lý do lựa chọn FFmpeg gồm: (i) khả năng xử lý hầu hết các định dạng container video phổ biến (MP4, MKV, AVI, MOV, WEBM…) mà không yêu cầu cài đặt codec bổ sung; (ii) cho phép chỉ định chính xác các thông số đầu ra trong một lệnh duy nhất, tránh phải qua nhiều bước trung gian; (iii) hiệu năng cao, đã được tối ưu C/ASM, hỗ trợ tăng tốc phần cứng nếu cần.

     Lệnh trích xuất điển hình:

     ffmpeg -i input\_video.mp4 \

     `       `-ar 16000 \

     `       `-ac 1 \

     `       `-vn \

     `       `output\_audio.wav

     Trong đó -ar 16000 đặt sample rate 16 kHz, -ac 1 chuyển sang mono, -vn loại bỏ luồng video. Việc chuẩn hóa về 16 kHz mono WAV là bắt buộc vì cả Silero VAD lẫn các mô hình Whisper/PhoWhisper đều được huấn luyện và tối ưu hóa trên định dạng này. Sử dụng sample rate khác ví dụ 44.1 kHz stereo từ video gốc sẽ khiến VAD cho kết quả kém chính xác hoặc gây lỗi đầu vào cho mô hình ASR. FFmpeg thực hiện downsampling và chuyển đổi kênh âm thanh trong một bước duy nhất, giảm thiểu thời gian I/O và lượng tệp tạm.
  1  ### <a name="_toc231502375"></a>**Phát hiện đoạn nói bằng Silero VAD**
     Sau khi có tệp WAV chuẩn hóa, hệ thống áp dụng Silero VAD để xác định chính xác các khoảng thời gian có chứa tiếng nói, loại bỏ khoảng lặng, nhạc nền và tiếng ồn. Đây là bước then chốt quyết định chất lượng phân đoạn phụ đề về sau.

1. **Lý do lựa chọn Silero VAD**

Hệ thống đã cân nhắc giữa ba phương án phổ biến: WebRTC VAD, pyannote.audio và Silero VAD. Bảng dưới so sánh sơ bộ:

<a name="_toc231346701"></a>*Bảng *3*.*1*: Bảng so sánh WebRTC VAD, Pyannote.audio, Silero VAD*

|**Tiêu chí**|**WebRTC VAD**|**Pyannote.audio**|**Silero VAD**|
| - | - | - | - |
|Kích thước|< 1 MB|~30 MB|~2MB|
|Yêu cầu GPU|Không|Khuyễn nghị có|Không|
|Độ chính xác trên nhiễu|Thấp|Rất cao|Cao|
|Hỗ trợ đa ngôn ngữ|Hạn chế|Có|Có (>100 ngôn ngữ)|
|Tốc độ inference (CPU)|Rất nhanh|Trung bình|Nhanh|
|Giấy phép|BSD|MIT|MIT|

Silero VAD cho thấy sự cân bằng tốt nhất giữa độ chính xác, kích thước mô hình và tốc độ trên CPU, đồng thời cung cấp tiện ích read\_audio và get\_speech\_timestamps thuận tiện, nên được chọn làm thành phần phát hiện tiếng nói chính của hệ thống.

1. **Khởi tạo model**

Hàm load\_vad() tải model Silero thông qua torch.hub.load( "snakers4/silero-vad", model="silero\_vad") và lưu vào hai biến module-scope \_vad\_model, \_vad\_utils. Model được tải theo cơ chế eager loading ngay khi server khởi động, tránh độ trễ lần đầu cho request. Trước khi gọi bất kỳ hàm VAD nào, hệ thống kiểm tra is\_vad\_ready() để đảm bảo model đã sẵn sàng; nếu chưa sẵn sàng, hàm detect\_speech\_segments ném ra RuntimeError.

1. **Thực thi phát hiện**

Hàm detect\_speech\_segments(audio\_path) thực hiện toàn bộ quá trình phát hiện, sử dụng read\_audio và get\_speech\_timestamps từ \_vad\_utils. Các tham số hoạt động hiện tại:

<a name="_toc231346702"></a>*Bảng *3*.*2*: Bảng tham số thực thi*

|**Tham số**|**Giá trị**|**Ý nghĩa**|
| - | - | - |
|threshold|0\.5|Ngưỡng xác suất để phân loại frame là tiếng nói|
|min\_speech\_duration\_ms|250ms|Độ dài tối thiểu của một đoạn nói hợp lệ|
|min\_silence\_duration\_ms|500ms|Khoảng lặng tối thiểu để cắt segment|
|window\_size\_sample|512|Kích thước cửa sổ phân tích (~32ms ở 16kHz)|
|speech\_pad\_ms|100ms|Đêm hai đầu mỗi segment để tránh cắt mất âm|

Đầu ra là danh sách các mốc thời gian dạng [{"start": float, "end": float}, ...] tính bằng giây, kèm tensor sóng âm gốc đã được nạp một lần để tái sử dụng cho bước cắt segment. Việc trả về cả tensor giúp tránh phải đọc lại file WAV ở các bước tiếp theo.

1. **Xử lý trường hợp đặc biệt**

Nếu detect\_speech\_segments() trả về danh sách rỗng, hệ thống kết luận toàn bộ audio không chứa tiếng nói. Trong cài đặt hiện tại, pipeline ném ra RuntimeError("No speech detected in the video."), controller bắt ngoại lệ này và đánh dấu job ở trạng thái FAILED kèm thông điệp hiển thị cho người dùng. Hướng phát triển trong tương lai có thể bổ sung cơ chế fallback — tạo một segment phủ toàn bộ thời lượng audio và vẫn gửi qua ASR — nhằm xử lý các tình huống VAD bỏ sót giọng nói có âm lượng rất nhỏ hoặc bị chìm trong nhạc nền.
1  ### <a name="_toc231502376"></a>**Chuẩn hóa và phân đoạn** 
   Danh sách segment thô từ VAD thường chứa hai vấn đề đối lập: một số segment quá dài như việc: diễn giả nói liên tục nhiều chục giây, một số khác quá ngắn như từ đơn lẻ hoặc tiếng đệm. Cả hai trường hợp đều không lý tưởng để gửi lên ASR: segment quá dài tăng rủi ro timeout và làm giảm độ chính xác phân đoạn câu của Whisper, trong khi segment quá ngắn tạo ra nhiều request không hiệu quả và làm vỡ ngữ cảnh.

   Hệ thống giải quyết bằng hai hàm xử lý tuần tự với thứ tự split → merge:

Bước 1: split\_long\_segment(seg, max\_duration=25.0)

Với mỗi segment có thời lượng vượt 25 giây, hàm tính số đoạn cần chia:

|<p>n\_chunks = ⌊duration / 25⌋ + 1</p><p>chunk\_dur = duration / n\_chunks</p>|
| - |

Sau đó cắt segment thành n\_chunks đoạn có độ dài bằng nhau, chunk\_dur giây mỗi đoạn đoạn cuối cùng được làm tròn về seg.end để tránh sai số tích lũy. Cách chia đều cơ học này được lựa chọn vì tại bước này hệ thống chưa có transcript, do đó không thể tìm điểm ngắt theo dấu câu hay theo chỗ nghỉ ngắn trong câu. Giới hạn 25 giây được chọn dựa trên giới hạn context tối ưu của Whisper là 30s mỗi cửa sổ cùng với khoảng đệm 5 s để Whisper xử lý các từ ở biên một cách an toàn.

- Hướng cải tiến: Sau khi có vòng ASR thứ nhất, có thể cắt lại các segment quá dài tại vị trí dấu câu kết thúc câu (., ?, !) hoặc tại điểm có khoảng cách giữa hai từ liên tiếp lớn nhất. Điều này yêu cầu kiến trúc hai pha (two-pass), hiện tại chưa triển khai.

Bước 2: merge\_short\_segments(segments, min\_duration=2.0, max\_duration=25.0)

Duyệt danh sách segment theo thứ tự thời gian và gộp các segment liền kề có thời lượng nhỏ hơn 2.0 giây vào segment kế tiếp, miễn là tổng độ dài sau khi gộp không vượt quá 25 giây. Nếu việc gộp tiếp theo sẽ làm vượt ngưỡng max\_duration, buffer hiện tại được xả ra trước rồi mới bắt đầu buffer mới. Cuối vòng, buffer còn lại được xả nếu đạt min\_duration.

Cách xếp thứ tự split trước merge giúp đảm bảo: (i) không có segment nào vượt 25 giây sau khi split; (ii) các đoạn ngắn được gom lại để giảm overhead RPC; (iii) ràng buộc 25 giây vẫn được giữ trong quá trình gộp.
1  ### <a name="_toc231502377"></a>**Encode và truyền tải segment lên Colab**
   Sau khi có danh sách segment đã chuẩn hóa, hệ thống cần truyền nội dung âm thanh tương ứng lên Colab để thực thi ASR. Do Colab là môi trường từ xa không có quyền truy cập trực tiếp vào filesystem của backend, hệ thống sử dụng cơ chế base64 encoding để nhúng dữ liệu âm thanh vào payload JSON của HTTP POST request.

   Hàm encode\_segments\_for\_colab (segments, wav\_tensor, sample\_rate = 16000) thực hiện quy trình:

   Với mỗi segment {start, end}, tính chỉ số mẫu tương ứng: start\_sample = ⌊start × 16000⌋, end\_sample = ⌊end × 16000⌋.

   Cắt lát tensor wav\_tensor[start\_sample:end\_sample] và ép kiểu sang numpy.float32 — đây là định dạng PCM thô (không kèm header WAV) được Whisper/PhoWhisper hỗ trợ trực tiếp.

   Chuyển mảng float32 thành chuỗi byte qua tobytes(), mã hóa base64 và đính vào payload.

   Cấu trúc payload gửi lên VM:

   ```json

   {

   `  `"segments": [

   `    `{

   `      `"audio\_base64": "<base64\_encoded\_pcm\_float32>",

   `      `"start\_offset": 1.20,

   `      `"end\_offset": 8.70

   `    `}

   `  `],

   `  `"language": "vi",

   `  `"job\_id": "abc123"

   }

   ```

   Trong đó language và job\_id nằm ở mức payload bao ngoài chứ không lặp lại trong từng segment, giúp giảm dung lượng truyền tải. Mỗi segment là một đơn vị xử lý độc lập, cho phép VM xử lý song song nếu cần, đồng thời đơn giản hóa cơ chế retry — chỉ cần gửi lại segment bị lỗi thay vì toàn bộ audio.

   Lưu ý về overhead: Base64 làm phình kích thước dữ liệu khoảng 33 %. Một video 60 phút sau khi ép xuống 16 kHz mono float32 có dung lượng khoảng 14.4 MB; sau base64 sẽ trở thành ~19.2 MB. Trong trường hợp băng thông là yếu tố hạn chế, có thể cân nhắc thay base64 bằng định dạng nhị phân như multipart, gRPC, WebSocket binary frame cho các phiên bản tiếp theo.
1  ### <a name="_toc231502378"></a>**Chế độ Realtime**
   Song song với luồng batch mô tả ở trên, hệ thống hỗ trợ chế độ xử lý realtime phục vụ các trường hợp như ghi âm trực tiếp hoặc stream video. Trong chế độ này, lớp AudioStreamProducer đảm nhận việc đọc luồng âm thanh theo từng frame nhỏ thông qua hàm iter\_frames(), cấu hình frame\_duration = 0.032 s tương ứng với 512 mẫu ở 16 kHz — đây cũng là kích thước cửa sổ Silero VAD mong đợi.

   Điểm khác biệt cốt lõi với chế độ batch:

   <a name="_toc231346703"></a>*Bảng *3*.*3*: Bảng so sánh chế độ Normal và Realtime*

   |**Khía cạnh**|**Batch**|**Realtime**|
   | - | - | - |
   |Vị trí chạy VAD|Backend|VM2|
   |Vị trí chạy ASR|Colab VM|VM2|
   |Giao thức truyền|HTTP POST + base 64|WebSocket nhị phân|
   |Cấu hình endpoint|COLAB\_URL|COLAB\_REALTIME\_URL|
   |Độ trễ|Chấp nhận cao|Yêu cầu thấp (< 2s)|

   Trong realtime, các audio frame được stream trực tiếp lên VM2 qua WebSocket. Silero VAD và mô hình PhoWhisper chạy ngay trên VM2, trả về transcript từng đoạn theo thời gian thực. Backend chuyển tiếp kết quả này tới frontend qua Server-Sent Events, cho phép giao diện hiển thị phụ đề từng phần ngay trong quá trình xử lý mà không cần đợi toàn bộ audio kết thúc. Đường dẫn WebSocket VI là /ws/transcribe\_vi\_realtime.
1  ### <a name="_toc231502379"></a>**Yêu cầu hiệu năng và giới hạn kỹ thuật**
   Một số ràng buộc kỹ thuật cần lưu ý trong vận hành thực tế của phân hệ này. Về khởi tạo model, load\_vad() phải được gọi trước khi bất kỳ request nào đến detect\_speech\_segments(); nếu model chưa được tải, hệ thống ném RuntimeError. Triển khai khuyến nghị là eager loading ngay khi server khởi động thay vì on-demand, để tránh độ trễ lần đầu và làm các request đầu tiên có hành vi nhất quán.

   Về kích thước file và thời gian xử lý, các bước FFmpeg và VAD có độ phức tạp tuyến tính theo thời lượng video. Với video dài trên 60 phút, thời gian tiền xử lý có thể đạt vài chục giây và cần được thông báo qua progress callback để frontend hiển thị thanh tiến trình mượt mà. Hệ thống đặt giới hạn cứng cho thời lượng video tối đa là 4 giờ và dung lượng tệp tối đa là 2 GB ngay tại bước upload, ngăn các trường hợp ngốn tài nguyên bất thường.

   Về bảo mật, endpoint upload được bảo vệ bởi auth và rate limiter, ngăn chặn lạm dụng tài nguyên server từ các request trái phép hoặc tần suất quá cao. Kích thước payload và MIME type được kiểm tra tại tầng controller; tệp upload được lưu vào thư mục riêng biệt theo job\_id để tránh xung đột tên và hỗ trợ dọn dẹp định kỳ. Sau khi job hoàn tất hoặc thất bại quá Time to Live, các tệp tạm trong uploads/ và outputs/ được dọn dẹp tự động bằng tác vụ nền.

   Về xử lý lỗi và khả năng phục hồi, mỗi bước trong pipeline được bao trong khối try/except riêng. Lỗi VAD, lỗi mạng tới VM, hoặc timeout đều được ghi vào trường job.error và đẩy lên SSE để người dùng nhận thông báo. Với lỗi tạm thời ở tầng truyền ví dụ: HTTP 5xx, mất kết nối,… client gửi tới VM thực hiện retry theo cấp số nhân tối đa 3 lần trước khi đánh dấu segment đó thất bại.
1  ## <a name="_toc231502380"></a>Nghiệp vụ nhận dạng tiếng nói 
   1  ### <a name="_toc231502381"></a>**Tổng quan và mục tiêu**
      Phân hệ nhận dạng tiếng nói là tầng xử lý trung tâm của hệ thống, có nhiệm vụ chuyển đổi các đoạn âm thanh đã được chuẩn hóa thành văn bản có dấu thời gian. Đầu ra của phân hệ này là danh sách các từ kèm thông tin {word, start, end} — dữ liệu nền tảng để tạo phụ đề SRT ở các bước sau và để căn chỉnh phụ đề chính xác đến từng từ.

      Hệ thống hỗ trợ hai ngôn ngữ chính là tiếng Anh và tiếng Việt, đồng thời tích hợp mô-đun dịch máy EN→VI để phục vụ trường hợp người dùng muốn tạo phụ đề song ngữ hoặc dịch nội dung tiếng Anh sang tiếng Việt. Toàn bộ năng lực tính toán được đẩy ra các máy chủ GPU từ xa (Colab VM), giữ cho backend chính nhẹ, không bị blocking và có thể chạy trên hạ tầng CPU phổ thông.

      Phân hệ ASR vận hành theo hai chế độ tách biệt hoàn toàn về kiến trúc: Batch Mode phục vụ xử lý file video đã tải lên, và Realtime Mode phục vụ luồng âm thanh trực tiếp. Hai chế độ này sử dụng các mô hình khác nhau, giao thức kết nối khác nhau, cấu hình sample rate khác nhau, và được triển khai trên hai Colab VM riêng biệt nhằm cô lập tài nguyên GPU và đảm bảo độ tin cậy.
   1  ### <a name="_toc231502382"></a>**Kiến trúc tổng thể hệ thống ASR**
      Hệ thống ASR được tổ chức theo mô hình client–server phân tán, trong đó backend Python đóng vai trò client điều phối, còn năng lực inference nằm hoàn toàn trên hai Colab VM kết nối qua đường hầm ngrok:

      Địa chỉ kết nối của cả hai VM được cấu hình qua biến môi trường COLAB\_URL (VM1) và COLAB\_REALTIME\_URL (VM2) trong tệp .env.local, cho phép thay đổi endpoint mà không cần sửa mã nguồn — điều cần thiết vì ngrok tạo URL mới mỗi phiên Colab.

      Lý do tách hai VM: Colab miễn phí giới hạn về VRAM và session, nếu nạp đồng thời cả pipeline batch (Faster-Whisper + PhoWhisper + VinAI MT) lẫn pipeline realtime (Kyutai + Moshi) thì rất dễ vượt ngưỡng và gây OOM. Tách hai VM còn cho phép: (i) warm cache độc lập cho từng pipeline; (ii) fail isolation — sự cố ở VM realtime không kéo theo gián đoạn dịch vụ batch; (iii) scale dọc từng VM theo nhu cầu thực tế của mỗi loại workload.
   1  ### <a name="_toc231502383"></a>**Batch Mode – VM1**
1. **Các mô hình sử dụng**

VM1 triển khai ba mô hình chạy tuần tự trong một pipeline duy nhất.

Faster-Whisper large-v3 đảm nhận nhận dạng tiếng Anh. Đây là bản tối ưu hóa của OpenAI Whisper large-v3, được chuyển đổi sang định dạng CTranslate2 để tăng tốc inference trên GPU với mức tiêu thụ VRAM thấp hơn. Mô hình hỗ trợ trả về word-level timestamps — thông tin thiết yếu để căn chỉnh phụ đề chính xác đến từng từ.

PhoWhisper large đảm nhận nhận dạng tiếng Việt. Đây là mô hình do nhóm VinAI phát triển, được fine-tune đặc biệt cho tiếng Việt bao gồm các phương ngữ và đặc thù ngữ âm học của tiếng Việt. Mô hình cũng được chuyển đổi sang CTranslate2 để tích hợp với thư viện faster-whisper.

VinAI vinai-translate-en2vi-v2 đảm nhận dịch máy EN→VI. Đây là mô hình seq2seq dựa trên kiến trúc mBART, cho tốc độ dịch gần như tức thì với các đoạn văn bản độ dài phụ đề thông thường.

Bảng tổng hợp thông số các mô hình trên VM1:

<a name="_toc231346704"></a>*Bảng *3*.*4*: Bảng tổng hợp thông số các mô hình trên Colab VM1*

|**Mô hình**|**Nhiệm vụ**|**Kích thước**|**VRAM**|**Tốc độ**|
| - | - | - | - | - |
|Faster-Whisper large-v3|ASR (EN)|~3 GB|~2 GB|~10× realtime|
|PhoWhisper large (CTranslate2)|ASR (VI)|~1.5 GB|~2 GB|~5–8× realtime|
|VinAI vinai-translate-en2vi-v2|MT (EN→VI)|~300 MB|~2 GB|Gần tức thì|

Tất cả các mô hình sử dụng precision float16 trên CUDA để tối ưu tốc độ và tiết kiệm VRAM.

1. **Giao thức kết nối và luồng xử lý**

Backend giao tiếp với VM1 thông qua lớp ColabClient bằng giao thức HTTP POST. Endpoint nhận request là POST {COLAB\_URL}/transcribe\_translate, được VM1 phục vụ qua Flask API.

Cấu trúc payload thực tế:

{

`  `"segments":         [ /\* các segment đã encode base64 từ Phần 3.1 \*/ ],

`  `"translation\_mode": "segment",

`  `"source\_lang":      "en"

}

Trong đó translation\_mode quy định cách áp dụng dịch máy, source\_lang xác định ngôn ngữ nguồn để chọn pipeline ASR phù hợp.

Luồng xử lý batch diễn ra như sau:

Bên cạnh endpoint transcribe\_translate trả kết quả một lần, VM1 còn cung cấp endpoint transcribe\_translate\_stream (Server-Sent Events). Endpoint này cho phép VM đẩy kết quả của từng segment ngay khi vừa inference xong, thay vì chờ toàn bộ batch hoàn tất; backend dùng phương thức ColabClient.transcribe\_translate\_stream() để consume luồng SSE này và push tiếp về frontend, giúp người dùng thấy tiến độ mượt hơn với các video dài.

Về cơ chế độ tin cậy, ColabClient.transcribe\_translate() triển khai retry với linear backoff: tối đa 3 lần thử, các mốc chờ giữa các lần là 5 s → 10 s → 15 s (wait = 5 × (attempt + 1)). Cơ chế chỉ retry với nhóm lỗi tạm thời như SSLError, ConnectionError,…; với các lỗi HTTP non-200, payload sai thì raise ngay để fail fast. Header ngrok-skip-browser-warning: true được gắn vào mọi request để bypass màn hình cảnh báo của ngrok tunnel. Timeout đặt ở mức 600s — giá trị cao này phản ánh thực tế rằng một batch lớn nhiều segment có thể mất vài phút để inference trên GPU Colab.
1  ### <a name="_toc231502384"></a>**Realtime Mode — VM2**
1. **Kiến trúc và mô hình**

VM2 được thiết kế chuyên biệt cho xử lý streaming, sử dụng kiến trúc hoàn toàn khác VM1 để đảm bảo độ trễ thấp nhất có thể.

Kyutai stt-1b-en\_fr là mô hình ASR streaming-native với 1 tỷ tham số, được phát triển bởi nhóm Kyutai tại Pháp. Điểm đặc biệt của mô hình này là sử dụng Moshi mimi codec làm audio encoder — thay vì xử lý waveform trực tiếp, âm thanh được mã hóa thành token stream (80 ms/frame ở 24 kHz) trước khi đưa vào mô hình ngôn ngữ. Thiết kế này cho phép mô hình hoạt động với độ trễ cực thấp, đạt tốc độ nhận dạng nhanh hơn realtime.

Mô hình được nạp với precision bf16 trên GPU A100/H100 hoặc fp16 trên T4/V100, tùy loại GPU Colab cấp phát. Để giảm latency lần đầu tiên, VM2 thực hiện warmup bằng cách gửi 5 dummy frame qua mô hình khi khởi động, giúp GPU kernel được cache và sẵn sàng xử lý ngay khi có dữ liệu thực.

Với tiếng Việt trong chế độ realtime, VM2 kết hợp Silero VAD để phát hiện vùng nói trong stream và PhoWhisper để transcribe từng đoạn ngay khi VAD xác định kết thúc một đoạn nói. Cách tiếp cận này khác Kyutai ở chỗ không phải streaming-native — vẫn là batch nhỏ trên từng đoạn VAD — nhưng đủ nhanh khi đoạn đủ ngắn.

1. **Tham số khung và sample rate**

Hai pipeline EN/VI có cấu hình khung âm thanh khác nhau, do mô hình ngôn ngữ phía sau yêu cầu khác nhau:

<a name="_toc231346705"></a>*Bảng *3*.*5*: Bảng tham số khung và sample rate*

|**Pipeline**|**Sample rate**|**Frame duration**|**Samples/frame**|
| - | - | - | - |
|EN (Kyutai + Moshi)|24 kHz|80 ms|1920|
|VI (Silero VAD + PhoWhisper)|16 kHz|32 ms|512|

Lớp AudioStreamProducer thiết lập đúng cấu hình theo ngôn ngữ trước khi mở pipe FFmpeg, đảm bảo PCM stream tạo ra khớp với yêu cầu của mô hình phía VM2.

1. **Giao thức WebSocket và luồng streaming**

Backend giao tiếp với VM2 thông qua lớp RealtimeStreamClient bằng giao thức WebSocket bảo mật (WSS). Hệ thống duy trì hai endpoint riêng biệt tùy ngôn ngữ:

- wss://{COLAB\_REALTIME\_URL}/ws/transcribe\_kyutai — tiếng Anh (Kyutai)
- wss://{COLAB\_REALTIME\_URL}/ws/transcribe\_vi\_realtime — tiếng Việt (Silero VAD + PhoWhisper)

Luồng streaming hoạt động theo mô hình producer–consumer bất đồng bộ (asyncio):

Mỗi frame do AudioStreamProducer.iter\_frames() sinh ra được mã hóa base64 PCM float32 và đính kèm frame\_index tăng dần để VM xác định thứ tự. Producer còn áp dụng throttle theo deadline tuyệt đối (start\_time + (frame\_index + 1) × frame\_duration) nhằm phát frame đúng nhịp realtime, tránh dồn ứ buffer ở phía VM. Khi nguồn audio kết thúc, producer phát một sentinel {"type": "END"} để VM flush kết quả cuối cùng và đóng phiên.

Mỗi partial transcript nhận được từ VM2 được backend chuyển tiếp ngay tới frontend qua Server-Sent Events (SSE), cho phép giao diện editor hiển thị phụ đề từng phần theo thời gian thực.

Về độ tin cậy kết nối, RealtimeStreamClient triển khai auto-reconnect tối đa 3 lần với backoff [2 s, 5 s, 10 s]. Kết nối được duy trì bằng cơ chế ping/pong định kỳ 20 giây (ping\_interval=20), ping\_timeout=30, open\_timeout=30. Tương tự VM1, header ngrok-skip-browser-warning: true được gắn vào WebSocket handshake.
1  ### <a name="_toc231502385"></a>**Xử lý kết quả và tích hợp về backend**
   Dù đến từ VM1 (HTTP response / SSE) hay VM2 (WebSocket stream), kết quả ASR đều được chuẩn hóa về cùng một cấu trúc dữ liệu trước khi đưa vào các bước xử lý tiếp theo. Cấu trúc lõi được đồng nhất:

   `  `"english\_words": [

   `    `{"word": "Hello", "start": 0.24, "end": 0.56},

   `    `{"word": "world", "start": 0.60, "end": 0.92}

   `  `],

   `  `"vietnamese\_words": [

   `    `{"word": "Xin",  "start": 0.24, "end": 0.40},

   `    `{"word": "chào", "start": 0.41, "end": 0.56}

   `  `]

   Hai trường english\_words và vietnamese\_words chứa word-level data dùng cho căn chỉnh phụ đề chính xác và sinh SRT bằng hàm words\_to\_srt\_string(). Văn bản đầy đủ ở cấp câu được tổng hợp lại từ các từ này khi cần thiết để hiển thị hoặc export.

   Với chế độ batch, toàn bộ kết quả được nhận một lần sau khi VM1 xử lý xong hoặc theo từng segment qua kênh SSE nếu dùng transcribe\_translate\_stream. Với chế độ realtime, backend tích lũy các partial result vào hai danh sách english\_words và vietnamese\_words theo thời gian, đồng thời đẩy từng phần qua SSE để frontend hiển thị ngay. Khi nhận event done, backend tổng hợp kết quả cuối, gọi words\_to\_srt\_string() và lưu file SRT vào outputs/.
1  ### <a name="_toc231502386"></a>**Đánh giá chất lượng ASR**
   Chất lượng hệ thống ASR được đánh giá theo các chỉ số tiêu chuẩn trong nghiên cứu nhận dạng tiếng nói.

   Word Error Rate (WER) đo tỷ lệ lỗi ở cấp độ từ:

   trong đó S là số từ thay thế sai, D là số từ bị xóa, I là số từ chèn thừa, và N là tổng số từ trong transcript chuẩn (reference). Faster-Whisper large-v3 đạt WER khoảng 3–5 % trên dữ liệu tiếng Anh chuẩn (LibriSpeech, TED-LIUM); PhoWhisper large đạt WER khoảng 6–10 % trên tiếng Việt phổ thông, tuy nhiên WER tăng đáng kể (~15–25 %) với tiếng địa phương hoặc môi trường nhiễu cao.

   Character Error Rate tính theo công thức tương tự WER nhưng ở cấp độ ký tự, phù hợp hơn để đánh giá tiếng Việt do đặc thù dấu thanh điệu — một sai lệch nhỏ ở dấu sẽ tạo ra một lỗi WER nhưng chỉ một lỗi nhỏ ở CER, phản ánh sát hơn mức độ dễ hiểu của transcript.

   Latency là chỉ số đặc biệt quan trọng với Realtime Mode. Hệ thống mục tiêu đạt end-to-end latency thấp từ khi âm thanh được phát đến khi transcript xuất hiện trên giao diện. Kyutai stt-1b với Moshi codec được chọn chính vì kiến trúc streaming-native đáp ứng yêu cầu này.

   Real-Time Factor — tỷ số giữa thời gian inference và thời lượng audio đầu vào — bổ sung góc nhìn về hiệu năng tổng thể: RTF < 1 nghĩa là mô hình xử lý nhanh hơn realtime. Faster-Whisper large-v3 trên GPU T4 đạt RTF ~0.1; Kyutai stt-1b đạt RTF ~0.3–0.5 ở chế độ streaming.

   Các trường hợp khó xử lý được nhận diện gồm: (i) tiếng địa phương Nam Bộ / Bắc Bộ với phụ âm cuối khác chuẩn; (ii) nói nhanh liên tục không nghỉ; (iii) môi trường có nhạc nền lớn lấn át giọng; (iv) nhiều người nói chồng nhau (speaker overlap). Đây là những hạn chế được thừa nhận của hệ thống và sẽ được phân tích sâu hơn trong phần tổng kết chương.
1  ## <a name="_toc231502387"></a>Nghiệp vụ xử lý ngôn ngữ tự nhiên
   1  ### <a name="_toc231502388"></a>**Tổng quan và mục tiêu**
      Sau khi phân hệ ASR trả về danh sách các từ kèm dấu thời gian (words + timestamps), hệ thống cần thực hiện một chuỗi biến đổi ngôn ngữ để chuyển đổi dữ liệu thô này thành các khối phụ đề (subtitle blocks) hoàn chỉnh — có thể đọc được, đồng bộ với video, và sẵn sàng hiển thị trên giao diện hoặc xuất ra tệp SRT. Đây là nhiệm vụ của phân hệ xử lý ngôn ngữ tự nhiên (NLP).

      Khác với các phân hệ trước chủ yếu xử lý tín hiệu âm thanh, phân hệ NLP làm việc hoàn toàn ở tầng văn bản và thời gian. Mục tiêu cụ thể gồm:

      - Phục hồi dấu câu cơ bản cho văn bản thô từ ASR.
      - Nhóm các từ rời rạc thành các dòng phụ đề có độ dài hợp lý.
      - Căn chỉnh thời gian chính xác cho từng khối phụ đề.
      - Hỗ trợ dịch máy EN→VI khi cần.
      - Tối ưu hóa hiển thị theo chuẩn truyền hình/Netflix
- CPS, CPL, gap, duration.
  - Cung cấp dữ liệu có cấu trúc cho giao diện editor để người dùng có
- thể chỉnh sửa thủ công.

Điểm đáng lưu ý trong thiết kế hệ thống là phân hệ NLP được phân tán giữa backend và frontend: backend chịu trách nhiệm tối ưu hóa post-processing và export SRT, còn frontend đảm nhận việc xây dựng subtitle blocks cho editor và caption overlay. Phân chia này giúp giao diện phản hồi nhanh mà không cần round-trip về server mỗi khi người dùng chỉnh sửa, đồng thời tận dụng được năng lực tính toán nhẹ ở phía client cho các tác vụ thuần biểu diễn.
1  ### <a name="_toc231502389"></a>**Phục hồi dấu câu**
   Các mô hình ASR như Faster-Whisper và PhoWhisper thường trả về văn bản đã có dấu câu cơ bản nhờ được huấn luyện trên dữ liệu có định dạng. Tuy nhiên, trong nhiều trường hợp — đặc biệt với các đoạn nói nhanh, giọng địa phương, hoặc audio chất lượng thấp — transcript trả về có thể thiếu dấu câu hoặc viết hoa không nhất quán.

   Hệ thống xử lý vấn đề này bằng việc triển khai trên Colab VM, áp dụng hai quy tắc cơ bản theo thứ tự:

- Input:  "xin chào tôi là nam" 
- Bước 1: Viết hoa chữ cái đầu → "Xin chào tôi là nam" 
- Bước 2: Thêm dấu chấm cuối → "Xin chào tôi là nam." Output: "Xin chào tôi là nam."

Hàm này được gọi ngay sau khi ASR trả về words và trước khi thực hiện dịch máy hoặc căn chỉnh từ. Đây là cách tiếp cận rule-based tối giản — hệ thống không triển khai mô hình punctuation restoration chuyên dụng do ưu tiên tốc độ và sự đơn giản trong giai đoạn hiện tại. Hạn chế này được thừa nhận là một trong những hướng cải thiện trong tương lai.
1  ### <a name="_toc231502390"></a>**Dịch máy EN→VI** 
   Khi người dùng yêu cầu phụ đề tiếng Việt từ nguồn video tiếng Anh, hệ thống gọi mô hình VinAI vinai-translate-en2vi-v2 trên Colab VM. Dịch máy được thực hiện ở cấp độ segment text sau khi đã gom words thành câu, không phải ở cấp từ đơn lẻ — điều này đảm bảo mô hình có đủ ngữ cảnh để dịch chính xác các cấu trúc ngữ pháp phức tạp.

   Mô hình vinai-translate-en2vi-v2 thuộc họ kiến trúc mBART, được VinAI fine-tune đặc biệt cho cặp ngôn ngữ Anh–Việt. So với các giải pháp dịch máy đa ngôn ngữ tổng quát như NLLB hay M2M-100, mô hình này cho chất lượng dịch tốt hơn đáng kể trên các chủ đề thông dụng nhờ tập huấn luyện chuyên biệt cho tiếng Việt.

   Tham số translation\_mode trong payload gửi tới VM1 quyết định cấp độ dịch theo từng segment hoặc theo từng câu sau khi gộp, còn source\_lang xác định ngôn ngữ nguồn. Kết quả dịch được gắn vào cấu trúc response song song với bản gốc tiếng Anh, cho phép hệ thống cung cấp đồng thời cả hai phiên bản mà không cần gọi thêm request:

   { "english\_words": [ {"word": "Good", "start": 0.10, "end": 0.30}, {"word": "morning", "start": 0.31,"end": 0.65}, {"word": "everyone", "start": 0.66, "end": 1.10} ], "vietnamese\_words": [ {"word": "Chào", "start": 0.10, "end": 0.40}, {"word": "buổi", "start": 0.41, "end": 0.62}, {"word": "sáng", "start": 0.63, "end": 0.85}, {"word": "mọi",  "start": 0.86, "end": 1.00}, {"word": "người","start": 1.01, "end": 1.10} ] }

   Word-level timestamp của bản dịch tiếng Việt được phân bổ theo tỷ lệ độ dài giữa các từ tiếng Việt sao cho tổng khoảng thời gian khớp với đoạn tiếng Anh tương ứng — đây là phép xấp xỉ vì tiếng Việt và tiếng Anh không có ánh xạ 1-1 giữa các từ.
1  ### <a name="_toc231502391"></a>**Căn chỉnh từ và tạo khối phụ đề**
   Đây là bước cốt lõi của phân hệ NLP: chuyển đổi danh sách từ rời rạc có timestamp thành các khối phụ đề có thời gian bắt đầu–kết thúc xác định. Hệ thống thực hiện bước này ở hai nơi với hai mục đích khác nhau nhằm đáp ứng các yêu cầu hiển thị khác nhau.

1. **Phía backend**

Thực hiện gom từ theo thuật toán greedy đơn giản: duyệt tuần tự danh sách words, tích lũy từ vào block hiện tại cho đến khi tổng số ký tự (cộng dồn len(word) + 1 cho mỗi từ kể cả khoảng trắng) vượt ngưỡng max\_chars = 42. Khi đó, đóng block hiện tại và bắt đầu block mới với từ vừa vượt ngưỡng. Thời gian bắt đầu của block là start của từ đầu tiên, thời gian kết thúc là start của từ kế tiếp đối với block không phải cuối hoặc end của từ cuối đối với block cuối.

words = [ {word:"Xin", start:0.24, end:0.40},{word:"chào", start:0.41, end:0.60}, {word: "mọi", start:0.62, end:0.78}, {word: "người", start:0.80, end:1.10} ] max\_chars = 42

→ Block 1: "Xin chào mọi người" start=0.24, end=1.10

Kết quả được định dạng trực tiếp thành chuỗi SRT chuẩn gồm số thứ tự + timecode HH:MM:SS,mmm + nội dung + dòng trống, lưu vào thư mục outputs/ trên server.

1. **Phía frontend**

Áp dụng logic đối xứng hoàn toàn với hàm backend ở trên với cùng ngưỡng maxChars = 42, cùng quy tắc tính endTime = start của từ kế tiếp, đảm bảo SRT xuất ra và phụ đề hiển thị trên editor là đồng nhất. Đầu ra là mảng SubtitleItem với cấu trúc:

interface SubtitleItem { id: string; // "sub\_0", "sub\_1",... startTime: number; endTime: number; text: string; selected:  boolean; // mặc định false }

Cách tính endTime theo start của từ kế tiếp thay vì end của từ cuối block)là một lựa chọn thiết kế có chủ đích: nó tạo ra sự liền mạch giữa các subtitle block, tránh khoảng trống không cần thiết khi hai block tiếp giáp nhau trong lời thoại liên tục. Nếu dùng end của từ cuối, người xem sẽ thấy phụ đề biến mất rồi lại xuất hiện sau vài chục mili-giây — gây cảm giác giật.

Lớp adapter map sang shape Subtitle của UI bằng cách thêm các trường phục vụ editor như trạng thái đang chỉnh sửa, thứ tự hiển thị. Sau bước này, người dùng có thể click chọn, sửa text, kéo thả mốc thời gian trực tiếp trên timeline.

1. **Phía frontend**

Ngoài editor, hệ thống còn hỗ trợ chế độ hiển thị caption kiểu YouTube — dạng overlay ngắn, đổi liên tục theo nhịp nói. Đây là thuật toán nhóm từ phức tạp hơn, kết hợp đồng thời nhiều ràng buộc:

<a name="_toc231346706"></a>*Bảng *3*.*6*: Bảng ràng buộc và mục đích*

|**Ràng buộc**|**Mục đích**|
| - | - |
|duration min/max|Caption không quá nhanh hoặc quá chậm|
|Số từ min/max|Tránh caption quá ít hoặc quá nhiều từ|
|Pause threshold|Ngắt tự nhiên tại khoảng lặng giữa các từ|
|Dấu câu / word boundary|Ưu tiên ngắt tại cuối câu, tránh cắt giữa cụm từ|
|lineBreakIndex|Chia caption thành 2 dòng tại điểm tự nhiên nhất|

Mục tiêu là tạo ra trải nghiệm đọc tự nhiên: caption ngắn, thay đổi đúng nhịp phát âm, không cắt câu ở giữa cụm từ có nghĩa, khai thác cả khoảng cách thời gian giữa các từ để phát hiện chỗ nghỉ tự nhiên trong lời nói — yếu tố mà max\_chars không nắm bắt được.
1  ### <a name="_toc231502392"></a>**Post-processing SRT**
   Sau khi tạo ra SRT sơ bộ, hệ thống áp dụng một bước tối ưu hóa bổ sung bằng cách điều chỉnh các tham số kỹ thuật của phụ đề để đáp ứng tiêu chuẩn đọc hiểu của ngành truyền hình và streaming như Netflix, BBC.

1. **Hằng số chuẩn**

Mô-đun định nghĩa các hằng số chuẩn theo tài liệu Netflix Timed Text Style Guide.

<a name="_toc231346707"></a>*Bảng *3*.*7*: Bảng hẳng số chuẩn*

|**Hằng số**|**Giá trị**|**Vai trò**|
| - | - | - |
|MAX\_CPS|17\.0 ký tự/s|Tốc độ đọc tối đa cho người trưởng thành|
|MAX\_CPL\_VI|47 ký tự/dòng|Phù hợp với khoảng cách đọc TV/máy tính|
|MAX\_LINES|2 dòng|Tránh che khuất khung hình|
|MIN\_DURATION|1\.0 s|Đủ thời gian cho một liếc nhìn|
|MAX\_DURATION|7\.0 s|Tránh phụ đề "đứng" quá lâu|
|MIN\_GAP|0\.083 s|≈ 2 frame ở 24 fps — vừa đủ để mắt ghi nhận thay đổi|

1. **Pipeline 4 bước**

Chạy một vòng lặp tối đa 3 lần gồm bốn bước theo thứ tự cố định:

Mỗi bước trong ba bước đầu trả về một cờ changed. Khi cả ba cờ đều False, vòng lặp dừng (đạt hội tụ). fix\_gap luôn chạy ở cuối mỗi vòng nhưng không tham gia kiểm tra hội tụ, vì nó có thể làm tăng CPS của block trước (do co ngắn duration) — vi phạm này sẽ được fix\_cps ở vòng sau bắt lại.

1. **Chi tiết từng bước**
- fix\_duration: Block có duration > MAX\_DURATION được tách bằng split\_block() đệ quy. Hàm find\_best\_split() tìm điểm cắt theo thứ tự ưu tiên: (1) dấu câu kết thúc câu (., ?, !, ;, ,, —) gần điểm giữa nhất; (2) khoảng trắng gần điểm giữa nếu không có dấu câu. Block có duration < MIN\_DURATION được kéo dài đến start + MIN\_DURATION, hoặc gộp vào block kế nếu việc kéo dài làm chồng lấn.
- fix\_cpl: Sử dụng hàm wrap\_text() áp dụng thuật toán top-heavy split — ưu tiên phân chia sao cho dòng 1 dài hơn hoặc bằng dòng 2 (line1 ≥ line2). Đây là quy ước phổ biến trong phụ đề chuyên nghiệp giúp mắt người đọc dễ theo dõi khi phụ đề nằm ở đáy màn hình. Nếu văn bản không vừa trong MAX\_LINES × MAX\_CPL\_VI (≤ 94 ký tự), block được tách thành nhiều block với duration phân bổ theo tỷ lệ ký tự.
- fix\_cps: Block có CPS > 17 được xử lý theo hai chiến lược
- Chiến lược A — Extend: kéo dài end của block đến mức tối thiểu cần để đạt CPS = MAX\_CPS, miễn là không xâm phạm vào block kế (cần giữ MIN\_GAP) và không vượt MAX\_DURATION.
- Chiến lược B — Split theo tỷ lệ ký tự: nếu Strategy A không khả thi, tách block bằng \_split\_block\_by\_chars(), phân bổ thời gian theo tỷ lệ độ dài hai phần text.
- Trong trường hợp deadlock (split tạo ra block ngắn hơn MIN\_DURATION), hệ thống chấp nhận vi phạm CPS và ghi log cảnh báo thay vì lặp vô hạn — đây là cơ chế đảm bảo thuật toán luôn kết thúc.
- fix\_gap: Đảm bảo khoảng cách giữa hai block liên tiếp ≥ MIN\_GAP = 0.083 s. Nếu gap quá nhỏ, hệ thống co ngắn end của block trước; nếu việc co ngắn làm prev vi phạm MIN\_DURATION, hai block được gộp thành một với text nối bằng dấu cách, sau đó wrap lại theo CPL.
1. **Đầu ra**

Cung cấp thống kê trước/sau tối ưu với số block, số vi phạm CPS/CPL, CPS trung bình — phục vụ giám sát chất lượng và A/B test các tham số khi cần.
1  ### <a name="_toc231502393"></a>**Tích hợp với giao diện Editor**
   Toàn bộ pipeline NLP được thiết kế để dữ liệu đầu ra có thể chỉnh sửa trực tiếp bởi người dùng trên giao diện editor. Cấu trúc Subtitle UI tạo ra cho phép:

- Chỉnh sửa nội dung text trực tiếp trên từng block.
- Kéo thả mốc startTime/endTime trên timeline.
- Tách hoặc gộp các subtitle block thủ công.
- Xem trước realtime trên video player khi chỉnh sửa.

Hệ thống giữ nguyên các chỉnh sửa thủ công của người dùng khi nhận thêm dữ liệu mới từ backend ví dụ trong realtime mode, partial result đến liên tục. Logic merge ưu tiên giữ phiên bản đã chỉnh tay, chỉ thêm các block mới ở phần chưa được chỉnh — đảm bảo công sức chỉnh sửa của người dùng không bị ghi đè.

Khi người dùng hoàn tất chỉnh sửa, frontend gửi lại danh sách Subtitle[] đã chỉnh về backend để export thành tệp SRT hoặc burn-in vào video qua Ffmpeg nhằm đảm bảo kết quả cuối cùng phản ánh chính xác những điều chỉnh của người dùng, không bị ghi đè bởi kết quả tự động.
1  ### <a name="_toc231502394"></a>**Đo lường và kiểm thử chất lượng NLP**
   Chất lượng phân hệ NLP được đánh giá theo ba hướng.

   Chất lượng dịch máy sử dụng chỉ số BLEU (Bilingual Evaluation Understudy) để đo mức độ tương đồng giữa bản dịch tự động và bản dịch tham chiếu của con người:

   Chất lượng tối ưu hóa hiển thị được đo bằng số liệu thống kê: số vi phạm CPS, CPL trước và sau khi chạy pipeline; CPS trung bình; số block tăng/giảm. Các con số này là khách quan, đo được tự động, phù hợp cho regression test.

   Chất lượng phân đoạn và căn chỉnh được đánh giá thủ công thông qua các tiêu chí: subtitle block có ngắt đúng ranh giới câu không; CPS có nằm trong ngưỡng đọc hiểu (≤ 17 ký tự/giây) không; người xem có cảm thấy phụ đề đồng bộ với lời thoại không. Đây là dạng đánh giá chủ quan nhưng phản ánh trực tiếp trải nghiệm người dùng cuối — yếu tố mà các chỉ số định lượng không nắm bắt được trọn vẹn.
1  ## <a name="_toc231502395"></a>Thuật toán phân đoạn phụ đề
   1  ### <a name="_toc231502396"></a>**Mục tiêu và bài toán đặt ra**
      Phân đoạn phụ đề là bài toán xác định ranh giới thời gian và ranh giới nội dung của từng khối phụ đề sao cho thỏa mãn đồng thời hai nhóm yêu cầu đối lập nhau:

- Yêu cầu kỹ thuật: đồng bộ chính xác với audio, không overlap, không vượt giới hạn của mô hình ASR.
- Yêu cầu trải nghiệm người dùng: đủ thời gian đọc, không cắt giữa cụm từ có nghĩa, không quá dài hay quá ngắn.

Thách thức cốt lõi xuất phát từ đặc thù của đầu vào: VAD trả về các đoạn âm thanh thô dựa thuần túy trên tín hiệu giọng nói, hoàn toàn không quan tâm đến ngữ nghĩa hay khả năng đọc hiểu. Một diễn giả nói liên tục 40 giây không ngừng nghỉ sẽ tạo ra một segment VAD duy nhất — quá dài để làm phụ đề và vượt context của Whisper. Ngược lại, các từ cảm thán ngắn như "Ừ", "Vâng", "OK" tạo ra các segment riêng lẻ quá ngắn — không đủ ngữ cảnh cho ASR và không đáp ứng thời lượng hiển thị tối thiểu của phụ đề. Thuật toán phân đoạn phải giải quyết cả hai cực đoan này trước khi đưa dữ liệu vào ASR và sau khi nhận transcript để tạo phụ đề cuối cùng.
1  ### <a name="_toc231502397"></a>**Tổng quan pipeline phân đoạn**
   Toàn bộ quá trình phân đoạn phụ đề diễn ra theo một pipeline tuyến tính gồm sáu bước, được phối hợp giữa backend, Colab VM:

   Thiết kế đáng chú ý là thứ tự `split` trước `merge`: bước split đảm bảo không còn segment nào vượt 25 giây; sau đó merge gộp các đoạn ngắn nhưng vẫn tôn trọng ngưỡng 25 giây để không phá vỡ bất biến mà bước split đã thiết lập. Kết quả là mọi segment đầu ra đều thỏa *2.0* ≤ duration ≤ *25.0* giây.
1  ### <a name="_toc231502398"></a>**Bước 1 — Phát hiện đoạn nói bằng Silero VAD**
   Đầu ra của bước này là danh sách các segment thô dạng [{start: float, end: float}, ...] tính bằng giây, phản ánh các khoảng thời gian mà Silero VAD xác định có chứa tiếng nói với xác suất vượt ngưỡng threshold = 0.5.

   Ở giai đoạn này, các segment chưa trải qua bất kỳ ràng buộc nào về thời lượng hay ngữ nghĩa. Chất lượng của danh sách segment thô phụ thuộc trực tiếp vào chất lượng audio đầu vào — môi trường nhiều nhiễu hoặc nhạc nền mạnh có thể khiến VAD bỏ sót đoạn nói hoặc phân mảnh sai, false positive trên nhạc có giọng người.
1  ### <a name="_toc231502399"></a>**Bước 2 — Tách đoạn quá dài**
   Một segment duy nhất ở mỗi lần gọi, pipeline duyệt danh sách và gọi hàm cho từng phần tử. Ngưỡng 25 giây được chọn dựa trên giới hạn context hiệu quả của mô hình Whisper (cửa sổ 30 giây) và thực nghiệm về chất lượng transcript — các đoạn quá dài tăng nguy cơ mô hình bị lẫn lộn ngữ cảnh hoặc timeout.

   Cần lưu ý rằng đây là phân chia thuần túy theo thời gian — điểm cắt không nhất thiết trùng với ranh giới từ hay câu. Hệ quả là một từ hoặc cụm từ có thể bị cắt đôi giữa hai chunk liền kề. Tuy nhiên, điều này được chấp nhận ở bước này vì mục tiêu là kiểm soát kích thước batch gửi lên ASR, không phải tạo phụ đề ngay. Các mô hình Whisper có khả năng xử lý audio bị cắt tại điểm không tự nhiên và vẫn cho transcript hợp lý nhờ context window nội bộ; những sai sót ở biên chunk sẽ được bước 6 khôi phục thông.
1  ### <a name="_toc231502400"></a>**Bước 3 — Gộp đoạn quá ngắn**
   Loại bỏ các segment quá ngắn bằng cách tích lũy chúng vào một buffer chung cho đến khi đạt min\_duration. Khác với cách "extend last" đơn giản, thuật toán thực tế dùng buffer-based approach để đảm bảo đồng thời hai bất biến — không có segment nào < 2 giây trừ và không có segment nào > 25 giây.

   Thuật toán có ba nhánh quyết định mỗi vòng lặp:

- Buffer rỗng → khởi tạo buffer bằng segment hiện tại.
- Buffer đã có, gộp tiếp sẽ vượt 25s → đóng buffer, bắt đầu buffer mới.
- Buffer đã có, gộp được → mở rộng buffer.end đến seg.end.

Sau mỗi cập nhật buffer, kiểm tra ngay buffer.duration ≥ 2.0s; nếu đạt thì flush buffer ra merged và reset về null. Điều này đảm bảo không gộp dư thừa — buffer chỉ tích lũy đến khi vừa đủ rồi dừng.

Ví dụ minh họa với cả nhánh merge và nhánh split-do-vượt-max.

Input — chuỗi segment giả lập:

<a name="_toc231346708"></a>*Bảng *3*.*8*: Bảng ví dụ minh họa chuỗi segment*

|#|start|end|duration|
| - | - | - | - |
|1|0\.0|1\.2|1\.2s (ngắn)|
|2|1\.5|4\.8|3\.3s|
|3|5\.0|5\.6|0\.6s (ngắn)|
|4|5\.8|9\.3|3\.5s|

Mô phỏng từng vòng:

Lưu ý rằng ví dụ này cho ra cùng kết quả với một thuật toán "extend last" đơn giản hơn, nhưng ưu thế của buffer-based thể hiện rõ khi chuỗi có nhiều segment ngắn liên tiếp tổng cộng vượt 25 giây — lúc đó ràng buộc max\_duration ngăn buffer phình quá ngưỡng và tự động cắt mới.
1  ### ` `**<a name="_toc231502401"></a>Bước 4 — Encode và truyền tải**
   Sau khi danh sách segment đã qua split và merge, thực hiện hai việc: (1) cắt PCM float32 tương ứng từ tensor sóng âm gốc cho từng segment, và (2) mã hóa base64 để đóng gói vào JSON payload. Chi tiết kỹ thuật của bước này là cấu trúc payload, overhead 33 % của base64, lý do dùng raw PCM thay vì WAV bytes.
1  ### <a name="_toc231502402"></a>**Bước 5 — Tạo SRT thô**
   Sau khi nhận words[] kèm word-level timestamps từ mô hình tự động nhận dạng tiếng nói, các từ được gom thành các khối SRT theo thuật toán greedy với max\_chars = 42. Thuật toán duyệt tuần tự danh sách từ, tích lũy vào block hiện tại cho đến khi tổng số ký tự vượt ngưỡng, sau đó đóng block và bắt đầu block mới với từ vừa vượt ngưỡng. Kết quả là một chuỗi SRT thô chuẩn định dạng nhưng chưa được tối ưu hóa về các chỉ số hiển thị CPS, CPL, gap.
1  ### <a name="_toc231502403"></a>**Bước 6 — Tối ưu hóa phụ đề**
   Đây là bước tinh chỉnh cuối cùng, biến SRT thô thành phụ đề đạt tiêu chuẩn hiển thị chuyên nghiệp áp dụng hệ thống các ràng buộc được cấu hình cố định bằng hằng số tại đầu file:

   <a name="_toc231346709"></a>*Bảng *3*.*9*: Bảng tối ưu hóa phụ đề*

   |**Hằng số**|**Giá trị**|**Tiêu chuẩn áp dụng**|
   | - | - | - |
   |MAX\_CPS|17\.0 ký tự/giây|Tốc độ đọc tối đa của người xem|
   |MAX\_CPL\_VI|47 ký tự/dòng|Giới hạn chiều rộng hiển thị tiếng Việt|
   |MAX\_LINES|2 dòng|Tối đa 2 dòng phụ đề trên màn hình|
   |MIN\_DURATION|1\.0 giây|Thời lượng hiển thị tối thiểu|
   |MAX\_DURATION|7\.0 giây|Thời lượng hiển thị tối đa|
   |MIN\_GAP|0\.083 giây|≈ 2 frames @ 24 fps|

   Việc tối ưu hóa thực tế là một pipeline 4 bước lặp đến hội tụ. Cấu trúc lặp này cần thiết vì các bước tương tác với nhau: ví dụ fix\_gap rút ngắn prev.end để tạo gap đủ — hành động này có thể làm tăng CPS của prev vượt ngưỡng, vi phạm sẽ được fix\_cps ở vòng tiếp theo bắt lại.

   Bốn bước con và chiến lược của chúng:

- fix\_duration — Block > 7s ưu tiên dấu câu, fallback whitespace gần điểm giữa. Block < 1s kéo dài đến start + 1.0, hoặc gộp với block sau nếu kéo dài sẽ overlap.
- fix\_cpl — Wrap text theo top-heavy split dòng 1 ≥ dòng 2. Nếu không vừa trong 2 dòng × 47 ký tự, tách thành nhiều block với duration phân bổ theo tỷ lệ ký tự.
- fix\_cps — Hai chiến lược: (A) extend end nếu còn gap, (B) tách block theo tỷ lệ ký tự nếu A không khả thi. Có deadlock guard: chấp nhận vi phạm và log cảnh báo nếu split tạo block < 1s, để thuật toán luôn kết thúc.
- fix\_gap — Co prev.end để gap ≥ 83 ms; nếu co làm prev.duration < 1s thì gộp prev với curr thành một block.
  1  ### <a name="_toc231502404"></a>**Xử lý các Edge Cases**
- **Không phát hiện tiếng nói:** Khi detect\_speech\_segments() trả về danh sách rỗng, thì báo RuntimeError("No speech detected in the video."). Controller bắt ngoại lệ này và đánh dấu job ở trạng thái FAILED, kèm thông điệp người dùng. Trường hợp này thường gặp với video thuần nhạc, video hỏng, hoặc audio bị mất tiếng hoàn toàn. Hướng phát triển tương lai: thêm cơ chế fallback tạo segment phủ toàn bộ thời lượng để tận dụng VAD bỏ sót giọng có âm lượng rất nhỏ.
- **Segment cuối ngắn không gộp được:** Khi buffer cuối cùng trong merge\_short\_segments chưa đạt min\_duration mà vòng lặp đã kết thúc không còn segment để gộp tiếp, thuật toán vẫn flush buffer đó ra như cũ — tức là chấp nhận một segment cuối ngắn hơn 2 giây. Điều này tránh việc gây phá vỡ tính tuần tự.
- **Overlap giữa các block sau tối ưu:** Khi fix\_cps hoặc fix\_duration kéo dài end của block *i* để đáp ứng ràng buộc, nó có thể tiến sát vào start của block *i+1*. Trường hợp này được kiểm soát ngay trong từng hàm: fix\_cps chỉ extend nếu *target\_end* ≤ *next\_start* - *MIN\_GAP*; nếu không thỏa thì chuyển sang chiến lược split. Sau đó fix\_gap chạy ở cuối mỗi vòng để dọn dẹp các gap còn lại.
- **Tiếng nói chồng nhau:** Hệ thống hiện tại không thực hiện speaker diarization, do đó khi có hai người nói đồng thời, VAD chỉ trả về một segment duy nhất và transcript sẽ trộn lẫn hai luồng nội dung. Đây là hạn chế được thừa nhận; tích hợp pyannote.audio hoặc whisperX để phân biệt người nói là hướng phát triển khả dĩ.
- **Nhạc nền cường độ cao**: Silero VAD với threshold = 0.5 có thể nhận nhầm nhạc nền có âm vực giọng người là tiếng nói, tạo ra các segment giả. Các segment này thường ngắn và không nhất quán — sẽ bị gom lại qua merge\_short\_segments hoặc tạo ra transcript nhiễu mà subtitle\_optimizer xử lý tiếp ở bước cuối.
  1  ## <a name="_toc231502405"></a>Tổng kết chương 3
     1  ### <a name="_toc231502406"></a>**Tóm tắt các thành phần đã triển khai**
        Chương 3 đã trình bày toàn bộ thiết kế nghiệp vụ và thuật toán của hệ thống tạo phụ đề tự động, bao gồm năm phân hệ phối hợp chặt chẽ với nhau theo một pipeline xử lý liên tục từ đầu vào là tệp video thô đến đầu ra là tệp SRT hoàn chỉnh.

        Phân hệ xử lý video và âm thanh  đảm nhận vai trò tiền xử lý toàn bộ: trích xuất audio bằng FFmpeg, chuẩn hóa về định dạng WAV 16 kHz mono, phát hiện vùng có tiếng nói bằng Silero VAD với bộ tham số được tinh chỉnh thực nghiệm, và mã hóa base64 PCM float32 để truyền tải an toàn sang môi trường GPU từ xa. Trong batch mode, phân hệ này chạy hoàn toàn trên backend cục bộ, không phụ thuộc vào kết nối Colab; trong realtime mode, một phần xử lý VAD, được đẩy lên VM2 để giảm độ trễ tổng thể.

        Phân hệ nhận dạng tiếng nói triển khai theo mô hình hai VM chuyên biệt: VM1 phục vụ batch mode với Faster-Whisper large-v3 cho tiếng Anh và PhoWhisper large cho tiếng Việt cùng mô hình dịch VinAI EN→VI; VM2 phục vụ realtime mode với Kyutai stt-1b kết hợp Moshi mimi codec để đạt latency dưới ngưỡng nhận thức của người dùng. Hai giao thức HTTP POST kèm SSE cho streaming và WebSocket được sử dụng tương ứng với từng chế độ, kèm theo cơ chế retry tuyến tính (5 / 10 / 15 s) cho VM1 và auto-reconnect (2 / 5 / 10 s) cho VM2 đảm bảo độ tin cậy.

        Phân hệ xử lý ngôn ngữ tự nhiên chuyển đổi words có timestamp thành subtitle blocks có thể đọc được, thực hiện phục hồi dấu câu cơ bản, dịch máy EN→VI, và cung cấp hai luồng dữ liệu song song: luồng backend cho export SRT và luồng frontend cho editor tương tác cùng caption overlay kiểu YouTube. Mô-đun subtitle\_optimizer áp dụng pipeline 4 bước lặp đến hội tụ: fix\_duration → fix\_cpl → fix\_cps → fix\_gap để chuẩn hóa phụ đề theo tiêu chuẩn truyền hình/Netflix.

        Thuật toán phân đoạn phụ đề là đóng góp kỹ thuật trung tâm của hệ thống, vận hành theo pipeline sáu bước:

        Pipeline này giải quyết bài toán cân bằng giữa yêu cầu kỹ thuật của mô hình tự động nhận dạng tiếng nói: kích thước batch, context window và yêu cầu trải nghiệm của người xem phụ đề như CPS, CPL, gap, duration, với các bất biến thiết kế rõ ràng: 2.0 ≤ duration ≤ 25.0 giây ở tầng segment và pipeline 4 bước hội tụ ở tầng subtitle block.
     1  ### <a name="_toc231502407"></a>**Đóng góp kỹ thuật**
        Nhìn lại toàn bộ chương 3, hệ thống có ba đóng góp kỹ thuật chính:

        Thứ nhất, kiến trúc pipeline phân tán linh hoạt giữa backend cục bộ và GPU VM từ xa. Thay vì phụ thuộc hoàn toàn vào một môi trường duy nhất, hệ thống phân chia hợp lý: các tác vụ nhẹ FFmpeg, VAD ở batch mode, encode, post-processing SRT chạy trên backend để đảm bảo ổn định; các tác vụ nặng được đẩy ra VM có GPU. Thiết kế này cho phép thay thế hoặc nâng cấp từng thành phần độc lập mà không ảnh hưởng toàn hệ thống — ví dụ thay Faster-Whisper bằng Whisper-v4 chỉ cần cập nhật code trên VM1 mà không phải build lại backend.

        Thứ hai, cơ chế hỗ trợ song song cả batch mode lẫn realtime mode trong cùng một hệ thống. Hai chế độ sử dụng mô hình tự động nhận dạng tiếng nói khác nhau, giao thức khác nhau (HTTP/SSE vs WSS), sample rate khác nhau (16 kHz/32 ms vs 24 kHz/80 ms), và kiến trúc VM khác nhau, nhưng chia sẻ chung tầng tiếp nhận đầu vào (controller, job state machine), tầng NLP post-processing (words\_to\_srt, subtitle\_optimizer), và tầng giao diện editor (wordsToSubtitles, mergeMappedWithDraft). Sự tách biệt này cho phép tối ưu hóa từng chế độ độc lập mà không tạo ra xung đột.

        Thứ ba, bộ ràng buộc tối ưu hóa phụ đề được định lượng rõ ràng trong subtitle\_optimizer.py với các hằng số có cơ sở kỹ thuật: MAX\_CPS = 17.0 dựa trên Netflix Timed Text Style Guide; MIN\_GAP = 0.083 s tương đương 2 frame ở 24 fps — đủ để mắt người ghi nhận thay đổi; MAX\_CPL\_VI = 47 phù hợp với đặc thù ký tự tiếng Việt có dấu (chiếm thêm chiều ngang). Các bước fix\_\* không chỉ kiểm tra mà còn có chiến lược fallback và deadlock guard đảm bảo thuật toán luôn kết thúc — đây là chi tiết kỹ thuật quan trọng cho một hệ thống production.
     1  ### <a name="_toc231502408"></a>**Hạn chế**
        Bên cạnh những kết quả đạt được, hệ thống vẫn còn một số hạn chế cần được nhìn nhận. Trước hết, thời gian xử lý ở chế độ batch còn phụ thuộc nhiều vào Colab VM, trong khi đây là môi trường chia sẻ tài nguyên và không đảm bảo tính ổn định lâu dài. Khi GPU được cấp phát yếu hoặc phiên làm việc bị ngắt, quá trình tạo phụ đề có thể chậm hơn hoặc thất bại.

        Về chất lượng nhận dạng giọng nói, hệ thống cho kết quả tốt với tiếng Việt phổ thông và tiếng Anh rõ ràng, nhưng độ chính xác có thể giảm trong các trường hợp có phương ngữ, tiếng lóng, giọng không bản ngữ hoặc âm thanh kém chất lượng. Ngoài ra, việc phân đoạn âm thanh bằng Silero VAD vẫn có thể sai lệch khi video có nhạc nền, tiếng ồn, tiếng vỗ tay hoặc nhiều người nói cùng lúc.

        Hệ thống hiện cũng chưa hỗ trợ nhận diện người nói, do đó chưa phù hợp với các nội dung có nhiều nhân vật như phỏng vấn, podcast hoặc tranh luận. Bên cạnh đó, cơ chế khôi phục dấu câu còn đơn giản, chủ yếu xử lý viết hoa và thêm dấu chấm cuối câu, nên chưa xử lý tốt câu hỏi, câu cảm thán hoặc câu phức.

        Cuối cùng, việc sử dụng ngrok để kết nối Colab VM phù hợp cho môi trường demo và thử nghiệm, nhưng chưa phù hợp với triển khai thực tế do URL thay đổi theo phiên, băng thông hạn chế và không đảm bảo thời gian hoạt động ổn định.
