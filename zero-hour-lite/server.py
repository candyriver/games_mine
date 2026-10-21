#!/usr/bin/env python3
"""ZERO HOUR · lightweight web host + leaderboard API (no Godot, no dependencies).

Serves the static canvas client from this directory and exposes the same
endpoints the Godot build uses:

    GET  /api/player       -> {"registered": bool, "name": str}
    POST /api/register     -> {"registered": true, "name": str}
    POST /api/score        -> {"saved": true, "score": int, "best": int, "retained": bool}
    GET  /api/leaderboard  -> {"entries": [{name, score, elapsed, kills, level, recorded_at}]}

Players are identified by a keyed hash of the client address, exactly like the
original deployment, so no accounts or cookies are needed.
"""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import json
import os
import secrets
import sqlite3
import ssl
import unicodedata
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("SERVER_DATA_DIR", str(ROOT / "server_data")))
DB_PATH = DATA_DIR / "leaderboard.sqlite3"
SECRET_PATH = DATA_DIR / "player_id_secret.key"
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8091"))
TRUST_X_FORWARDED_FOR = os.environ.get("TRUST_X_FORWARDED_FOR", "0") == "1"
MAX_LEADERBOARD_ENTRIES = 100
TLS_CERT_FILE = os.environ.get("TLS_CERT_FILE", "")
TLS_KEY_FILE = os.environ.get("TLS_KEY_FILE", "")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def load_secret() -> bytes:
    configured = os.environ.get("PLAYER_ID_SECRET")
    if configured:
        return configured.encode("utf-8")
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not SECRET_PATH.exists():
        SECRET_PATH.write_bytes(secrets.token_bytes(32))
    return SECRET_PATH.read_bytes()


IDENTITY_SECRET = load_secret()


def initialize_database() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as connection:
        connection.execute(
            """CREATE TABLE IF NOT EXISTS players (
                ip_hash TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL
            )"""
        )
        connection.execute(
            """CREATE TABLE IF NOT EXISTS runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ip_hash TEXT NOT NULL REFERENCES players(ip_hash),
                score INTEGER NOT NULL,
                elapsed INTEGER NOT NULL,
                kills INTEGER NOT NULL,
                level INTEGER NOT NULL,
                recorded_at TEXT NOT NULL
            )"""
        )


def _trim_scores(connection: sqlite3.Connection) -> None:
    """Keep only the 100 highest run records."""
    count = connection.execute("SELECT COUNT(*) FROM runs").fetchone()[0]
    if count <= MAX_LEADERBOARD_ENTRIES:
        return
    connection.execute(
        """DELETE FROM runs
           WHERE id NOT IN (
               SELECT id FROM runs
               ORDER BY score DESC, recorded_at ASC, id ASC
               LIMIT ?
           )""",
        (MAX_LEADERBOARD_ENTRIES,),
    )


