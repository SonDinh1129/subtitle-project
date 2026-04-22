# Word-by-Word Streaming Subtitles — Design Spec

**Date:** 2026-04-23
**Topic:** Real-time word-level subtitle streaming with parallel Vietnamese translation
**Status:** Approved, pending implementation

---

## Problem

Hệ thống hiện tại tích lũy từ vào `WordSegmentAccumulator` và chỉ gửi subtitle sau khi dịch xong (~200-400ms sau khi đủ từ hoặc có 0.4s silence). Người dùng không thấy gì trong khoảng thời gian đó — cảm giác lag rõ ràng so với âm thanh.

---

## Goal

Trong mode `dual-vi-top` và `dual-en-top`:
- **Slot EN:** Từng từ tiếng Anh xuất hiện ngay khi moshi decode xong (không chờ dịch)
- **Slot VI:** Tiếng Việt xuất hiện khi translation hoàn thành, ghi đè slot EN thành bản hoàn chỉnh

Tradeoff chấp nhận: moshi là streaming ASR, có thể retroactively correct token trước — tỷ lệ correction ~15-25% ở từ cuối segment. Để giảm flicker, `word_partial` chỉ được emit sau khi từ đã được "commit" (từ hoàn chỉnh, không phải partial token — đây là hành vi tự nhiên của logic `prev_decoded = current_decoded.rsplit(" ", 1)[0] + " "` hiện tại). Chấp nhận flicker ở mức tối thiểu còn lại để đổi lấy latency thấp nhất.

---

## Architecture

```
Moshi decode word (committed — đã có space phía sau)
    │
    ├─► [NGAY LẬP TỨC] send word_partial → Backend → SSE → Frontend slot EN
    │
    └─► WordSegmentAccumulator
            │
            flush (6 words OR punctuation boundary OR 0.4s silence OR 1.5s max)
            │
            translate (VinAI ~200-400ms)
            │
            send segment_complete → Backend → SSE → Frontend (EN lock + VI appear)
```

**Stack của relay:**
```
Colab Flask WS (/ws/transcribe_kyutai)
    → websocket → subtitle_model.py (run_pipeline_realtime)
    → emit_job_event() → job queue
    → subtitle_controller.py (stream_job_realtime SSE, flush after each event)
    → EventSource → Frontend (EditorPage.tsx)
```

---

## Message Types

### Mới: `word_partial` (Colab → Backend → Frontend)

```json
{ "type": "word_partial", "word": "hello", "frame_ts": 1.23 }
```

Gửi ngay khi moshi commit được một từ hoàn chỉnh. Không có thông tin VI.

**Lưu ý `frame_ts`:** Là timestamp tính từ đầu audio stream (`frame_idx * 0.08`), không phải wall clock. Nếu có reconnect, `frame_ts` reset về 0. Frontend hiện tại chưa dùng `frame_ts` để sync — đây là known limitation, để nguyên trong scope này.

### `segment_complete` → relay thành `"segment"` trên SSE

Để không break frontend hiện tại, message type trên SSE vẫn là `"segment"`. Chỉ thêm trường `"type": "segment_complete"` trong Colab WS để backend phân biệt với các message khác.

---

## Changes by Layer

### Layer 1: Colab (`colab_realtime.md` — CELL 5)

**1. Gửi `word_partial` ngay khi có từ mới:**

```python
# Trong vòng lặp decode, sau accumulator.add_word():
with send_lock:
    ws.send(json.dumps({
        "type": "word_partial",
        "word": word_str,
        "frame_ts": round(frame_idx * 0.08, 2),
    }))
```

**2. Điều chỉnh flush trigger — tăng lên 6 từ, thêm punctuation boundary:**

```python
_PUNCT_BOUNDARIES = {".", "?", "!", ","}

def should_flush(self, now_wall, last_word=""):
    if not self.words: return False
    duration = self.words[-1]["end"] - self.segment_start
    return (
        len(self.words) >= 6 or                              # đủ 6 từ (tăng từ 4)
        (last_word and last_word[-1] in _PUNCT_BOUNDARIES) or  # punctuation boundary
        (now_wall - self.last_word_wall_time) > 0.4 or      # silence 0.4s
        duration > 1.5                                        # tối đa 1.5s
    )
```

Ngưỡng 6 từ thay vì 4 vì tiếng Việt là analytic language — cụm quá ngắn (4 từ) thiếu ngữ cảnh cho VinAI, đặc biệt với relative clauses và câu phức. Punctuation boundary cho phép flush sớm tại điểm ngắt tự nhiên mà không tăng chi phí inference.

**3. Thêm `"type": "segment_complete"` vào `_do_translate_segment()`:**

```python
return json.dumps({
    "type": "segment_complete",
    "english_words": en_words,
    "vietnamese_words": vi_words,
    ...
}, ensure_ascii=False)
```

### Layer 2: Backend Python

**`models/subtitle_model.py` — `run_pipeline_realtime()` (~line 878):**

