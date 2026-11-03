// 責務: gateway 群の試験の共通部品。管理者の準備、VPN への接続、LAN クライアント（名前空間 lan）からの通信・名前解決、
// ISP の模擬サービスの制御、設定の更新を行う。すべて導入したスタックの API と、準備した名前空間を使う。

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { makeAdminCredentials, type AdminCredentials } from "./admin";
import { loadAdmin, saveAdmin, WORK } from "./stack";
import type { ApiClient } from "../../common/api-client";

const run = promisify(execFile);

/** LAN クライアントの名前空間（topology.sh の E2E_NS_LAN と一致させる）。 */
export const LAN_NS = "lan";
/** ISP の模擬サービス（echo・DoH・平文 DNS）の待受 IPv4（env.sh の E2E_ISP_IP と一致させる）。 */
export const ISP_IP = "192.168.50.254";
/** 検証の IP 確認サービス（ISP の echo）。 */
export const ECHO_URL = `https://${ISP_IP}/`;
/** ゲートウェイのホスト側（LAN の既定の次ホップ・DNS 中継の待受）。 */
export const GATEWAY_LAN_IP = "192.168.50.1";
/** VPN 出口の LAN 側アドレス（vpnexit が ISP へ masquerade する送信元）。 */
export const VPN_EGRESS_IP = "192.168.50.200";
/** ISP の DoH 対応表にある、中継の名前（A は ISP の IP）。 */
export const RELAY_NAME = "relay.e2e.test";
/** 迂回対象の名前（A は ISP の IP）。 */
export const BYPASS_NAME = "echo.bypass.test";
/** 53 番リダイレクトの確認の名前（直接の応答は 203.0.113.99。中継の対応表には無い）。 */
export const REDIRECT_NAME = "redirect.e2e.test";

/** 作業場所の CA（ISP の証明書を検証する）。 */
export const CA_PATH = join(WORK, "certs", "ca.crt");
/** ISP の PID の書き出し先（env.sh の E2E_ISP_PID_FILE と一致させる）。 */
const ISP_PID_FILE = join(WORK, "isp.pid");

/** VPN（モック CLI）の資格情報。モックが受け付ける値（実アカウントは使わない）。 */
export const MOCK_USER = "mock-user@example.test";
export const MOCK_PASSWORD = "mock-password";
export const MOCK_TOTP = "123456";

/** 目的: 管理者を準備し、ログインする。未設定なら作成して資格情報を作業場所へ書く（導入直後の群で使う）。 */
export async function ensureAdminLogin(client: ApiClient): Promise<AdminCredentials> {
  const state = await client.get<{ configured: boolean }>("/v1/operator");
  expect(state.ok, "API の状態が取得できない").toBe(true);
  let admin: AdminCredentials;
  if (state.ok && state.body.configured) {
    admin = await loadAdmin();
  } else {
    admin = makeAdminCredentials();
    const created = await client.post("/v1/operator", admin);
    expect(created.ok, "管理者の作成に失敗").toBe(true);
    await saveAdmin(admin);
  }
  const login = await client.post("/v1/operator/session", admin);
  expect(login.ok, "管理者のログインに失敗").toBe(true);
  return admin;
}

/** 目的: VPN のプロバイダを protonvpn にし、モックのアカウントでログインする。 */
export async function loginVpn(client: ApiClient): Promise<void> {
  const put = await client.put("/v1/providers/active", { providerId: "protonvpn" });
  expect(put.ok, "プロバイダの切り替えに失敗").toBe(true);
  const login = await client.post("/v1/session", { username: MOCK_USER, password: MOCK_PASSWORD, twoFactorCode: MOCK_TOTP });
  expect(login.ok, "VPN のログインに失敗").toBe(true);
}

/** 目的: 接続先の先頭の ID を得る（接続先の一覧が空なら失敗）。 */
export async function firstLocationId(client: ApiClient): Promise<string> {
  const res = await client.get<{ id: string }[]>("/v1/connection/locations");
  expect(res.ok, "接続先の一覧が得られない").toBe(true);
  const id = res.ok ? res.body[0]?.id : undefined;
  expect(id, "接続先が 1 件も無い").toBeTruthy();
  return id as string;
}

/** 目的: VPN に接続し、接続済みになるまで待つ。 */
export async function connectVpn(client: ApiClient): Promise<void> {
  const id = await firstLocationId(client);
  const res = await client.put("/v1/connection", { connect: true, locationId: id });
  expect(res.ok, "接続に失敗").toBe(true);
  await waitForConnection(client, "connected");
}

/** 目的: VPN から切断し、切断済みになるまで待つ。 */
export async function disconnectVpn(client: ApiClient): Promise<void> {
  const res = await client.put("/v1/connection", { connect: false });
  expect(res.ok, "切断に失敗").toBe(true);
  await waitForConnection(client, "disconnected");
}

