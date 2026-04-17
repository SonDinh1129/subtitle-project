"""
=================================================================
GOOGLE COLAB REALTIME ASR MICROSERVICE — VM 1 (Kyutai + EN→VI)
=================================================================
VRAM budget (T4 16 GB):
  Kyutai stt-1b-en_fr  ~4 GB
  VinAI EN→VI          ~2 GB
  ─────────────────────────
  Total                ~6 GB  (10 GB headroom for activations)

Endpoint: /ws/transcribe_kyutai
=================================================================
"""

# ============================================
# CELL 1: Install Dependencies
# ============================================
print("📦 Installing dependencies...")
# moshi installs huggingface-hub 0.x (its constraint).
# transformers 4.x requires huggingface-hub>=0.21.0 → compatible, no conflict.
!pip install -q moshi
!pip install -q "transformers>=4.40.0,<5.0.0" torch sentencepiece flask flask-cors pyngrok flask-sock numpy
print("✅ Dependencies installed!")

# ============================================
# CELL 2: Setup ngrok
# ============================================
from pyngrok import ngrok

ngrok.kill()
PORT = 5000

# ⚠️ THAY BẰNG TOKEN CỦA BẠN
NGROK_TOKEN = "3CObzFT2HwMQBy49lYxjm89OzJq_7nc5YF9AGkgppvKcfi9bF"
ngrok.set_auth_token(NGROK_TOKEN)
tunnel = ngrok.connect(PORT)
public_url = tunnel.public_url
print(f"🌐 Realtime Tunnel: {public_url}")

# ============================================
# CELL 3: Load Models
# ============================================
from google.colab import userdata
import os
import logging
import torch
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM

try:
    os.environ["HF_TOKEN"] = userdata.get("HF_TOKEN")
    print("✅ HF Token loaded!")
except Exception:
    print("⚠️ No HF_TOKEN, continuing without auth")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

mt_device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

# VinAI EN→VI (~2 GB VRAM)
logger.info("🔄 Loading VinAI Translate EN→VI...")
mt_tokenizer = AutoTokenizer.from_pretrained("vinai/vinai-translate-en2vi-v2", src_lang="en_XX")
mt_model = AutoModelForSeq2SeqLM.from_pretrained("vinai/vinai-translate-en2vi-v2").to(mt_device)
logger.info("✅ VinAI EN→VI loaded!")

# Kyutai stt-1b-en_fr (~4 GB VRAM)
from moshi.models.loaders import CheckpointInfo

logger.info("🔄 Loading Kyutai stt-1b-en_fr (PyTorch)...")
kyutai_device = str(mt_device)

_kyutai_ci = CheckpointInfo.from_hf_repo("kyutai/stt-1b-en_fr")
kyutai_mimi = _kyutai_ci.get_mimi(device=kyutai_device)
kyutai_lm   = _kyutai_ci.get_lm_gen(device=kyutai_device)
kyutai_text_tokenizer = _kyutai_ci.text_tokenizer

kyutai_mimi.eval()
kyutai_lm.eval()
logger.info(f"✅ Kyutai STT loaded on {kyutai_device}! frame_size={kyutai_mimi.frame_size}")

# ============================================
# CELL 4: Helper Functions
# ============================================
import re
import numpy as np


def add_punctuation_simple(text):
    text = text.strip()
    if text:
        text = text[0].upper() + text[1:]
    if not text.endswith(('.', '!', '?')):
        text += '.'
    return text


def translate_en2vi_batch(en_texts):
    if not en_texts:
        return []
    input_ids = mt_tokenizer(
        en_texts, padding=True, truncation=True, max_length=512, return_tensors="pt"
    ).to(mt_device)
    with torch.no_grad():
        output_ids = mt_model.generate(
            **input_ids,
            decoder_start_token_id=mt_tokenizer.lang_code_to_id["vi_VN"],
            num_return_sequences=1,
            num_beams=5,
            max_length=512,
            early_stopping=True,
        )
    return mt_tokenizer.batch_decode(output_ids, skip_special_tokens=True)


def align_translation_to_words(original_words, english_text, vietnamese_text):
    vi_words = vietnamese_text.split()
    if not vi_words or not original_words:
        return []
    total_duration = original_words[-1]["end"] - original_words[0]["start"]
    time_per_word = total_duration / len(vi_words)
    current_time = original_words[0]["start"]
    result = []
    for vi_word in vi_words:
        result.append({
            "word": vi_word,
            "start": round(current_time, 2),
            "end": round(current_time + time_per_word, 2),
        })
        current_time += time_per_word
    return result


# ============================================
# CELL 5: Flask API — /ws/transcribe_kyutai
# ============================================
from flask import Flask, jsonify
from flask_cors import CORS
from flask_sock import Sock
import base64
import json
import time

