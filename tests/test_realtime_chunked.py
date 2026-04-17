"""Tests for chunked realtime pipeline components."""
import json
import subprocess
import tempfile
import threading
import time
import wave
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
import pytest


# ── extract_audio_chunked ────────────────────────────────────────

class TestExtractAudioChunked:
    def test_creates_chunk_files(self, tmp_path):
        """FFmpeg segment produces numbered WAV files."""
        from models.subtitle_model import extract_audio_chunked

        # Generate a 12-second sine wave as test input
        test_wav = tmp_path / "test_input.wav"
        subprocess.run([
            "ffmpeg", "-f", "lavfi", "-i", "sine=frequency=440:duration=12",
            "-acodec", "pcm_s16le", "-ac", "1", "-ar", "16000", "-y",
            str(test_wav),
        ], check=True, capture_output=True)

        done = threading.Event()
        chunks_dir = tmp_path / "chunks"
        chunks_dir.mkdir()
        extract_audio_chunked(str(test_wav), chunks_dir, chunk_seconds=5, done_event=done)

        assert done.is_set()
        chunks = sorted(chunks_dir.glob("chunk_*.wav"))
        # 12s audio / 5s chunks → 3 chunks (0-5s, 5-10s, 10-12s)
        assert len(chunks) == 3

    def test_sets_done_event_on_failure(self, tmp_path):
        """done_event is set even when FFmpeg fails."""
        from models.subtitle_model import extract_audio_chunked

        done = threading.Event()
        chunks_dir = tmp_path / "chunks"
        chunks_dir.mkdir()

        with pytest.raises(RuntimeError, match="FFmpeg chunked extraction failed"):
            extract_audio_chunked("nonexistent_video.mp4", chunks_dir, done_event=done)

        assert done.is_set()


# ── ChunkProducer ────────────────────────────────────────────────