class GameHandler(SimpleHTTPRequestHandler):
    server_version = "ZeroHourLite/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, _format: str, *_args) -> None:
        return

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        if self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self) -> None:
        path = urlsplit(self.path).path
        if path == "/api/player":
            identity = self._identity_hash()
            with sqlite3.connect(DB_PATH) as connection:
                row = connection.execute(
                    "SELECT name FROM players WHERE ip_hash = ?", (identity,)
                ).fetchone()
            if row:
                self._send_json(200, {"registered": True, "name": row[0]})
            else:
                self._send_json(200, {"registered": False})
            return
        if path == "/api/leaderboard":
            with sqlite3.connect(DB_PATH) as connection:
                connection.row_factory = sqlite3.Row
                rows = connection.execute(
                    """SELECT p.name, r.score, r.elapsed, r.kills, r.level, r.recorded_at
                       FROM runs r JOIN players p USING (ip_hash)
                       ORDER BY r.score DESC, r.recorded_at ASC, r.id ASC,
                                p.name COLLATE NOCASE
                       LIMIT ?""",
                    (MAX_LEADERBOARD_ENTRIES,),
                ).fetchall()
            self._send_json(200, {"entries": [dict(row) for row in rows]})
            return
        if path == "/api/health":
            self._send_json(200, {"ok": True, "port": PORT})
            return
        if path == "/":
            self.path = "/index.html"
        super().do_GET()

    def do_POST(self) -> None:
        path = urlsplit(self.path).path
        try:
            payload = self._read_json()
        except (ValueError, json.JSONDecodeError):
            self._send_json(400, {"error": "invalid_json"})
            return

        identity = self._identity_hash()
        if path == "/api/register":
            raw_name = payload.get("name", "")
            if not isinstance(raw_name, str):
                self._send_json(400, {"error": "invalid_name"})
                return
            name = unicodedata.normalize("NFC", raw_name)
            name = "".join(c for c in name if c >= " " and c != "\x7f").strip()
            if not name or len(name) > 16:
                self._send_json(400, {"error": "name_must_be_1_to_16_characters"})
                return
            with sqlite3.connect(DB_PATH) as connection:
                connection.execute(
                    "INSERT OR IGNORE INTO players(ip_hash, name, created_at) VALUES (?, ?, ?)",
                    (identity, name, utc_now()),
                )
                row = connection.execute(
                    "SELECT name FROM players WHERE ip_hash = ?", (identity,)
                ).fetchone()
            self._send_json(200, {"registered": True, "name": row[0]})
            return

        if path == "/api/score":
            try:
                elapsed = int(payload.get("elapsed", 0))
                kills = int(payload.get("kills", 0))
                level = int(payload.get("level", 1))
            except (TypeError, ValueError):
                self._send_json(400, {"error": "invalid_score"})
                return
            if not (0 <= elapsed <= 172800 and 0 <= kills <= 100000 and 1 <= level <= 10000):
                self._send_json(400, {"error": "score_out_of_range"})
                return
            score = kills * 100 + level * 250 + elapsed * 5
            with sqlite3.connect(DB_PATH) as connection:
                player = connection.execute(
                    "SELECT 1 FROM players WHERE ip_hash = ?", (identity,)
                ).fetchone()
                if not player:
                    self._send_json(403, {"error": "player_not_registered"})
                    return
                cursor = connection.execute(
                    """INSERT INTO runs(ip_hash, score, elapsed, kills, level, recorded_at)
                       VALUES (?, ?, ?, ?, ?, ?)""",
                    (identity, score, elapsed, kills, level, utc_now()),
                )
                run_id = cursor.lastrowid
                _trim_scores(connection)
                retained = connection.execute(
                    "SELECT 1 FROM runs WHERE id = ?", (run_id,)
                ).fetchone()
                best_row = connection.execute(
                    "SELECT MAX(score) FROM runs WHERE ip_hash = ?", (identity,)
                ).fetchone()
                best = best_row[0] if best_row else None
            self._send_json(200, {
                "saved": True,
                "score": score,
                "best": best,
                "retained": retained is not None,
            })
            return

        self._send_json(404, {"error": "not_found"})

    # ------------------------------------------------------------- helpers
    def _identity_hash(self) -> str:
        address = self.client_address[0]
        if TRUST_X_FORWARDED_FOR:
            forwarded = self.headers.get("X-Forwarded-For", "").split(",", 1)[0].strip()
            if forwarded:
                address = forwarded
        try:
            normalized = ipaddress.ip_address(address.split("%", 1)[0]).compressed
        except ValueError:
            normalized = self.client_address[0]
        return hmac.new(IDENTITY_SECRET, normalized.encode("ascii"), hashlib.sha256).hexdigest()

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > 8192:
            raise ValueError("invalid body length")
        value = json.loads(self.rfile.read(length).decode("utf-8"))
        if not isinstance(value, dict):
            raise ValueError("expected JSON object")
        return value

    def _send_json(self, status: int, value: dict) -> None:
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    if not (ROOT / "index.html").exists():
        raise SystemExit("Missing index.html beside server.py")
    if bool(TLS_CERT_FILE) != bool(TLS_KEY_FILE):
        raise SystemExit("TLS_CERT_FILE and TLS_KEY_FILE must be configured together.")
    initialize_database()
    server = ThreadingHTTPServer((HOST, PORT), GameHandler)
    if TLS_CERT_FILE:
        tls_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        tls_context.load_cert_chain(TLS_CERT_FILE, TLS_KEY_FILE)
        server.socket = tls_context.wrap_socket(server.socket, server_side=True)
    scheme = "https" if TLS_CERT_FILE else "http"
    print(f"ZERO HOUR lite listening on {scheme}://{HOST}:{PORT}")
    print(f"Leaderboard database: {DB_PATH}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
