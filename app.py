"""
app.py — Entry Point (MVC)
──────────────────────────
Khởi động Flask app, load VAD, đăng ký controller blueprint.
"""

import logging
import os
from flask import Flask, send_from_directory
from flask_cors import CORS
from werkzeug.middleware.proxy_fix import ProxyFix
from dotenv import load_dotenv

from extensions import limiter
from models.subtitle_model import load_vad
from controllers.subtitle_controller import subtitle_bp
from controllers.auth_controller import auth_bp
from controllers.payment_controller import payment_bp


# Load backend environment files for local development.
load_dotenv(".env")
load_dotenv(".env.local", override=True)


def _resolve_colab_url() -> str:
    """Resolve and validate Colab batch VM endpoint from environment."""
    value = os.getenv("COLAB_URL", "https://your-ngrok-url.ngrok-free.dev").strip()
    if "your-ngrok-url" in value:
        raise RuntimeError(
            "COLAB_URL is still set to placeholder 'your-ngrok-url'. "
            "Please set it to your real ngrok URL (https://<id>.ngrok-free.dev)."
        )
    if not value.startswith("https://"):
        raise RuntimeError("COLAB_URL must start with 'https://'.")
    return value.rstrip("/")


def _resolve_colab_realtime_url() -> str:
    """Resolve Colab realtime VM endpoint. Falls back to COLAB_URL if not set."""
    value = os.getenv("COLAB_REALTIME_URL", "").strip()
    if not value:
        return ""  # controller will fall back to COLAB_URL
    if not value.startswith("https://"):
        raise RuntimeError("COLAB_REALTIME_URL must start with 'https://'.")
    return value.rstrip("/")


# ─────────────────────────────────────────────────────────────────
# APP FACTORY
# ─────────────────────────────────────────────────────────────────

def create_app() -> Flask:
    # ── Logging (so logger.info from controllers is visible) ──────
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    app = Flask(
        __name__,
        static_folder="views/static",
        template_folder="views/templates",
    )

    # ── Proxy fix (correct IP behind reverse proxy) ───────────────
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1)

    # ── Secret key guard ──────────────────────────────────────────
    secret_key = os.getenv("SECRET_KEY", "")
    is_debug = os.getenv("FLASK_DEBUG", "false").lower() == "true"
    if not secret_key and not is_debug:
        raise RuntimeError(
            "SECRET_KEY environment variable is not set. "
            "Set it to a long random string in production."
        )
    if not secret_key:
        secret_key = "dev-secret-change-in-prod"

    # ── Config ────────────────────────────────────────────────────
    colab_url = _resolve_colab_url()
    colab_realtime_url = _resolve_colab_realtime_url()
    app.config.update(
        COLAB_URL                  = colab_url,
        COLAB_REALTIME_URL         = colab_realtime_url or colab_url,
        MAX_CONTENT_LENGTH         = 2 * 1024 * 1024 * 1024,
        SECRET_KEY                 = secret_key,
        SUPABASE_URL               = os.getenv("SUPABASE_URL", ""),
        SUPABASE_SERVICE_ROLE_KEY  = os.getenv("SUPABASE_SERVICE_ROLE_KEY", ""),
        SUPABASE_JWT_SECRET        = os.getenv("SUPABASE_JWT_SECRET", ""),
    )

    # ── CORS (allow React dev server) ─────────────────────────────
    # FRONTEND_URL may be a comma-separated list of allowed origins
    # (e.g. "http://localhost:5000,https://xxx.ngrok-free.dev").
    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5173")
    origins = [o.strip() for o in frontend_url.split(",") if o.strip()]
    CORS(app, resources={r"/api/*": {"origins": origins}})

    # ── Rate Limiter ──────────────────────────────────────────────
    limiter.init_app(app)

    # ── Register Controller Blueprints under /api ─────────────────
    app.register_blueprint(subtitle_bp, url_prefix="/api")
    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(payment_bp, url_prefix="/api/payment")

    # ── Security headers ──────────────────────────────────────────
    from flask import Response
    @app.after_request
    def add_security_headers(response: Response) -> Response:
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline'; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: blob:; "
            "media-src 'self' blob:; "
            "connect-src 'self' https://*.supabase.co wss://*.supabase.co;"
        )
        return response

    # ── Serve React frontend (production build) ───────────────────
    @app.get("/")
    @app.get("/<path:path>")
    def serve_frontend(path=""):
        static_dir = os.path.join(app.root_path, "views", "static")
        if path and os.path.exists(os.path.join(static_dir, path)):
            return send_from_directory(static_dir, path)
        return send_from_directory(static_dir, "index.html")

    # ── Load VAD model and start cleanup daemon ───────────────────
    # Must run inside create_app() so gunicorn workers also initialise these.
    load_vad()
    from models.cleanup import start_cleanup_daemon
    from models.subtitle_model import UPLOAD_DIR, OUTPUT_DIR
    start_cleanup_daemon([UPLOAD_DIR, OUTPUT_DIR], retention_days=7)

    return app


# ─────────────────────────────────────────────────────────────────
# STARTUP
# ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    application = create_app()
    port  = int(os.getenv("PORT", 5000))
    debug = os.getenv("FLASK_DEBUG", "false").lower() == "true"
    print(f"\n🚀 SubAI backend running at http://localhost:5000")
    print(f"   COLAB_URL          = {application.config['COLAB_URL']}")
    print(f"   COLAB_REALTIME_URL = {application.config['COLAB_REALTIME_URL']}")
    print(f"   Debug              = {debug}\n")
    application.run(host="0.0.0.0", port=port, debug=debug)
