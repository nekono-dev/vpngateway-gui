// 責務: ISP の模擬サービス（echo・DoH・平文 DNS）を、isp の名前空間で起動する入口（hosted E2E 専用）。
// 使い方: tsx e2e/hosted/services/isp-main.ts <待受 IPv4> <秘密鍵 PEM> <証明書 PEM> <PID の書き出し先>
// 制御: SIGUSR1 で DoH の応答を保留（上流の停止を再現する。平文 DNS と echo は止めない）、SIGUSR2 で再開。
//       SIGTERM・SIGINT で停止する。

import { readFileSync, writeFileSync } from "node:fs";
import { loadZone } from "./zone";
import { startIspDns } from "./isp-dns";
import { startIspHttps } from "./isp-https";

const [host, keyPath, certPath, pidPath] = process.argv.slice(2);
if (!host || !keyPath || !certPath || !pidPath) {
  console.error("使い方: isp-main.ts <待受 IPv4> <秘密鍵 PEM> <証明書 PEM> <PID の書き出し先>");
  process.exit(2);
}

const zone = loadZone();
const https = await startIspHttps({ host, key: readFileSync(keyPath), cert: readFileSync(certPath), zone });
const dns = await startIspDns(host, zone);
// 起動の完了を、PID の書き出しで知らせる（呼び出し側はこのファイルを待つ）
writeFileSync(pidPath, `${process.pid}\n`);

process.on("SIGUSR1", () => https.pauseDoh());
process.on("SIGUSR2", () => https.resumeDoh());
const stop = async () => {
  await dns.close();
  await https.close();
  process.exit(0);
};
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());

console.log(`ISP 模擬を起動した: ${host}`);
