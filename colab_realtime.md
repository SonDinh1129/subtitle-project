# ============================================
# CELL 1: Install Dependencies (Fixed)
# ============================================
print("📦 Installing dependencies...")

# Bước 1: Cài moshi --no-deps để không upgrade torch (torch 2.10.0 có breaking change)
!pip install -q moshi --no-deps
# Cài các deps của moshi ngoài torch (torch giữ nguyên bản Colab)
!pip install -q "huggingface_hub>=0.24.0,<1.0.0" safetensors einops

# Bước 2: Gỡ torchvision + torchaudio
!pip uninstall -y torchvision torchaudio 2>/dev/null || true

# Bước 3: Xóa transformers + sentence-transformers HOÀN TOÀN
!pip uninstall -y transformers sentence-transformers 2>/dev/null || true
!rm -rf /usr/local/lib/python3.12/dist-packages/transformers
!rm -rf /usr/local/lib/python3.12/dist-packages/transformers-*.dist-info
!rm -rf /usr/local/lib/python3.12/dist-packages/sentence_transformers
!rm -rf /usr/local/lib/python3.12/dist-packages/sentence_transformers-*.dist-info
!find /usr/local/lib/python3.12 -name "*.pyc" -path "*/transformers/*" -delete 2>/dev/null || true
!find /usr/local/lib/python3.12 -name "__pycache__" -path "*/transformers/*" -exec rm -rf {} + 2>/dev/null || true

# Bước 4: FIX CORE
# moshi 0.2.x cần sentencepiece>=0.2.0 nhưng transformers 4.44 cần 0.1.x API.
# Giải pháp: force-reinstall về 0.1.99 sau moshi — moshi runtime vẫn hoạt động.
!pip install -q \
    "protobuf==3.20.3" \
    "transformers==4.44.0" \
    "huggingface-hub>=0.24.0,<1.0.0" \
    "accelerate>=0.26.0" \
    flask flask-cors pyngrok flask-sock numpy
!pip install -q "sentencepiece==0.1.99" --force-reinstall

# Bước 5: Xóa cache descriptor pool bằng cách restart submodules
import sys

mods_to_remove = [k for k in sys.modules if any(
    x in k for x in ['transformers', 'sentencepiece', 'google.protobuf']
)]
for mod in mods_to_remove:
    del sys.modules[mod]

# Verify
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM
print("✅ transformers import OK!")
print("✅ Dependencies installed!")

# ============================================
# CELL 2: Setup ngrok
# ============================================
import subprocess, time as _time
from pyngrok import ngrok, conf

# Kill tất cả ngrok process (kể cả từ session trước còn sống)
subprocess.run(["pkill", "-9", "-f", "ngrok"], capture_output=True)
_time.sleep(2)
ngrok.kill()

PORT = 5000
NGROK_TOKEN = "3Cd6GQUQ0lhT1lPbOdhoqgbETLZ_56zy6mDkVgQ8AWxfawhrQ"
ngrok.set_auth_token(NGROK_TOKEN)
tunnel = ngrok.connect(PORT)
public_url = tunnel.public_url
print(f"🌐 Realtime Tunnel: {public_url}")

# ============================================
# CELL 3: Load Models (FIXED)
# ============================================
from google.colab import userdata
import os, logging
import torch
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM

try:
    os.environ["HF_TOKEN"] = userdata.get("HF_TOKEN")
    print("✅ HF Token loaded!")
except Exception:
    print("⚠️ No HF_TOKEN, continuing without auth")

logging.basicConfig(level=logging.INFO, force=True)
logger = logging.getLogger(__name__)

mt_device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
kyutai_device = str(mt_device)
print(f"🖥️ Device: {mt_device} | torch: {torch.__version__}")

# VinAI EN→VI (~2 GB VRAM)
print("🔄 Loading VinAI Translate EN→VI...")
mt_tokenizer = AutoTokenizer.from_pretrained("vinai/vinai-translate-en2vi-v2", src_lang="en_XX")
mt_model = AutoModelForSeq2SeqLM.from_pretrained("vinai/vinai-translate-en2vi-v2").to(mt_device)
print("✅ VinAI EN→VI loaded!")