/** 目的: 接続状態が期待の値になるまで待つ（上限 60 秒）。 */
export async function waitForConnection(client: ApiClient, status: "connected" | "disconnected"): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const res = await client.get<{ status: string }>("/v1/connection");
    if (res.ok && res.body.status === status) return;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`接続状態が ${status} にならなかった（上限 60 秒）`);
}

/** 目的: 設定を部分更新する（失敗したら試験を失敗させる）。 */
export async function patchConfig(client: ApiClient, patch: Record<string, unknown>): Promise<void> {
  const res = await client.put("/v1/connection/config", patch);
  expect(res.ok, `設定の更新に失敗: ${JSON.stringify(patch)} 応答: ${JSON.stringify(res)}`).toBe(true);
}

/**
 * 目的: 失敗の原因を探すため、ホストと VPN 出口の経路・規則・nft を取得する（試験のメッセージに出す）。
 * 出力: 取得できた内容（取得できない部分は説明の文字列）。秘密は含まれない。
 */
export async function networkDump(): Promise<string> {
  const commands: [string, string[]][] = [
    ["host route", ["ip", "-4", "route", "show"]],
    ["host rule", ["ip", "rule"]],
    ["host table 100", ["ip", "-4", "route", "show", "table", "100"]],
    ["vpnexit route", ["ip", "netns", "exec", "vpnexit", "ip", "-4", "route", "show"]],
    ["vpnexit nft", ["ip", "netns", "exec", "vpnexit", "nft", "list", "ruleset"]],
    ["host nft", ["nft", "list", "ruleset"]],
  ];
  const parts: string[] = [];
  for (const [label, args] of commands) {
    try {
      const { stdout } = await run("sudo", args);
      parts.push(`== ${label}\n${stdout.trim()}`);
    } catch (error) {
      parts.push(`== ${label}: 取得できない（${(error as Error).message.split("\n")[0]}）`);
    }
  }
  return parts.join("\n");
}

/** 結果: LAN クライアントからの通信。成功なら本文（前後の空白を除く）。 */
export type LanFetch = { ok: true; body: string } | { ok: false; error: string };

/**
 * 目的: LAN クライアント（名前空間 lan）から URL へ要求する。証明書は作業場所の CA で検証する。
 * 入力: url、extra（curl に渡す追加の引数。例: 明示的プロキシの指定）。
 * 出力: 成功なら本文、失敗なら curl の最初のエラー行。
 */
export async function lanFetch(url: string, extra: string[] = []): Promise<LanFetch> {
  try {
    const { stdout } = await run("sudo", [
      "ip", "netns", "exec", LAN_NS, "curl", "-sS", "-4", "--max-time", "8", "--cacert", CA_PATH, ...extra, "--", url,
    ]);
    return { ok: true, body: stdout.trim() };
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? String(error);
    return { ok: false, error: stderr.trim().split("\n")[0] ?? "" };
  }
}

/**
 * 目的: LAN クライアントの既定の DNS（ゲートウェイの中継）で、名前の A レコードを引く。
 * 出力: 解決できた最初の IPv4、解決できなければ null。
 */
export async function lanResolve(name: string): Promise<string | null> {
  try {
    const { stdout } = await run("sudo", ["ip", "netns", "exec", LAN_NS, "getent", "ahostsv4", name]);
    const first = stdout.trim().split("\n")[0]?.split(/\s+/)[0];
    return first ?? null;
  } catch {
    return null;
  }
}

/**
 * 目的: LAN クライアントから、指定の DNS サーバへ A レコードを問い合わせる（53 番リダイレクトの確認に使う）。
 * 出力: 応答の IPv4、"NXDOMAIN"、"NODATA"、"TIMEOUT" のいずれか。
 */
export async function lanDnsQuery(server: string, name: string): Promise<string> {
  const { stdout } = await run("sudo", ["ip", "netns", "exec", LAN_NS, "node_modules/.bin/tsx", "e2e/hosted/services/dns-query.ts", server, name]);
  return stdout.trim();
}

/**
 * 目的: ISP の模擬サービスへ制御の信号を送る（DoH の一時停止と再開）。
 * 入力: signal（"USR1" は DoH の応答を保留、"USR2" は再開）。
 */
export async function ispSignal(signal: "USR1" | "USR2"): Promise<void> {
  const pid = (await readFile(ISP_PID_FILE, "utf8")).trim();
  await run("sudo", ["kill", `-${signal}`, pid]);
}

/** 目的: 作業場所の CA の内容を読む（DoH 上流の CA として設定に入れる）。 */
export async function readCaPem(): Promise<string> {
  return readFile(CA_PATH, "utf8");
}
