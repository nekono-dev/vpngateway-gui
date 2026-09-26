#!/usr/bin/env python3
# 責務: 検証用のIP確認サービス（HTTPS）。接続元のIPv4アドレスだけを本文で返し、ブラウザからのクロスオリジンのfetchを許可する
# （Access-Control-Allow-Origin: *）。設定の動作検証（Phase 27）の`verifyEchoUrl`の代役として、ラボの宛先サーバ側で動かす。
# 使い方: echo-server.py <待受アドレス> <ポート> <証明書> <鍵>
import http.server
import socketserver
import ssl
import sys

ADDRESS, PORT, CERT, KEY = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4]


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = f"{self.client_address[0]}\n".encode()
        self.send_response(200)
        self.send_header("content-type", "text/plain")
        self.send_header("access-control-allow-origin", "*")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        print(f"echo {self.client_address[0]}", flush=True)

    def log_message(self, *args):
        pass


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


server = Server((ADDRESS, PORT), Handler)
context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.load_cert_chain(CERT, KEY)
server.socket = context.wrap_socket(server.socket, server_side=True)
server.serve_forever()
