#!/usr/bin/env python3
"""Redirect the standard HTTP port to the HTTPS game endpoint."""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os


HTTPS_ORIGIN = os.environ.get("HTTPS_ORIGIN", "https://localhost:8088").rstrip("/")


class RedirectHandler(BaseHTTPRequestHandler):
    def _redirect(self) -> None:
        self.send_response(308)
        self.send_header("Location", HTTPS_ORIGIN + self.path)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", "0")
        self.end_headers()

    do_GET = _redirect
    do_HEAD = _redirect
    do_POST = _redirect

    def log_message(self, _format: str, *_args) -> None:
        return


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 80), RedirectHandler).serve_forever()
