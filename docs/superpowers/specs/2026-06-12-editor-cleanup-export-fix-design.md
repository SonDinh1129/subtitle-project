# Editor Cleanup + Export/Download Theo Chế Độ Sub — Design

**Date:** 2026-06-12
**Branch:** kyutai-model
**Scope:** Trang Editor (`src/app/pages/EditorPage.tsx`), API client (`src/lib/api.ts`), backend export (`controllers/subtitle_controller.py`, `models/subtitle_model.py`)

## Mục tiêu

Ba thay đổi do người dùng yêu cầu:

1. **Bỏ tab Translate & Settings** ở panel phải của Editor — cả hai đều là UI giả lập, không kết nối backend.
2. **Sửa lỗi Export Video** — khi user edit sub xong export thì gặp lỗi "không tìm thấy tệp trên mạng"; ngoài ra video xuất ra không phản ánh nội dung đã chỉnh.
3. **Download SRT & Export Video theo đúng chế độ sub đang chọn** — chọn VN / EN / Dual thì file SRT và video burn phải đúng chế độ đó.

## Bối cảnh hiện tại

- Sub edit chỉ lưu trong `sessionStorage` (`handleSave` → `draftKey`). Backend hoàn toàn không biết các chỉnh sửa này.
- `export_burned_video` (subtitle_model.py:738) luôn đọc file SRT **gốc** trên đĩa `outputs/{job_id}_{lang}.srt`. Nếu file mất (server restart, môi trường khác) → `FileNotFoundError("Subtitle file not found")` → đây chính là lỗi "không tìm thấy tệp". Và kể cả khi file còn, nó là bản gốc, không có chỉnh sửa của user.
- `handleDownloadSRT` (EditorPage.tsx:915) chỉ build từ `subtitles` (1 ngôn ngữ active), không hỗ trợ Dual.
- `/export` chỉ nhận `lang ∈ {en, vi}`, không có Dual.
- Tab Translate: `handleTranslate` chỉ `setTimeout` giả lập. Tab Settings: toggle `defaultChecked` không lưu state, nút Export là nút chết.

## Quyết định thiết kế (đã chốt với user)

- Export gửi nội dung sub đã edit lên backend trước khi burn (fix cả lỗi "không tìm thấy" lẫn nội dung sai).
- Dual SRT: **1 file, mỗi block 2 dòng**, thứ tự dòng theo mode (`dual-vi-top` → VI trên / EN dưới; `dual-en-top` → ngược lại).
- Video Dual: backend ghép VI+EN thành 1 SRT 2 dòng rồi burn.

## Thiết kế

### Phần 1 — Bỏ tab Translate & Settings (frontend only)

`src/app/pages/EditorPage.tsx`:

- Xóa nhánh render `activeTab === "translate"` và `activeTab === "settings"` (dòng ~1617–1776).
- Xóa cấu hình tabs (chỉ còn Style). Panel phải bỏ thanh tab, thay bằng header tĩnh "Style" để giữ bố cục.
- Dọn code chết liên quan:
  - State: `activeTab`, `translateTarget`, `translating`, `translated`, `langDropOpen`.
  - Hàm: `handleTranslate`.
  - Hằng: `LANGUAGES`.
  - Import icon không còn dùng: `Languages`, `SlidersHorizontal`, `Sparkles`, `Download` (xác minh lại bằng grep trước khi xóa từng cái).

### Phần 2 + 3 — Export & Download theo display mode (gửi sub edit lên backend)

Gộp chung vì cùng cơ chế: gửi blocks đã edit lên backend, định dạng theo `subtitleDisplayMode`.

#### Kiểu dữ liệu chung (api.ts)

```ts
type SrtBlock = { start: number; end: number; text: string };
type ExportLang = "en" | "vi" | "dual";
interface ExportSubtitlesPayload {
  en?: SrtBlock[];
  vi?: SrtBlock[];
  order?: "vi-en" | "en-vi";   // chỉ dùng khi dual
}
```

`exportVideo(jobId, resolution, lang, subtitles?)` — thêm tham số `subtitles?: ExportSubtitlesPayload`, gửi trong body POST `/export`.

