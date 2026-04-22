# Word-by-Word Streaming Subtitles — Design Spec

**Date:** 2026-04-23
**Topic:** Real-time word-level subtitle streaming with parallel Vietnamese translation
**Status:** Approved, pending implementation

---

## Problem

Hệ thống hiện tại tích lũy từ vào `WordSegmentAccumulator` và chỉ gửi subtitle sau khi dịch xong (~200-400ms sau khi đủ 4 từ hoặc có 0.4s silence). Người dùng không thấy gì trong khoảng thời gian đó — cảm giác lag rõ ràng so với âm thanh.

---

## Goal

Trong mode `dual-vi-top` và `dual-en-top`:
- **Slot EN:** Từng từ tiếng Anh xuất hiện ngay khi moshi decode xong (không chờ dịch)
- **Slot VI:** Tiếng Việt xuất hiện khi translation hoàn thành, ghi đè slot EN thành bản hoàn chỉnh

Chấp nhận: từ tiếng Anh đôi khi bị thay đổi do moshi chỉnh sửa (tradeoff đổi lấy latency thấp nhất).

---

## Architecture

```
Moshi decode word
    │
    ├─► [NGAY LẬP TỨC] send word_partial → Backend → SSE → Frontend slot EN
    │
    └─► WordSegmentAccumulator
            │
            flush (4 words OR 0.4s silence OR 1.5s max)
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
    → subtitle_controller.py (stream_job_realtime SSE)
    → EventSource → Frontend (EditorPage.tsx)
```

---

## Message Types

### Mới: `word_partial` (Colab → Backend → Frontend)

```json
{ "type": "word_partial", "word": "hello", "frame_ts": 1.23 }
```

Gửi ngay khi moshi decode được một từ mới. Không có thông tin VI.

### Đổi tên: `segment_complete` → vẫn dùng `"segment"` trên SSE

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

**2. Thêm điều kiện flush 4 từ vào `WordSegmentAccumulator.should_flush()`:**

```python
def should_flush(self, now_wall):
    if not self.words: return False
    duration = self.words[-1]["end"] - self.segment_start
    return (
        len(self.words) >= 4 or
        (now_wall - self.last_word_wall_time) > 0.4 or
        duration > 1.5
    )
```

**3. Thêm `"type": "segment_complete"` vào `_do_translate_segment()`:**

```python
return json.dumps({
    "type": "segment_complete",   # thêm dòng này
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

`subtitle_controller.py` không cần thay đổi — đã relay tất cả events từ queue qua SSE.

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
  | WordPartialEvent;   // thêm vào union
```

**`src/app/pages/EditorPage.tsx` — state mới:**

```typescript
const [inProgressWords, setInProgressWords] = useState<string[]>([]);
```

**Handler trong `onEvent`:**

```typescript
if (evt.type === "word_partial") {
    setInProgressWords(prev => [...prev, evt.word]);
    return;
}
if (evt.type === "segment") {
    setInProgressWords([]);  // clear in-progress khi segment hoàn chỉnh đến
    setEnglishWords(prev => [...prev, ...(evt.english_words ?? [])]);
    setVietnameseWords(prev => [...prev, ...(evt.vietnamese_words ?? [])]);
    return;
}
```

**Subtitle line computation (~line 687) — thêm in-progress vào textEn:**

```typescript
// Nếu đang stream và có inProgressWords → hiển thị chúng ở slot EN
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

Mode `vi-only` và `en-only`: không thay đổi hành vi hiện tại.

---

## Scope

**Trong scope:**
- word_partial cho EN streaming
- Trigger dịch sau 4 từ
- In-progress state trên frontend cho dual modes

**Ngoài scope:**
- Xử lý word correction (chấp nhận flicker)
- Thay đổi mode `vi-only` hay `en-only`
- Thay đổi WebSocket reconnect logic

---

## Risk

- `word_partial` gửi mỗi từ → tăng số WS message và SSE event lên đáng kể. Với tốc độ 3-5 từ/giây, thêm ~3-5 SSE event/giây — chấp nhận được.
- Flush 4 từ thay vì chờ silence → câu bị cắt ngắn hơn, VinAI dịch cụm ngắn → có thể giảm chất lượng dịch đôi chút. Giảm thiểu bằng cách giữ điều kiện silence song song.