app = Flask(__name__)
CORS(app)
sock = Sock(app)


class WordSegmentAccumulator:
    def __init__(self):
        self.words = []
        self.last_word_wall_time = 0.0
        self.segment_start = None

    def add_word(self, word_text, timestamp, now_wall):
        if not self.words:
            self.segment_start = timestamp
        self.words.append({
            "word": word_text,
            "start": round(timestamp, 2),
            "end": round(timestamp + 0.08, 2),
        })
        self.last_word_wall_time = now_wall

    def should_flush(self, now_wall):
        if not self.words:
            return False
        duration = self.words[-1]["end"] - self.segment_start
        return (now_wall - self.last_word_wall_time) > 1.5 or duration > 8.0

    def flush(self):
        if not self.words:
            return [], None, None
        words, start = self.words, self.segment_start
        end = words[-1]["end"]
        self.words, self.segment_start = [], None
        return words, start, end

    @property
    def has_words(self):
        return bool(self.words)


def _do_translate_segment(en_words, start, end):
    try:
        en_text = add_punctuation_simple(" ".join(w["word"] for w in en_words))
        vi_text = translate_en2vi_batch([en_text])[0]
        vi_words = align_translation_to_words(en_words, en_text, vi_text)
        return json.dumps({
            "english_words": en_words,
            "vietnamese_words": vi_words,
            "english_text": en_text,
            "vietnamese_text": vi_text,
            "start": start,
            "end": end,
        }, ensure_ascii=False)
    except Exception as e:
        logger.exception("Translate segment failed")
        return json.dumps({
            "type": "segment_error",
            "time_range": [start, end],
            "message": str(e),
        })


@sock.route("/ws/transcribe_kyutai")
def transcribe_kyutai_ws(ws):
    """Receive 80ms PCM frames, run Kyutai STT, translate EN→VI, stream results."""
    logger.info("⚡ Kyutai WS connection opened")
    accumulator = WordSegmentAccumulator()
    frame_idx = 0
    all_text_tokens = []
    prev_decoded = ""

    try:
        with torch.no_grad(), kyutai_mimi.streaming(1), kyutai_lm.streaming(1):
            while True:
                data = ws.receive()
                if data is None:
                    break
                payload = json.loads(data)
                if payload.get("type") == "END":
                    break

                pcm = np.frombuffer(base64.b64decode(payload["pcm_base64"]), dtype=np.float32)
                audio_chunk = torch.from_numpy(pcm).to(kyutai_device)[None, None]

                audio_tokens = kyutai_mimi.encode(audio_chunk)
                text_tokens  = kyutai_lm.step(audio_tokens)

                if text_tokens is not None:
                    token_id = int(text_tokens[0, 0, 0].item())
                    if token_id > 0:
                        all_text_tokens.append(token_id)
                        current_decoded = kyutai_text_tokenizer.decode(all_text_tokens)
                        new_text = current_decoded[len(prev_decoded):]

                        if " " in new_text:
                            for word_str in new_text.split(" ")[:-1]:
                                word_str = word_str.strip()
                                if word_str:
                                    now = time.time()
                                    accumulator.add_word(word_str, frame_idx * 0.08, now)
                                    if accumulator.should_flush(now):
                                        en_words, start, end = accumulator.flush()
                                        ws.send(_do_translate_segment(en_words, start, end))
                            prev_decoded = current_decoded.rsplit(" ", 1)[0] + " "

                frame_idx += 1

    except Exception as e:
        logger.error(f"Kyutai stream error: {e}")
    finally:
        if accumulator.has_words:
            en_words, start, end = accumulator.flush()
            try:
                ws.send(_do_translate_segment(en_words, start, end))
            except Exception as e:
                logger.warning(f"Final flush failed: {e!r}")
        logger.info("⚡ Kyutai WS connection closed")


@app.route("/health")
def health():
    return jsonify({
        "status": "healthy",
        "vm": "realtime",
        "models": {"asr": "kyutai/stt-1b-en_fr", "mt": "vinai-translate-en2vi-v2"},
        "device": kyutai_device,
        "ws_endpoint": "/ws/transcribe_kyutai",
    })


# ============================================
# CELL 6: Start Server
# ============================================
if __name__ == '__main__':
    print("\n" + "="*60)
    print("🚀 Starting Realtime ASR Microservice (VM 1)...")
    print("="*60)
    print(f"🌐 Public URL: {public_url}")
    print(f"\n📋 Set this in your .env:")
    print(f"   COLAB_REALTIME_URL = '{public_url}'")
    print("="*60 + "\n")

    app.run(port=PORT, debug=False, use_reloader=False, threaded=True)
