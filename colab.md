"""
=================================================================
GOOGLE COLAB ASR + MT MICROSERVICE
Combines English ASR + English-to-Vietnamese Translation
=================================================================
"""

# ============================================
# CELL 1: Install Dependencies
# ============================================
print("📦 Installing dependencies...")
!pip install -q faster-whisper transformers torch sentencepiece flask flask-cors pyngrok

print("✅ Dependencies installed!")

# ============================================
# CELL 2: Setup ngrok
# ============================================
from pyngrok import ngrok

# ⚠️ THAY BẰNG TOKEN CỦA BẠN
NGROK_TOKEN = "38F4PHelZ9gVciG7xWzghX6PIz3_2aabWJ264C9QDQPJmPcKZ"  # ← Thay đổi ở đây
ngrok.set_auth_token(NGROK_TOKEN)
print("✅ ngrok configured!")

# ============================================
# CELL 3: Load Models
# ============================================
import torch
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM
from faster_whisper import WhisperModel
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load ASR Model
logger.info("🔄 Loading Whisper large-v3 for English ASR...")
asr_model = WhisperModel(
    "large-v3",
    device="cuda",
    compute_type="float16",
    download_root="/content/models"
)
logger.info("✅ ASR model loaded!")

# Load MT Model (EN → VI)
logger.info("🔄 Loading VinAI Translate EN→VI...")
mt_tokenizer = AutoTokenizer.from_pretrained(
    "vinai/vinai-translate-en2vi-v2",
    src_lang="en_XX"
)
mt_model = AutoModelForSeq2SeqLM.from_pretrained(
    "vinai/vinai-translate-en2vi-v2"
)
mt_device = torch.device("cuda")
mt_model.to(mt_device)
logger.info("✅ MT model loaded!")

# ============================================
# CELL 4: Helper Functions
# ============================================
import re
import numpy as np

def is_valid_word(word):
    """Filter invalid words from ASR"""
    word = word.strip()
    if not word or len(word) < 1:
        return False

    # English word pattern
    return re.match(r"^[A-Za-z0-9][A-Za-z0-9''\-.,!?]*$", word) is not None


def add_punctuation_simple(text):
    """
    Add basic punctuation to ASR output
    Simple rule-based approach
    """
    # Capitalize first letter
    text = text.strip()
    if text:
        text = text[0].upper() + text[1:]

    # Add period at end if missing
    if not text.endswith(('.', '!', '?')):
        text += '.'

    return text


def translate_en2vi_batch(en_texts):
    """
    Translate English to Vietnamese in batch

    Args:
        en_texts: List of English texts

    Returns:
        List of Vietnamese translations
    """
    if not en_texts:
        return []

    # Tokenize
    input_ids = mt_tokenizer(
        en_texts,
        padding=True,
        truncation=True,
        max_length=512,
        return_tensors="pt"
    ).to(mt_device)

    # Generate translation
    with torch.no_grad():
        output_ids = mt_model.generate(
            **input_ids,
            decoder_start_token_id=mt_tokenizer.lang_code_to_id["vi_VN"],
            num_return_sequences=1,
            num_beams=5,
            max_length=512,
            early_stopping=True
        )

    # Decode
    vi_texts = mt_tokenizer.batch_decode(
        output_ids,
        skip_special_tokens=True
    )

    return vi_texts


def align_translation_to_words(
    original_words,
    english_text,
    vietnamese_text
):
    """
    Preserve timestamps after translation

    Strategy:
    - Split Vietnamese translation by words
    - Distribute timestamps proportionally
    """
    vi_words = vietnamese_text.split()

    if not vi_words:
        return []

    # Calculate total duration
    total_duration = original_words[-1]["end"] - original_words[0]["start"]
    time_per_vi_word = total_duration / len(vi_words)

    result = []
    current_time = original_words[0]["start"]

    for vi_word in vi_words:
        result.append({
            "word": vi_word,
            "start": round(current_time, 2),
            "end": round(current_time + time_per_vi_word, 2)
        })
        current_time += time_per_vi_word

    return result


# ============================================
# CELL 5: Flask API
# ============================================
from flask import Flask, request, jsonify
from flask_cors import CORS
import time
import base64
import gc

app = Flask(__name__)
CORS(app)


@app.route("/", methods=["GET"])
def home():
    return jsonify({
        "service": "ASR + MT Microservice",
        "status": "running",
        "models": {
            "asr": "whisper-large-v3",
            "mt": "vinai-translate-en2vi-v2"
        },
        "endpoints": {
            "health": "/health",
            "transcribe_only": "/transcribe_only (POST)",
            "translate_only": "/translate_only (POST)",
            "transcribe_translate": "/transcribe_translate (POST)"
        }
    })


@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "healthy",
        "asr_model": "whisper-large-v3",
        "mt_model": "vinai-translate-en2vi-v2",
        "device": "cuda"
    })