#### Frontend (EditorPage.tsx)

Helper `buildExportArgs(mode)` → `{ lang, subtitles }`:

| displayMode   | lang   | subtitles                                   |
|---------------|--------|---------------------------------------------|
| `en-only`     | `en`   | `{ en: enBlocks }`                          |
| `vi-only`     | `vi`   | `{ vi: viBlocks }`                          |
| `dual-vi-top` | `dual` | `{ vi, en, order: "vi-en" }`               |
| `dual-en-top` | `dual` | `{ en, vi, order: "en-vi" }`               |
| `off`         | dùng `subtitleLang` hiện tại, 1 ngôn ngữ    |

Blocks lấy từ `vietnameseSubtitles` / `englishSubtitles` (state đã chứa edit), map `{startTime,endTime,text}` → `{start,end,text}`.

- `handleExportVideo(resolution)`: gọi `exportVideo(jobId, resolution, lang, subtitles)`.
- `handleDownloadSRT()`: build SRT client-side theo `subtitleDisplayMode`:
  - single → như cũ.
  - dual → mỗi block 2 dòng theo `order`, dùng thuật toán ghép cặp (dưới). Tên file `subtitles_{mode}.srt`.

#### Ghép cặp Dual (dùng cả FE download lẫn BE burn)

VI và EN blocks có timestamp độc lập. Thuật toán:

1. Chọn timeline ngôn ngữ "top" (theo `order`) làm khung gốc.
2. Với mỗi block top, tìm block ngôn ngữ kia có **overlap thời gian lớn nhất**; nếu không overlap → để trống dòng đó.
3. Mỗi block SRT: 2 dòng `\n` (top trước, bottom sau), giữ start/end của block top.

Triển khai 1 lần ở backend (`dual_blocks_to_srt_string`) và 1 lần ở frontend (cho download SRT) — logic giống nhau, đơn giản nên chấp nhận lặp.

#### Backend

`controllers/subtitle_controller.py` — `/export`:
- Cho phép `lang ∈ {en, vi, dual}`.
- Đọc thêm `subtitles` từ payload (optional). Truyền xuống `export_burned_video`.

`models/subtitle_model.py`:
- `blocks_to_srt_string(blocks) -> str`: build SRT từ list `{start,end,text}`.
- `dual_blocks_to_srt_string(top, bottom) -> str`: ghép 2 dòng theo thuật toán overlap ở trên.
- `export_burned_video(job, resolution, lang, subtitles=None)`:
  - Nếu `subtitles` có dữ liệu → ghi SRT tạm từ đó (single hoặc dual theo `lang`/`order`), **không đọc file gốc** → fix lỗi "không tìm thấy" + đúng nội dung edit.
  - Nếu không có `subtitles` (tương thích ngược) → giữ hành vi cũ đọc file gốc, nhưng nếu file gốc mất thì tái tạo từ `job["english_words"]/["vietnamese_words"]` thay vì raise ngay.
  - Tên output dual: `{job_id}_dual_{resolution}.mp4`.

## Error handling

- FE: lỗi export hiển thị qua `exportError` như hiện tại.
- BE: nếu thiếu cả `subtitles` lẫn words để tái tạo SRT → raise `FileNotFoundError` (giữ thông báo rõ ràng).
- Validate `lang` ở cả FE và BE.

## Testing

- Backend: unit test `blocks_to_srt_string`, `dual_blocks_to_srt_string` (overlap, không overlap, lệch số block). Đặt trong `tests/`.
- Manual: edit sub → Download SRT (3 mode) đúng nội dung & định dạng; Export Video 3 mode chạy được, không còn lỗi "không tìm thấy".
- Verify build FE: `pnpm build` / tsc không lỗi sau khi xóa code chết.

## Ngoài phạm vi (YAGNI)

- Không thêm dịch thuật thật (tab Translate bị bỏ hẳn).
- Không thêm cài đặt persistent cho các toggle Settings (bỏ hẳn).
- Không đổi cơ chế lưu draft (vẫn sessionStorage).
