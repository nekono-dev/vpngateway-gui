#!/usr/bin/env python3
# 責務: 検証用の宛先サーバ。接続元のIPv4アドレスを本文で返す（どの経路（VPN出口・ゲートウェイ自身）から来たかの判定に使う）。
# 使い方: target-server.py <ポート> <待受アドレス>...
import http.server
import socketserver
import sys
import threading

PORT = int(sys.argv[1])


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = f"{self.client_address[0]}\n".encode()
        self.send_response(200)
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


for address in sys.argv[2:]:
    threading.Thread(target=Server((address, PORT), Handler).serve_forever, daemon=True).start()
threading.Event().wait()
