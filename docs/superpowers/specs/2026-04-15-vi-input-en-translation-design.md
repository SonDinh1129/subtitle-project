# Design: Vietnamese Video Input → Bilingual Subtitles (VI + EN)

**Date:** 2026-04-15
**Status:** Approved

---

## Summary

Add support for Vietnamese-language video input. When a user selects `source_lang=vi`, the system transcribes Vietnamese audio (ASR), translates to English (MT), and outputs two SRT files — Vietnamese (source/ASR) and English (translated) — mirroring the existing English-input flow symmetrically.

---

## Approach

Single bidirectional endpoint strategy: add `source_lang` ("en" | "vi") as a new field propagated from frontend → controller → model → Colab payload. No new endpoints, no schema changes, no downstream changes.

Colab loads both MT models at startup (en2vi + vi2en). VRAM estimate: Whisper large-v3 (~3 GB) + en2vi (~1.5 GB) + vi2en (~1.5 GB) = ~6 GB on T4 15 GB — well within limits.

---

## Data Flow

```
Frontend (UploadPage)
  └─ source_lang = "en" | "vi"  [new UI selector]
       ↓ POST /api/upload (multipart form-data)
Controller (subtitle_controller.py)
  └─ validate source_lang, pass to create_job()
       ↓
Model (subtitle_model.py)
  └─ job["source_lang"] persisted in job record
  └─ run_pipeline() / run_pipeline_realtime() → ColabClient payload
       ↓ HTTP POST
Colab
  └─ source_lang routing: ASR language param + MT model selection
  └─ output schema unchanged: {english_words, vietnamese_words, ...}
       ↑ response
Model
  └─ SRT generation unchanged → en_srt_path + vi_srt_path
Frontend (EditorPage)
  └─ no changes — displays EN + VI bilingual subtitles as before
```

**Key invariant:** Colab response schema is always `{english_words, vietnamese_words}`. For VI input, `vietnamese_words` = ASR output (source language), `english_words` = translation. For EN input (existing), the reverse. All downstream code (SRT gen, editor, download) unchanged.

---

## Changes by Layer

### 1. Colab (`colab.md`)

**Cell 3 — Load vi2en MT model at startup:**
```python
mt_vi2en_tokenizer = AutoTokenizer.from_pretrained(
    "vinai/vinai-translate-vi2en-v2", src_lang="vi_VN"
)
mt_vi2en_model = AutoModelForSeq2SeqLM.from_pretrained(
    "vinai/vinai-translate-vi2en-v2"
).to(mt_device)
```

**Cell 4 — Fix `is_valid_word` to accept Unicode (Vietnamese diacritics):**

Current regex `r"^[A-Za-z0-9][A-Za-z0-9''\-.,!?]*$"` rejects all accented Vietnamese characters (ắ, ộ, ề, etc.), which would silently discard all ASR output for VI input.

```python
def is_valid_word(word):
    word = word.strip()
    if not word or len(word) < 1:
        return False
    return re.match(r"^[\w][\w''\-.,!?]*$", word, re.UNICODE) is not None
```

**Cell 4 — Add `translate_vi2en_batch()`:**
```python
def translate_vi2en_batch(vi_texts):
    if not vi_texts:
        return []
    input_ids = mt_vi2en_tokenizer(
        vi_texts, padding=True, truncation=True,
        max_length=512, return_tensors="pt"
    ).to(mt_device)
    with torch.no_grad():
        output_ids = mt_vi2en_model.generate(
            **input_ids,
            decoder_start_token_id=mt_vi2en_tokenizer.lang_code_to_id["en_XX"],
            num_return_sequences=1,
            num_beams=5,
            max_length=512,
            early_stopping=True
        )
    return mt_vi2en_tokenizer.batch_decode(output_ids, skip_special_tokens=True)
```

**Cell 5 — Both `/transcribe_translate` and `/transcribe_translate_stream` read `source_lang`:**
```python
source_lang = data.get("source_lang", "en")  # "en" | "vi"

# ASR call:
language = "vi" if source_lang == "vi" else "en"
segments_gen, _ = asr_model.transcribe(audio, task="transcribe",
    language=language, word_timestamps=True, beam_size=5, vad_filter=False)

# MT call (segment mode):
if source_lang == "vi":
    translation = translate_vi2en_batch([segment_text])[0]
    source_words = vi_words       # ASR output = Vietnamese
    translated_words = en_words   # MT output = English
else:
    translation = translate_en2vi_batch([segment_text])[0]
    source_words = en_words       # ASR output = English
    translated_words = vi_words   # MT output = Vietnamese

# Response keys always: english_words, vietnamese_words
```

---

### 2. `models/subtitle_model.py`

- `create_job()`: add `source_lang` field (default `"en"`)
- `ColabClient.transcribe_translate()`: add `source_lang` to payload dict
- `ColabClient.transcribe_translate_stream()`: add `source_lang` to payload dict
- `run_pipeline()`: read `job["source_lang"]`, pass to client calls
- `run_pipeline_realtime()`: same

---

### 3. `controllers/subtitle_controller.py`

In `upload_video()`, add after reading `process_mode`:
```python
source_lang = request.form.get("source_lang", "en")
if source_lang not in ("en", "vi"):
    source_lang = "en"
```
Pass `source_lang=source_lang` to `create_job()`.

---

### 4. `src/app/pages/UploadPage.tsx`

- Add `sourceLang` state: `useState<"en" | "vi">("en")`
- Add UI selector (radio buttons or select) before the upload button:
  - Option "en": "Video tiếng Anh → Phụ đề Việt"
  - Option "vi": "Video tiếng Việt → Phụ đề Anh"
- Append to FormData on submit: `formData.append("source_lang", sourceLang)`

---

## Files NOT changed

| File | Reason |
|------|--------|
| `EditorPage.tsx` | Displays english_words + vietnamese_words — unchanged |
| `api.ts` | uploadVideo() already passes FormData through — unchanged |
| `subtitle_optimizer.py` | VI SRT optimization — unchanged |
| Download endpoints | Key-based SRT lookup — unchanged |
| SRT generation (`words_to_srt_string`) | Language-agnostic — unchanged |
| Auth/payment middleware | No impact |

---

## Error Handling

- Invalid `source_lang` values default to `"en"` (controller validation)
- `is_valid_word` fix is backwards-compatible — existing EN flow unaffected
- No new error states introduced; pipeline error handling unchanged

---

## Out of Scope

- PhoWhisper integration (deferred — Approach 1 uses Whisper large-v3 with `language="vi"`)
- Per-language UI labels in EditorPage (e.g. showing "Source" / "Translation" instead of "VI" / "EN")
- Support for more than 2 languages
