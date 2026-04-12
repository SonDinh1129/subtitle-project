"""
app.py — Entry Point (MVC)
──────────────────────────
Khởi động Flask app, load VAD, đăng ký controller blueprint.
"""

import os
from flask import Flask, send_from_directory
from flask_cors import CORS

from models.subtitle_model import load_vad
from controllers.subtitle_controller import subtitle_bp


def _resolve_colab_url() -> str:
    """Resolve and validate Colab endpoint from environment."""
    value = os.getenv("COLAB_URL", "https://unresearched-unobnoxious-tyesha.ngrok-free.dev").strip()
    if "your-ngrok-url" in value:
        raise RuntimeError(
            "COLAB_URL is still set to placeholder 'your-ngrok-url'. "
            "Please set it to your real ngrok URL (https://<id>.ngrok-free.dev)."
        )
    if not value.startswith("https://"):
        raise RuntimeError("COLAB_URL must start with 'https://'.")
    return value.rstrip("/")


# ─────────────────────────────────────────────────────────────────
# APP FACTORY
# ─────────────────────────────────────────────────────────────────

def create_app() -> Flask:
    app = Flask(
        __name__,
        static_folder="views/static",
        template_folder="views/templates",
    )

    # ── Config ────────────────────────────────────────────────────
    colab_url = _resolve_colab_url()
    app.config.update(
        COLAB_URL            = colab_url,
        MAX_CONTENT_LENGTH   = 2 * 1024 * 1024 * 1024,   # 2 GB upload limit
        SECRET_KEY           = os.getenv("SECRET_KEY", "dev-secret-change-in-prod"),
    )

    # ── CORS (allow React dev server) ─────────────────────────────
    CORS(app, resources={r"/api/*": {"origins": "*"}})

    # ── Register Controller Blueprint under /api ──────────────────
    app.register_blueprint(subtitle_bp, url_prefix="/api")

    # ── Serve React frontend (production build) ───────────────────
    @app.get("/")
    @app.get("/<path:path>")
    def serve_frontend(path=""):
        static_dir = os.path.join(app.root_path, "views", "static")
        if path and os.path.exists(os.path.join(static_dir, path)):
            return send_from_directory(static_dir, path)
        # SPA fallback → index.html
        return send_from_directory(static_dir, "index.html")

    return app


# ─────────────────────────────────────────────────────────────────
# STARTUP
# ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    # Load VAD model before accepting requests
    load_vad()

    application = create_app()

    port  = int(os.getenv("PORT", 5000))
    debug = os.getenv("FLASK_DEBUG", "false").lower() == "true"

    print(f"\n🚀 SubAI backend running at http://localhost:5000")
    print(f"   COLAB_URL = {application.config['COLAB_URL']}")
    print(f"   Debug     = {debug}\n")

    application.run(host="0.0.0.0", port=port, debug=debug)
