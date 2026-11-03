// 責務: 指定した DNS サーバへ A レコードを 1 件問い合わせ、結果を表示する（LAN クライアントの名前空間で使う試験用）。
// 使い方: tsx e2e/hosted/services/dns-query.ts <サーバの IPv4> <名前>
// 出力: 応答の A レコード（IPv4）、または NXDOMAIN（名前が無い）、または TIMEOUT（応答が無い）。例外にはしない。

import { createSocket } from "node:dgram";
import { encode, decode } from "dns-packet";

const TIMEOUT_MS = 3000;

const [server, name] = process.argv.slice(2);
if (!server || !name) {
  console.error("使い方: dns-query.ts <サーバの IPv4> <名前>");
  process.exit(2);
}

const socket = createSocket("udp4");
const query = encode({ type: "query", id: Math.floor(Math.random() * 0xffff), flags: 0x0100, questions: [{ type: "A", name }] });
const timer = setTimeout(() => {
  console.log("TIMEOUT");
  socket.close();
}, TIMEOUT_MS);

socket.on("message", (msg) => {
  clearTimeout(timer);
  const reply = decode(msg);
  // RCODE 3 は名前が無い（NXDOMAIN）
  if ((reply.flags ?? 0) & 0x000f) {
    console.log("NXDOMAIN");
  } else {
    const a = reply.answers?.find((answer) => answer.type === "A");
    console.log(a && typeof a.data === "string" ? a.data : "NODATA");
  }
  socket.close();
});
socket.send(query, 53, server, (error) => {
  if (error) {
    console.log("TIMEOUT");
    socket.close();
  }
});