class TestChunkProducer:
    def _write_silent_chunk(self, chunks_dir: Path, index: int, duration_s: float = 5.0) -> Path:
        """Write a silent WAV file for testing."""
        path = chunks_dir / f"chunk_{index:04d}.wav"
        n_samples = int(duration_s * 16000)
        samples = np.zeros(n_samples, dtype=np.int16)
        with wave.open(str(path), "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(16000)
            wf.writeframes(samples.tobytes())
        return path

    @patch("models.subtitle_model.detect_speech_segments")
    @patch("models.subtitle_model._vad_utils", new_callable=lambda: lambda: [None, None, None, None, None])
    def test_yields_all_chunks_when_done(self, mock_vad_utils, mock_detect, tmp_path):
        """Yields all chunks when ffmpeg_done is set and chunks exist."""
        from models.subtitle_model import ChunkProducer

        chunks_dir = tmp_path / "chunks"
        chunks_dir.mkdir()
        self._write_silent_chunk(chunks_dir, 0)
        self._write_silent_chunk(chunks_dir, 1)

        # Mock read_audio: returns a tensor-like with len and numpy()
        mock_wav = MagicMock()
        mock_wav.__len__ = lambda self: 80000
        mock_wav.numpy.return_value = np.zeros(80000, dtype=np.float32)

        mock_read_audio = MagicMock(return_value=mock_wav)
        # _vad_utils is unpacked as: get_speech_timestamps, save_audio, read_audio, collect_chunks, VADIterator
        mock_vad_utils.__iter__ = MagicMock(return_value=iter([None, None, mock_read_audio, None, None]))

        mock_detect.return_value = ([], None)  # silence — skipped

        done = threading.Event()
        done.set()  # FFmpeg already done

        with patch("models.subtitle_model._vad_utils", [None, None, mock_read_audio, None, None]):
            producer = ChunkProducer(chunks_dir, done, chunk_seconds=5)
            results = list(producer.iter_chunks())

        assert len(results) == 2
        assert results[0]["index"] == 0
        assert results[0]["skipped"] is True
        assert results[1]["index"] == 1
        assert results[1]["skipped"] is True

    @patch("models.subtitle_model.detect_speech_segments")
    def test_does_not_yield_last_chunk_while_ffmpeg_running(self, mock_detect, tmp_path):
        """Chunk N is not yielded until chunk N+1 exists or FFmpeg is done."""
        from models.subtitle_model import ChunkProducer

        mock_wav = MagicMock()
        mock_wav.__len__ = lambda self: 80000
        mock_wav.numpy.return_value = np.zeros(80000, dtype=np.float32)
        mock_read_audio = MagicMock(return_value=mock_wav)
        mock_detect.return_value = ([], None)

        chunks_dir = tmp_path / "chunks"
        chunks_dir.mkdir()
        self._write_silent_chunk(chunks_dir, 0)  # Only chunk 0 exists

        done = threading.Event()  # NOT set — FFmpeg still running

        yielded = []

        with patch("models.subtitle_model._vad_utils", [None, None, mock_read_audio, None, None]):
            producer = ChunkProducer(chunks_dir, done, chunk_seconds=5)

            def _collect():
                for chunk in producer.iter_chunks():
                    yielded.append(chunk)

            t = threading.Thread(target=_collect, daemon=True)
            t.start()

            time.sleep(0.8)
            assert len(yielded) == 0  # chunk 0 not closed yet

            # chunk 1 appearing closes chunk 0
            self._write_silent_chunk(chunks_dir, 1)
            time.sleep(0.8)
            assert len(yielded) == 1
            assert yielded[0]["index"] == 0

            # Signal FFmpeg done → chunk 1 is now closed
            done.set()
            t.join(timeout=3)
            assert len(yielded) == 2


# ── ColabWsClient ────────────────────────────────────────────────

class TestColabWsClient:
    def test_url_conversion_https_to_wss(self):
        """https:// is converted to wss:// and path is appended."""
        from models.subtitle_model import ColabWsClient

        client = ColabWsClient("https://abc.ngrok-free.dev")
        assert client.ws_url == "wss://abc.ngrok-free.dev/ws/transcribe_stream"

    def test_url_conversion_http_to_ws(self):
        """http:// is converted to ws://."""
        from models.subtitle_model import ColabWsClient

        client = ColabWsClient("http://localhost:5000/")
        assert client.ws_url == "ws://localhost:5000/ws/transcribe_stream"

    def test_skipped_chunks_pass_through_without_ws(self):
        """Skipped chunks are yielded immediately without sending to Colab."""
        from models.subtitle_model import ColabWsClient

        client = ColabWsClient("https://fake.ngrok-free.dev")
        chunks = [
            {"index": 0, "skipped": True, "start_offset": 0.0, "end_offset": 5.0},
        ]

        with patch.object(client, "_connect") as mock_connect:
            mock_ws = MagicMock()
            mock_connect.return_value = mock_ws

            results = list(client.transcribe_stream_ws(
                iter(chunks), source_lang="en", translation_mode="segment",
            ))

        assert len(results) == 1
        assert results[0]["skipped"] is True
        mock_ws.send.assert_not_called()

    def test_retries_on_websocket_error(self):
        """Retries the same chunk after a WebSocketException."""
        import websocket as _ws_lib
        from models.subtitle_model import ColabWsClient

        client = ColabWsClient("https://fake.ngrok-free.dev")
        chunk = {"index": 0, "audio_base64": "AAAA", "start_offset": 0.0, "end_offset": 5.0, "skipped": False}

        result_json = json.dumps({"index": 0, "english_words": [], "skipped": False})
        call_count = {"recv": 0}

        def mock_recv():
            call_count["recv"] += 1
            if call_count["recv"] == 1:
                raise _ws_lib.WebSocketException("connection lost")
            return result_json

        mock_ws = MagicMock()
        mock_ws.recv = mock_recv

        with patch.object(client, "_connect", return_value=mock_ws):
            with patch("models.subtitle_model.time.sleep"):  # skip actual sleep
                results = list(client.transcribe_stream_ws(
                    iter([chunk]), source_lang="en", translation_mode="segment",
                ))

        assert len(results) == 1
        assert call_count["recv"] == 2  # failed once, succeeded on retry

    def test_raises_after_max_retries(self):
        """Raises RuntimeError after MAX_RETRIES consecutive failures."""
        import websocket as _ws_lib
        from models.subtitle_model import ColabWsClient

        client = ColabWsClient("https://fake.ngrok-free.dev")
        chunk = {"index": 0, "audio_base64": "AAAA", "start_offset": 0.0, "end_offset": 5.0, "skipped": False}

        mock_ws = MagicMock()
        mock_ws.recv.side_effect = _ws_lib.WebSocketException("persistent failure")

        with patch.object(client, "_connect", return_value=mock_ws):
            with patch("models.subtitle_model.time.sleep"):
                with pytest.raises(RuntimeError, match="WebSocket failed after"):
                    list(client.transcribe_stream_ws(
                        iter([chunk]), source_lang="en", translation_mode="segment",
                    ))
