#!/usr/bin/env python3
# 責務: 検証用のモックDNSサーバ。自宅DNSサーバ（DoH）の代役として、名前→IPv4の対応表から応答する。
#   - DoH（HTTPS、RFC 8484のPOST。パス`/dns-query/<ClientID>`）と、平文DNS（UDP/TCP。フォールバック先の代役）の両方を待ち受ける。
#   - リクエストのパス（ClientID）・問い合わせ名・経路（doh/plain）を標準出力へ1行ずつ記録する。
#   - 管理用HTTP（127.0.0.1:9000。ループバックのみ）:
#       GET /set?name=<名前>&ip=<IPv4>&ttl=<秒>   対応表を更新する
#       GET /doh?state=up|down                      DoHを503にする/戻す（平文DNSは影響を受けない）
#       GET /log                                    これまでの記録を返す
# 使い方: mock-doh.py <待受アドレス> <証明書> <鍵>
# 外部のDNSサーバソフトを入れず、標準ライブラリだけで動かすための検証用スクリプト（本番コードではない）。

import http.server
import socketserver
import ssl
import struct
import sys
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler

LISTEN, CERT, KEY = sys.argv[1], sys.argv[2], sys.argv[3]
TABLE = {}          # 名前 -> (ip, ttl)
STATE = {"doh": "up"}
LOG = []
LOCK = threading.Lock()


def parse_question(data):
    offset, labels = 12, []
    while data[offset] != 0:
        length = data[offset]
        labels.append(data[offset + 1 : offset + 1 + length].decode())
        offset += 1 + length
    qtype = struct.unpack("!H", data[offset + 1 : offset + 3])[0]
    return ".".join(labels).lower(), qtype, offset + 5


def build_response(query):
    name, qtype, end = parse_question(query)
    flags = 0x8180
    entry = TABLE.get(name)
    answers = b""
    count = 0
    if entry is None:
        flags |= 3  # NXDOMAIN
    elif qtype == 1:
        ip, ttl = entry
        answers = b"\xc0\x0c" + struct.pack("!HHIH", 1, 1, ttl, 4) + bytes(int(part) for part in ip.split("."))
        count = 1
    header = query[:2] + struct.pack("!HHHHH", flags, 1, count, 0, 0)
    return name, header + query[12:end] + answers


def record(via, ident, name):
    with LOCK:
        LOG.append(f"{via} {ident} {name}")
    print(f"{via} {ident} {name}", flush=True)


class DohHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("content-length", 0))
        query = self.rfile.read(length)
        if STATE["doh"] == "down":
            self.send_response(503)
            self.end_headers()
            return
        name, response = build_response(query)
        record("doh", self.path.rsplit("/", 1)[-1], name)
        self.send_response(200)
        self.send_header("content-type", "application/dns-message")
        self.send_header("content-length", str(len(response)))
        self.end_headers()
        self.wfile.write(response)

    def log_message(self, *args):
        pass


class UdpHandler(socketserver.BaseRequestHandler):
    def handle(self):
        data, sock = self.request
        name, response = build_response(data)
        record("plain", self.client_address[0], name)
        sock.sendto(response, self.client_address)


class TcpHandler(socketserver.BaseRequestHandler):
    def handle(self):
        length = struct.unpack("!H", self.request.recv(2))[0]
        data = self.request.recv(length)
        name, response = build_response(data)
        record("plain", self.client_address[0], name)
        self.request.sendall(struct.pack("!H", len(response)) + response)


class AdminHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        params = {key: values[0] for key, values in urllib.parse.parse_qs(url.query).items()}
        body = "ok\n"
        if url.path == "/set":
            TABLE[params["name"].lower()] = (params["ip"], int(params.get("ttl", "60")))
        elif url.path == "/doh":
            STATE["doh"] = params["state"]
        elif url.path == "/log":
            with LOCK:
                body = "\n".join(LOG) + "\n"
        elif url.path == "/clear":
            with LOCK:
                LOG.clear()
        self.send_response(200)
        self.end_headers()
        self.wfile.write(body.encode())

    def log_message(self, *args):
        pass


class ThreadedHttps(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


class ThreadedUdp(socketserver.ThreadingMixIn, socketserver.UDPServer):
    daemon_threads = True
    allow_reuse_address = True


class ThreadedTcp(socketserver.ThreadingMixIn, socketserver.TCPServer):
    daemon_threads = True
    allow_reuse_address = True


context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.load_cert_chain(CERT, KEY)
doh = ThreadedHttps((LISTEN, 443), DohHandler)
doh.socket = context.wrap_socket(doh.socket, server_side=True)
admin = http.server.HTTPServer(("127.0.0.1", 9000), AdminHandler)
udp = ThreadedUdp((LISTEN, 53), UdpHandler)
tcp = ThreadedTcp((LISTEN, 53), TcpHandler)
for server in (doh, admin, udp, tcp):
    threading.Thread(target=server.serve_forever, daemon=True).start()
threading.Event().wait()
