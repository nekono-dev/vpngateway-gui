// 責務: LAN側インターフェース（LAN_IFACE）に設定されているIPv4アドレスから、そのLANサブネットの
// ネットワークCIDR（例: 192.168.3.240/24 → 192.168.3.0/24）を検出する。明示的プロキシの許可CIDR欄の
// 初期値（Web UI側。webserver/requirements.md「明示的プロキシの許可CIDRの初期値」）として使う。

import { spawn } from "node:child_process";

const IP_BIN = process.env.IP_BIN ?? "ip";

/**
 * 目的: `ip -4 -o addr show dev <IF>`の標準出力から、最初のIPv4アドレス（ホストCIDR表記）を抽出する。
 *      ネットワークI/Oを伴わない純粋関数。
 * 入力: output(`ip -4 -o addr show`の標準出力文字列)。
 * 出力: `192.168.3.240/24`のようなホストCIDR表記。`inet`トークンが見当たらない場合はundefined。
 * 期待する入力形状: `<N>: <IF>    inet <IP>/<プレフィックス> brd ... scope ... <IF>\       valid_lft ...`
 *                （iproute2の`-o`（oneline）形式）。
 * 例: parseInterfaceIpv4Cidr("2: eth0    inet 192.168.3.240/24 brd 192.168.3.255 scope global eth0\\       valid_lft forever preferred_lft forever")
 *     // => "192.168.3.240/24"
 */
export function parseInterfaceIpv4Cidr(output: string): string | undefined {
  const match = /inet (\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2})/.exec(output);
  return match?.[1];
}

/**
 * 目的: ホストCIDR（例 192.168.3.240/24）から、ネットワークアドレスのCIDR（例 192.168.3.0/24）を求める。
 *      ネットワークI/Oを伴わない純粋関数。IPv4のみ対応（本プロジェクトの対象外はapi/src/lib/ipv4-cidr.tsと同様）。
 * 入力: hostCidr(`a.b.c.d/n`形式の文字列)。
 * 出力: ネットワークアドレスのCIDR。形式が不正なら undefined。
 * 例: toNetworkCidr("192.168.3.240/24") // => "192.168.3.0/24"
 */
export function toNetworkCidr(hostCidr: string): string | undefined {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(hostCidr);
  if (!match) return undefined;
  const octets = match.slice(1, 5).map((octet) => Number(octet));
  const prefixLength = Number(match[5]);
  if (octets.some((octet) => octet > 255) || prefixLength > 32) return undefined;

  const addressInt = ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
  const maskInt = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
  const networkInt = (addressInt & maskInt) >>> 0;
  const networkOctets = [24, 16, 8, 0].map((shift) => (networkInt >>> shift) & 255);
  return `${networkOctets.join(".")}/${prefixLength}`;
}

/**
 * 目的: LAN側インターフェースのIPv4アドレスから、LANサブネットのネットワークCIDRを取得する（`ip`コマンドを実行）。
 * 入力: lanIface(LAN側インターフェース名。未設定なら検出しない)。
 * 出力: ネットワークCIDR。取得できない場合（未設定・コマンド失敗・IPv4アドレス無し等）はundefined。
 * 失敗時の方針: `ip`コマンド自体が失敗した場合も例外を投げずundefinedを返す
 *              （呼び出し元は「初期値を出せない」として扱えば十分なため。tunnel-interface.tsと同様の方針）。
 * 例: await getLanSubnetCidr("eth0") // => "192.168.3.0/24" | undefined
 */
export function getLanSubnetCidr(lanIface: string | undefined): Promise<string | undefined> {
  if (!lanIface) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const child = spawn(IP_BIN, ["-4", "-o", "addr", "show", "dev", lanIface], { stdio: ["ignore", "pipe", "ignore"] });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.on("error", () => resolve(undefined));
    child.on("exit", (code) => {
      if (code !== 0) {
        resolve(undefined);
        return;
      }
      const hostCidr = parseInterfaceIpv4Cidr(stdout);
      resolve(hostCidr ? toNetworkCidr(hostCidr) : undefined);
    });
  });
}