# Kyutai stt-1b-en_fr (~4 GB VRAM)
from moshi.models.loaders import CheckpointInfo

# Tìm LMGen trong các module khác nhau tùy phiên bản moshi
import importlib, moshi
print(f"moshi version: {getattr(moshi, '__version__', 'unknown')}")

LMGen = None
for _path in ['moshi.models.lm', 'moshi.models', 'moshi']:
    try:
        _mod = importlib.import_module(_path)
        if hasattr(_mod, 'LMGen'):
            LMGen = _mod.LMGen
            print(f"✅ LMGen found in {_path}")
            break
    except ImportError:
        pass

if LMGen is None:
    for _path in ['moshi.models.lm', 'moshi.models.lm_utils', 'moshi.models']:
        try:
            _mod = importlib.import_module(_path)
            _exports = [x for x in dir(_mod) if not x.startswith('_')]
            print(f"  {_path}: {_exports}")
        except Exception as _e:
            print(f"  {_path}: error — {_e}")
    raise ImportError("LMGen not found in moshi — check logs above for available API")

# Torch 2.10.0 compatibility patches
try:
    import torch.fx.experimental.symbolic_shapes as _sym
    if not hasattr(_sym, 'size_hint'):
        _sym.size_hint = lambda x, *a, **kw: int(x) if hasattr(x, '__int__') else x
    print("✅ torch symbolic_shapes OK")
except Exception as _e:
    print(f"⚠️ symbolic_shapes patch failed: {_e}")

# Torch 2.10.0: fix missing `_inductor.config.deterministic` để torch.compile hoạt động.
# moshi CẦN torch.compile để chạy realtime — disable nó → chậm hơn 3-5x.
# Monkey-patch use_deterministic_algorithms để nuốt AttributeError cụ thể này.
import torch._dynamo
torch._dynamo.config.suppress_errors = True

_orig_use_det = torch.use_deterministic_algorithms
def _patched_use_det(*args, **kwargs):
    try:
        return _orig_use_det(*args, **kwargs)
    except AttributeError as _exc:
        if "_inductor.config.deterministic" in str(_exc):
            return None  # swallow — config attribute không tồn tại trong torch 2.10.0
        raise
torch.use_deterministic_algorithms = _patched_use_det

# Thử thêm attribute trực tiếp (phòng trường hợp thay đổi ở chỗ khác)
try:
    import torch._inductor.config as _ic
    if hasattr(_ic, '_config') and isinstance(_ic._config, dict):
        _ic._config.setdefault('deterministic', False)
except Exception:
    pass
print("✅ torch.compile enabled (use_deterministic_algorithms patched)")

print("🔄 Loading Kyutai stt-1b-en_fr...")
_kyutai_ci = CheckpointInfo.from_hf_repo("kyutai/stt-1b-en_fr")

kyutai_mimi = _kyutai_ci.get_mimi(device=kyutai_device)
kyutai_mimi.eval()

_raw_lm = _kyutai_ci.get_moshi(device=kyutai_device)
_raw_lm.eval()

kyutai_text_tokenizer = _kyutai_ci.get_text_tokenizer()

# Chuyển model sang half precision → 2-3x nhanh hơn, đủ chạy >1x realtime.
# A100/H100 dùng bf16 (ổn định hơn); T4/V100 chỉ hỗ trợ fp16.
if kyutai_device == "cuda":
    _has_bf16 = torch.cuda.is_bf16_supported()
    _model_dtype = torch.bfloat16 if _has_bf16 else torch.float16
    kyutai_mimi = kyutai_mimi.to(dtype=_model_dtype)
    _raw_lm = _raw_lm.to(dtype=_model_dtype)
    print(f"✅ Models → {_model_dtype} (bf16 supported: {_has_bf16})")
else:
    _model_dtype = torch.float32

# Warmup — chạy vài frame dummy để kernel CUDA cache sẵn, ẩn cold start
print("🔥 Warming up Kyutai STT (5 frames)...")
_warm_lm = LMGen(_raw_lm, use_sampling=False, temp=0.0)
with torch.no_grad(), kyutai_mimi.streaming(1), _warm_lm.streaming(1):
    _dummy = torch.zeros(1, 1, kyutai_mimi.frame_size, device=kyutai_device, dtype=_model_dtype)
    for _ in range(5):
        _tok = kyutai_mimi.encode(_dummy)
        _warm_lm.step(_tok)