@app.route("/transcribe_only", methods=["POST"])
def transcribe_only():
    """ASR only - English transcription"""
    try:
        start_time = time.time()
        data = request.get_json()
        segments = data.get("segments", [])

        all_words = []
        total_audio = 0.0

        for seg in segments:
            audio_bytes = base64.b64decode(seg["audio_base64"])
            audio = np.frombuffer(audio_bytes, dtype=np.float32)
            total_audio += len(audio) / 16000

            segments_gen, _ = asr_model.transcribe(
                audio,
                task="transcribe",
                language="en",
                word_timestamps=True,
                beam_size=5,
                vad_filter=False
            )

            for s in segments_gen:
                if s.words:
                    for w in s.words:
                        if is_valid_word(w.word):
                            all_words.append({
                                "word": w.word.strip(),
                                "start": round(seg["start_offset"] + w.start, 2),
                                "end": round(seg["start_offset"] + w.end, 2)
                            })

            del audio, segments_gen
            gc.collect()

        total_time = time.time() - start_time

        return jsonify({
            "words": all_words,
            "full_text": " ".join([w["word"] for w in all_words]),
            "total_words": len(all_words),
            "processing_time": round(total_time, 2),
            "rtf": round(total_time / total_audio, 3)
        })

    except Exception as e:
        logger.error(f"ASR error: {str(e)}")
        return jsonify({"error": str(e)}), 500


@app.route("/translate_only", methods=["POST"])
def translate_only():
    """MT only - English to Vietnamese"""
    try:
        start_time = time.time()
        data = request.get_json()

        en_texts = data.get("texts", [])
        if isinstance(en_texts, str):
            en_texts = [en_texts]

        vi_texts = translate_en2vi_batch(en_texts)

        total_time = time.time() - start_time

        return jsonify({
            "translations": vi_texts,
            "count": len(vi_texts),
            "processing_time": round(total_time, 3)
        })

    except Exception as e:
        logger.error(f"MT error: {str(e)}")
        return jsonify({"error": str(e)}), 500


@app.route("/transcribe_translate", methods=["POST"])
def transcribe_translate():
    """
    Complete pipeline: ASR EN → MT EN→VI with timestamp preservation

    Request:
    {
        "segments": [
            {"audio_base64": "...", "start_offset": 0.0, "end_offset": 5.2},
            ...
        ],
        "translation_mode": "sentence" or "segment"
    }

    Response:
    {
        "english_words": [...],
        "vietnamese_words": [...],
        "english_text": "...",
        "vietnamese_text": "...",
        "processing_time": 3.45
    }
    """
    try:
        start_time = time.time()
        data = request.get_json()
        segments = data.get("segments", [])
        translation_mode = data.get("translation_mode", "segment")

        logger.info(f"📦 Processing {len(segments)} segments...")

        # Step 1: ASR (English transcription)
        all_english_words = []
        segment_texts = []

        for idx, seg in enumerate(segments):
            audio_bytes = base64.b64decode(seg["audio_base64"])
            audio = np.frombuffer(audio_bytes, dtype=np.float32)

            segments_gen, _ = asr_model.transcribe(
                audio,
                task="transcribe",
                language="en",
                word_timestamps=True,
                beam_size=5,
                vad_filter=False
            )

            segment_words = []
            for s in segments_gen:
                if s.words:
                    for w in s.words:
                        if is_valid_word(w.word):
                            word_data = {
                                "word": w.word.strip(),
                                "start": round(seg["start_offset"] + w.start, 2),
                                "end": round(seg["start_offset"] + w.end, 2),
                                "segment_id": idx
                            }
                            all_english_words.append(word_data)
                            segment_words.append(word_data)

            # Group by segment
            segment_text = " ".join([w["word"] for w in segment_words])
            if segment_text:
                segment_text = add_punctuation_simple(segment_text)
                segment_texts.append({
                    "text": segment_text,
                    "words": segment_words
                })

            del audio, segments_gen
            gc.collect()

        logger.info(f"✅ ASR done: {len(all_english_words)} words")

        # Step 2: Translation (EN → VI)
        all_vietnamese_words = []
        vietnamese_full_text = []

        if translation_mode == "segment":
            # Translate each segment separately (better timestamp alignment)
            for seg_data in segment_texts:
                vi_translation = translate_en2vi_batch([seg_data["text"]])[0]
                vietnamese_full_text.append(vi_translation)

                # Align timestamps
                vi_words = align_translation_to_words(
                    seg_data["words"],
                    seg_data["text"],
                    vi_translation
                )
                all_vietnamese_words.extend(vi_words)

        else:  # "sentence" mode
            # Translate all at once (better translation quality)
            full_english = " ".join([s["text"] for s in segment_texts])
            vi_translation = translate_en2vi_batch([full_english])[0]
            vietnamese_full_text = [vi_translation]

            # Align timestamps (approximate)
            all_vietnamese_words = align_translation_to_words(
                all_english_words,
                full_english,
                vi_translation
            )

        logger.info(f"✅ MT done: {len(all_vietnamese_words)} words")

        total_time = time.time() - start_time

        return jsonify({
            "english_words": all_english_words,
            "vietnamese_words": all_vietnamese_words,
            "english_text": " ".join([w["word"] for w in all_english_words]),
            "vietnamese_text": " ".join(vietnamese_full_text),
            "segment_count": len(segments),
            "processing_time": round(total_time, 2),
            "translation_mode": translation_mode
        })

    except Exception as e:
        logger.error(f"Pipeline error: {str(e)}")
        return jsonify({"error": str(e)}), 500
