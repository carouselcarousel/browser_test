"""A browser-fingerprinting research lab.

The public page ("/") looks like a simple image-sharing page and, on load, runs a fingerprint
collector plus a self-hosted copy of CreepJS, then stores what it measured in SQLite. The page
carries a visible notice that it collects browser/device data for research, so it is an honest
test rig rather than a covert tracker. "/admin" (no auth, by request) lists the collected visits
and lets you upload the image shown on the public page.
"""
from __future__ import annotations

import json
import os
import sqlite3
import time
from pathlib import Path

from flask import (Flask, abort, g, jsonify, redirect, render_template,
                   request, send_from_directory, url_for)
from werkzeug.utils import secure_filename

BASE = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("DB_PATH", BASE / "fingerprints.db"))
UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", BASE / "static" / "uploads"))
ALLOWED = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}
MAX_UPLOAD = 15 * 1024 * 1024

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD


# ---- storage -------------------------------------------------------------
def db() -> sqlite3.Connection:
    if "db" not in g:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def _close(_exc):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS visits (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            ts            REAL NOT NULL,
            ip            TEXT,
            user_agent    TEXT,
            custom_hash   TEXT,
            creep_hash    TEXT,
            creep_fuzzy   TEXT,
            creep_lies    TEXT,
            signals_json  TEXT,
            headers_json  TEXT
        );
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
        """
    )
    conn.commit()
    conn.close()


def get_setting(key: str, default: str = "") -> str:
    row = db().execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return row["value"] if row else default


def set_setting(key: str, value: str) -> None:
    db().execute(
        "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, value),
    )
    db().commit()


def client_ip() -> str:
    xff = request.headers.get("X-Forwarded-For", "")
    return xff.split(",")[0].strip() if xff else (request.remote_addr or "")


# ---- public page ---------------------------------------------------------
@app.route("/")
def index():
    image = get_setting("display_image")
    image_url = url_for("uploaded_file", filename=image) if image else None
    return render_template("index.html", image_url=image_url)


@app.route("/collect", methods=["POST"])
def collect():
    data = request.get_json(silent=True) or {}
    creep = data.get("creep") or {}
    db().execute(
        """INSERT INTO visits
           (ts, ip, user_agent, custom_hash, creep_hash, creep_fuzzy, creep_lies, signals_json, headers_json)
           VALUES (?,?,?,?,?,?,?,?,?)""",
        (
            time.time(),
            client_ip(),
            request.headers.get("User-Agent", ""),
            str(data.get("custom_hash", ""))[:128],
            str(creep.get("hash", ""))[:128],
            str(creep.get("fuzzy", ""))[:128],
            str(creep.get("lies", ""))[:256],
            json.dumps(data.get("signals", {}))[:200000],
            json.dumps({k: v for k, v in request.headers.items()})[:20000],
        ),
    )
    db().commit()
    return jsonify({"ok": True})


@app.route("/uploads/<path:filename>")
def uploaded_file(filename):
    return send_from_directory(UPLOAD_DIR, filename)


# ---- admin (no auth, by request) ----------------------------------------
@app.route("/admin")
def admin():
    rows = db().execute("SELECT * FROM visits ORDER BY ts DESC LIMIT 500").fetchall()
    image = get_setting("display_image")
    image_url = url_for("uploaded_file", filename=image) if image else None
    return render_template("admin.html", rows=rows, image_url=image_url, count=len(rows))


@app.route("/admin/visit/<int:visit_id>")
def admin_visit(visit_id):
    row = db().execute("SELECT * FROM visits WHERE id=?", (visit_id,)).fetchone()
    if not row:
        abort(404)
    return jsonify({k: row[k] for k in row.keys()})


@app.route("/admin/upload", methods=["POST"])
def admin_upload():
    file = request.files.get("image")
    if not file or not file.filename:
        return redirect(url_for("admin"))
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED:
        return "Unsupported file type", 400
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    name = secure_filename("display" + ext)
    file.save(UPLOAD_DIR / name)
    for other in UPLOAD_DIR.glob("display.*"):  # keep only the current image
        if other.name != name:
            other.unlink(missing_ok=True)
    set_setting("display_image", name)
    return redirect(url_for("admin"))


def db_rows():
    conn = sqlite3.connect(DB_PATH); conn.row_factory = sqlite3.Row
    try:
        return conn.execute("SELECT * FROM visits ORDER BY id").fetchall()
    finally:
        conn.close()


@app.template_filter("datetime")
def _fmt_dt(ts):
    try:
        return time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(float(ts)))
    except (TypeError, ValueError):
        return ""


init_db()

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8000, debug=True)