del _warm_lm
if kyutai_device == "cuda":
    torch.cuda.empty_cache()

print(f"✅ Kyutai STT ready! frame_size={kyutai_mimi.frame_size} dtype={_model_dtype}")

# ============================================
# CELL 4: Helper Functions
# ============================================
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
        en_texts, padding=True, truncation=True,
        max_length=256, return_tensors="pt"
    ).to(mt_device)
    with torch.no_grad():
        output_ids = mt_model.generate(
            **input_ids,
            decoder_start_token_id=mt_tokenizer.lang_code_to_id["vi_VN"],
            num_return_sequences=1,
            num_beams=1,           # greedy — 5x nhanh hơn beam=5
            max_length=256,
            do_sample=False,
            early_stopping=False,
        )
    return mt_tokenizer.batch_decode(output_ids, skip_special_tokens=True)

def align_translation_to_words(original_words, english_text, vietnamese_text):
    vi_words = vietnamese_text.split()
    if not vi_words or not original_words:
        return []
    total_duration = original_words[-1]["end"] - original_words[0]["start"]
    time_per_word = total_duration / max(len(vi_words), 1)
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
# CELL 5: Flask API (FIXED)
# ============================================
from flask import Flask, jsonify
from flask_cors import CORS
from flask_sock import Sock
import base64, json, time, threading, queue
# LMGen đã được import và resolve ở CELL 3

app = Flask(__name__)
CORS(app)
sock = Sock(app)