# ============================================
# CELL 5b: Streaming Endpoint (Premium / Realtime)
# ============================================
from flask import stream_with_context, Response
import json

@app.route("/transcribe_translate_stream", methods=["POST"])
def transcribe_translate_stream():
    """
    ⚡ REALTIME STREAMING VERSION
    - Giống /transcribe_translate nhưng yield từng segment ngay khi xong
    - Không cần đợi toàn bộ pipeline hoàn tất
    
    Request: (giống hệt /transcribe_translate)
    {
        "segments": [
            {"audio_base64": "...", "start_offset": 0.0, "end_offset": 5.2},
            ...
        ],
        "translation_mode": "segment"
    }
    
    Response: SSE stream
        data: {"index": 0, "total": 5, "english_words": [...], "vietnamese_words": [...], ...}
        data: {"index": 1, "total": 5, ...}
        data: [DONE]
    """
    data             = request.get_json()
    segments         = data.get("segments", [])
    translation_mode = data.get("translation_mode", "segment")
    total            = len(segments)

    logger.info(f"⚡ Stream request: {total} segments")

    def generate():
        for idx, seg in enumerate(segments):
            try:
                # ── BƯỚC 1: ASR (copy y chang từ /transcribe_translate) ──
                audio_bytes = base64.b64decode(seg["audio_base64"])
                audio       = np.frombuffer(audio_bytes, dtype=np.float32)

                segments_gen, _ = asr_model.transcribe(
                    audio,
                    task="transcribe",
                    language="en",
                    word_timestamps=True,
                    beam_size=5,
                    vad_filter=False
                )

                segment_words = []
                for s in segments_gen:
                    if s.words:
                        for w in s.words:
                            if is_valid_word(w.word):
                                segment_words.append({
                                    "word":  w.word.strip(),
                                    "start": round(seg["start_offset"] + w.start, 2),
                                    "end":   round(seg["start_offset"] + w.end,   2),
                                })

                del audio, segments_gen
                gc.collect()

                # Bỏ qua đoạn im lặng / không có lời
                if not segment_words:
                    logger.info(f"  Segment {idx}: no speech, skipping")
                    continue

                # ── BƯỚC 2: MT (copy y chang từ /transcribe_translate) ──
                segment_text = add_punctuation_simple(
                    " ".join([w["word"] for w in segment_words])
                )
                vi_text  = translate_en2vi_batch([segment_text])[0]
                vi_words = align_translation_to_words(
                    segment_words, segment_text, vi_text
                )

                logger.info(f"  ✅ Segment {idx+1}/{total} done → yield ngay")

                # ── BƯỚC 3: YIELD NGAY, không đợi segment tiếp theo ──
                payload = {
                    "index":             idx,
                    "total":             total,
                    "start_offset":      seg["start_offset"],
                    "end_offset":        seg["end_offset"],
                    "english_words":     segment_words,
                    "vietnamese_words":  vi_words,
                    "english_text":      segment_text,
                    "vietnamese_text":   vi_text,
                }
                yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"

            except Exception as e:
                logger.error(f"Segment {idx} error: {e}")
                # Không dừng stream, báo lỗi đoạn đó rồi tiếp tục
                yield f"data: {json.dumps({'error': str(e), 'index': idx, 'total': total})}\n\n"

        # Báo hiệu hoàn tất
        yield "data: [DONE]\n\n"
        logger.info("⚡ Stream completed!")

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control":     "no-cache",
            "X-Accel-Buffering": "no",      # quan trọng: tắt buffer của nginx/proxy
            "Connection":        "keep-alive",
        }
    )


# ============================================
# CELL 6: Start Server
# ============================================
if __name__ == '__main__':
    print("\n" + "="*60)
    print("🚀 Starting ASR + MT Microservice...")
    print("="*60)

    try:
        ngrok.kill()
        public_url = ngrok.connect(5000)

        print("\n✅ Server is running!")
        print("="*60)
        print(f"🌐 Public URL: {public_url}")
        print("="*60)
        print("\n📋 Copy URL này để dùng trong Local PC")
        print(f"   COLAB_URL = '{public_url}'")
        print("="*60)
        print("\n🔗 Available endpoints:")
        print(f"   - Health: {public_url}/health")
        print(f"   - ASR only: {public_url}/transcribe_only")
        print(f"   - MT only: {public_url}/translate_only")
        print(f"   - Full pipeline: {public_url}/transcribe_translate")
        print(f"   - ⚡ Stream:        {public_url}/transcribe_translate_stream")
        print("="*60 + "\n")

        app.run(port=5000, debug=False, use_reloader=False, threaded=True)

    except Exception as e:
        print(f"❌ Error: {str(e)}")
        raise