```python
# Trong vòng lặp nhận events từ Colab WS:
if result.get("type") == "word_partial":
    emit_job_event(job_id, {
        "type": "word_partial",
        "word": result["word"],
        "frame_ts": result["frame_ts"],
    })
elif result.get("type") == "segment_complete":
    english_words.extend(result.get("english_words", []))
    vietnamese_words.extend(result.get("vietnamese_words", []))
    emit_job_event(job_id, {
        "type": "segment",
        "index": segment_index,
        "english_words": result.get("english_words", []),
        "vietnamese_words": result.get("vietnamese_words", []),
        "english_text": result.get("english_text", ""),
        "vietnamese_text": result.get("vietnamese_text", ""),
        "start": result.get("start"),
        "end": result.get("end"),
        "progress": ...,
    })
```

**`controllers/subtitle_controller.py` — đảm bảo flush ngay sau mỗi event:**

Flask dev server trên Colab không có Gunicorn/gevent, nên không thể config worker class. Tuy nhiên cần đảm bảo generator dùng `stream_with_context` và không buffer. HTTP/1.1 SSE là single TCP stream — nếu một `segment` event có payload lớn, nó block các `word_partial` phía sau. Giải pháp: `word_partial` luôn được emit trước `segment` trong queue, và payload của nó nhỏ (<100 bytes) nên head-of-line blocking không đáng kể.

### Layer 3: Frontend TypeScript

**`src/lib/api.ts` — thêm type:**

```typescript
export interface WordPartialEvent {
  type: "word_partial";
  word: string;
  frame_ts: number;
}

export type RealtimeStreamEvent =
  | StreamSegmentEvent
  | StreamSnapshotEvent
  | StreamDoneEvent
  | StreamErrorEvent
  | StreamSegmentErrorEvent
  | WordPartialEvent;
```

**`src/app/pages/EditorPage.tsx` — state mới:**

```typescript
const [inProgressWords, setInProgressWords] = useState<string[]>([]);
```

**Handler trong `onEvent`:**

```typescript
if (evt.type === "word_partial") {
    setInProgressWords(prev => {
        const updated = [...prev, evt.word];
        return updated.slice(-12);  // hard cap 12 từ — phòng segment_complete không đến
    });
    return;
}
if (evt.type === "segment") {
    setInProgressWords([]);  // clear khi segment hoàn chỉnh đến
    setEnglishWords(prev => [...prev, ...(evt.english_words ?? [])]);
    setVietnameseWords(prev => [...prev, ...(evt.vietnamese_words ?? [])]);
    return;
}
```

**Timeout fallback — tránh inProgressWords tích lũy vô hạn nếu VinAI timeout hoặc Colab crash:**

```typescript
useEffect(() => {
    if (inProgressWords.length === 0) return;
    const timer = setTimeout(() => setInProgressWords([]), 3000);
    return () => clearTimeout(timer);
}, [inProgressWords]);
```

**Subtitle line computation (~line 687) — thêm in-progress vào textEn:**

```typescript
const textEnDisplay = inProgressWords.length > 0
    ? inProgressWords.join(" ")
    : textEn;

// Dùng textEnDisplay thay vì textEn trong subtitleLines
```

---

## Display Behavior

| Thời điểm | Slot EN | Slot VI |
|---|---|---|
| Moshi decode từ đầu tiên | "Hello" | (trống) |
| Moshi decode từ tiếp theo | "Hello world" | (trống) |
| Sau khi dịch xong (segment arrive) | "Hello world" (locked) | "Xin chào thế giới" |
| Segment mới bắt đầu stream | "The next" | "Xin chào thế giới" (giữ nguyên) |
| VinAI timeout 3s không respond | "" (cleared) | "Xin chào thế giới" (giữ nguyên) |

Mode `vi-only` và `en-only`: không thay đổi hành vi hiện tại.

---

## Scope

**Trong scope:**
- `word_partial` cho EN streaming (committed words only)
- Flush trigger: 6 từ / punctuation / silence 0.4s / max 1.5s
- `inProgressWords` state với hard cap 12 từ và 3s timeout
- Backend relay `word_partial` qua SSE

**Ngoài scope:**
- Confidence-based filtering (moshi không expose confidence per token)
- Word correction xử lý mịn (flicker tối thiểu chấp nhận được)
- Thay đổi mode `vi-only` hay `en-only`
- WebSocket reconnect logic
- `frame_ts` sync sau reconnect

---

## Known Limitations

- **frame_ts desync sau reconnect:** `frame_ts = frame_idx * 0.08` reset về 0 khi Colab restart. Frontend chưa dùng `frame_ts` để sync nên chưa là bug active — cần revisit nếu sau này cần timestamp-based sync.
- **Flicker tối thiểu:** Từ cuối segment có ~15-25% xác suất bị moshi correction. Logic `rsplit(" ", 1)` đã chặn partial token nhưng không chặn full-word correction.
- **Translation quality ở boundary:** Flush 6 từ vẫn có thể cắt giữa relative clause. Punctuation boundary giảm nhưng không loại bỏ hoàn toàn vấn đề này.
