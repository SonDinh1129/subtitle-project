"""
conftest.py — shared pytest fixtures and sys.path / stub-module setup.

Heavy dependencies that are not installed in the test environment
(requests, torch, ffmpeg) are stubbed out here so that
models.subtitle_model can be imported without them.
"""
import sys
import types
from pathlib import Path
from unittest.mock import MagicMock

# ── Make the project root importable ────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


# ── Stub missing heavy dependencies ─────────────────────────────────────────

def _stub_module(name: str) -> types.ModuleType:
    """Return an existing module or create a MagicMock stub."""
    if name in sys.modules:
        return sys.modules[name]
    mod = MagicMock(name=name, spec=types.ModuleType)
    sys.modules[name] = mod
    return mod


# requests
_requests = _stub_module("requests")
_requests.get = MagicMock()
_requests.post = MagicMock()
_requests_exc = types.ModuleType("requests.exceptions")
_requests_exc.SSLError = type("SSLError", (Exception,), {})
_requests_exc.ConnectionError = type("ConnectionError", (Exception,), {})
_requests.exceptions = _requests_exc
sys.modules["requests.exceptions"] = _requests_exc

# torch — needs to look like a real module with hub attribute
_torch = _stub_module("torch")
_torch.hub = MagicMock()
_torch.Tensor = type("Tensor", (), {})

# ffmpeg
_stub_module("ffmpeg")
