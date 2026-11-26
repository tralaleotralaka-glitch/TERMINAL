#!/usr/bin/env python3
"""Локальный сервер-заглушка: просто отдаёт статические файлы.
Приложению сеть не нужна — index.html открывается и двойным щелчком
(file://), сервер нужен только для удобного предпросмотра."""
import http.server
import os
import socketserver

PORT = int(os.environ.get("PORT", "8000"))
ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args))


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    with Server(("0.0.0.0", PORT), Handler) as httpd:
        print(f"Терминал: http://localhost:{PORT}")
        httpd.serve_forever()