_PUNCT_BOUNDARIES = {".", "?", "!", ","}

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

    def should_flush(self, now_wall, last_word=""):
        if not self.words:
            return False
        duration = self.words[-1]["end"] - self.segment_start
        # 6 từ / punctuation / 0.4s silence / 1.5s tối đa
        return (
            len(self.words) >= 6
            or (last_word and last_word[-1] in _PUNCT_BOUNDARIES)
            or (now_wall - self.last_word_wall_time) > 0.4
            or duration > 1.5
        )

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
            "type": "segment_complete",
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
    logger.info("⚡ Kyutai WS connection opened — model: kyutai/stt-1b-en_fr (EN+FR only!)")
    accumulator = WordSegmentAccumulator()
    frame_idx = 0
    all_text_tokens = []
    prev_decoded = ""
    # Diagnostics
    _nonzero_tokens = 0
    _total_infer_time = 0.0
    _last_stats_frame = 0

    # Background translator — ASR loop không bị block bởi VinAI dịch thuật
    translate_queue = queue.Queue()
    stop_flag = threading.Event()
    send_lock = threading.Lock()

    def _translator_worker():
        while not stop_flag.is_set():
            try:
                item = translate_queue.get(timeout=0.2)
            except queue.Empty:
                continue
            if item is None:
                break
            en_words, seg_start, seg_end = item
            msg = _do_translate_segment(en_words, seg_start, seg_end)
            try:
                with send_lock:
                    ws.send(msg)
                    _last_send_time[0] = time.time()
            except Exception as _e:
                logger.warning(f"WS send failed: {_e!r}")

    worker = threading.Thread(target=_translator_worker, daemon=True)
    worker.start()

    # Keepalive: gửi empty ping mỗi 5s nếu không có segment nào
    # → tránh frontend timeout reconnect khi silence dài
    _last_send_time = [time.time()]
    def _keepalive_worker():
        while not stop_flag.is_set():
            _time.sleep(1.0)
            if time.time() - _last_send_time[0] > 5.0:
                try:
                    with send_lock:
                        ws.send(json.dumps({"type": "keepalive"}))
                    _last_send_time[0] = time.time()
                except Exception:
                    break
    ka_thread = threading.Thread(target=_keepalive_worker, daemon=True)
    ka_thread.start()

    try:
        lm_gen = LMGen(_raw_lm, use_sampling=False, temp=0.0)

        with torch.no_grad(), kyutai_mimi.streaming(1), lm_gen.streaming(1):
            while True:
                data = ws.receive()
                if data is None:
                    break
                payload = json.loads(data)
                if payload.get("type") == "END":
                    break

                pcm = np.frombuffer(
                    base64.b64decode(payload["pcm_base64"]), dtype=np.float32
                ).copy()

                audio_chunk = torch.from_numpy(pcm).to(kyutai_device, dtype=_model_dtype)[None, None]
                _t0 = time.time()
                audio_tokens = kyutai_mimi.encode(audio_chunk)
                out = lm_gen.step(audio_tokens)
                if kyutai_device == "cuda":
                    torch.cuda.synchronize()
                _total_infer_time += time.time() - _t0

                if out is not None:
                    token_id = int(out[0, 0].item())
                    if token_id > 0:
                        _nonzero_tokens += 1
                        all_text_tokens.append(token_id)
                        current_decoded = kyutai_text_tokenizer.decode(all_text_tokens)
                        new_text = current_decoded[len(prev_decoded):]

                        if " " in new_text:
                            for word_str in new_text.split(" ")[:-1]:
                                word_str = word_str.strip()
                                if word_str:
                                    now = time.time()
                                    accumulator.add_word(word_str, frame_idx * 0.08, now)
                                    try:
                                        with send_lock:
                                            ws.send(json.dumps({
                                                "type": "word_partial",
                                                "word": word_str,
                                                "frame_ts": round(frame_idx * 0.08, 2),
                                            }))
                                            _last_send_time[0] = time.time()
                                    except Exception as _e:
                                        logger.warning(f"word_partial send failed: {_e!r}")
                            prev_decoded = current_decoded.rsplit(" ", 1)[0] + " "

                # Check flush MỖI FRAME (không chỉ khi có từ mới)
                # → phát hiện silence ngay khi speech dừng, không chờ từ tiếp theo
                _last_w = accumulator.words[-1]["word"] if accumulator.has_words else ""
                if accumulator.has_words and accumulator.should_flush(time.time(), _last_w):
                    en_words, seg_start, seg_end = accumulator.flush()
                    translate_queue.put((en_words, seg_start, seg_end))
                    # Reset token tracking — tránh decode lại tokens cũ gây lặp từ.
                    # sentencepiece không cần context từ tokens cũ để decode đúng.
                    all_text_tokens.clear()
                    prev_decoded = ""

                frame_idx += 1
                # In log mỗi 50 frame (~4s audio) để biết tốc độ + có token nào không
                if frame_idx - _last_stats_frame >= 50:
                    _avg_ms = (_total_infer_time / 50) * 1000
                    logger.info(
                        f"📊 frames={frame_idx} tokens_detected={_nonzero_tokens} "
                        f"avg_infer={_avg_ms:.1f}ms/frame (target <80ms for realtime)"
                    )
                    _total_infer_time = 0.0
                    _last_stats_frame = frame_idx

    except Exception as e:
        logger.error(f"Kyutai stream error: {e}", exc_info=True)
    finally:
        if accumulator.has_words:
            en_words, seg_start, seg_end = accumulator.flush()
            translate_queue.put((en_words, seg_start, seg_end))
        translate_queue.put(None)
        stop_flag.set()
        worker.join(timeout=5)
        logger.info("⚡ Kyutai WS connection closed")

@app.route("/health")
def health():
    return jsonify({
        "status": "healthy",
        "vm": "realtime",
        "models": {
            "asr": "kyutai/stt-1b-en_fr",
            "mt": "vinai-translate-en2vi-v2"
        },
        "device": kyutai_device,
        "ws_endpoint": "/ws/transcribe_kyutai",
    })

# ============================================
# CELL 6: Start Server
# ============================================
print("\n" + "="*60)
print("🚀 Starting Realtime ASR Microservice (VM 1)...")
print("="*60)
print(f"🌐 Public URL : {public_url}")
print(f"📋 Set trong .env:")
print(f"   COLAB_REALTIME_URL = '{public_url}'")
print("="*60 + "\n")

app.run(port=PORT, debug=False, use_reloader=False, threaded=True)
