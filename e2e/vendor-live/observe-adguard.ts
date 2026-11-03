// 責務: 2.6 の手動の観測。AdGuard で接続先（既定は Seoul。--target で変更）を指定して接続したときの応答（状態コード・エラーの種類・文言）を記録する。
// 試験の判定はしない。記録は research.md の期待値を決めるための材料にする（要件 4.5・4.6 の前段）。
// 認証情報は準備処理と同じく端末で入力する。AdGuard はパスワードを使わず、承認の URL を別の端末で開いて承認する。

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ApiClient } from "../common/api-client";
import { countForbidden } from "../common/report";
import { DEFAULT_CONFIG_PATH, loadConfig, type LiveConfig } from "./lib/config";
import { prepare } from "./lib/prepare";
import { describeAbort, type PrepareIo } from "./lib/prepare-types";
import { fetchPublicIp } from "./lib/public-ip";
import { print, promptHidden, promptVisible } from "./lib/terminal";
import { describeApi } from "./scenarios/run";
import { observeEgress, type EgressObservation } from "./lib/egress";
import { describeObservation } from "./scenarios/connection";

/** 接続先の一覧の 1 件（GET /v1/connection/locations のうち、本ツールが読む部分）。 */
export interface LocationLike {
  readonly id: string;
  readonly country: string;
  readonly countryName: string;
  readonly city?: string;
}

/**
 * 目的: 一覧から Seoul の接続先を選ぶ。
 * 入力: locations(接続先の一覧)。
 * 出力: 都市名が Seoul（大文字小文字を問わない）の接続先。無ければ、ID に seoul を含むもの、無ければ韓国（kr）の接続先の先頭。どれも無ければ undefined。
 * 例: pickSeoul([{ id: "kr-seoul", country: "kr", countryName: "Korea" }]) // => { id: "kr-seoul", ... }
 */
export function pickSeoul(locations: readonly LocationLike[]): LocationLike | undefined {
  return (
    locations.find((location) => /seoul/i.test(location.city ?? "")) ??
    locations.find((location) => /seoul/i.test(location.id)) ??
    locations.find((location) => location.country.toLowerCase() === "kr")
  );
}

/**
 * 目的: 観測する接続先を選ぶ。target が無ければ Seoul、あれば ID・国コード・国名・都市名のいずれかに一致するものを選ぶ（大文字小文字を問わない）。
 * 入力: locations(接続先の一覧)、target(指定の文字列。省略可)。
 * 出力: 選んだ接続先。無ければ undefined。
 * 例: pickTarget(locations, "United States") // => { id: "us-...", countryName: "United States", ... }
 */
export function pickTarget(locations: readonly LocationLike[], target?: string): LocationLike | undefined {
  if (target === undefined) return pickSeoul(locations);
  const wanted = target.toLowerCase();
  return locations.find(
    (location) =>
      location.id.toLowerCase() === wanted ||
      location.country.toLowerCase() === wanted ||
      location.countryName.toLowerCase() === wanted ||
      (location.city ?? "").toLowerCase() === wanted,
  );
}

/** 観測の記録（秘密を含めない）。 */
interface Observation {
  readonly observedAt: string;
  readonly target: string;
  readonly apiBaseUrl: string;
  readonly plan?: string;
  readonly locationList: { readonly ok: boolean; readonly message: string; readonly seoul?: string };
  readonly connect?: { readonly ok: boolean; readonly message: string; readonly locationId: string };
  readonly afterConnect?: { readonly status?: string; readonly message?: string };
  readonly egress?: { readonly baselineIp: string; readonly observed: string; readonly differs: boolean };
  readonly disconnect?: { readonly ok: boolean; readonly message: string };
  readonly logout: { readonly ok: boolean; readonly message: string };
}

/** 接続の状態を 1 回読む（記録用）。 */
async function connectionStatus(api: ApiClient): Promise<{ status?: string; message?: string }> {
  const res = await api.get<{ status?: string }>("/v1/connection");
  return res.ok ? { status: res.body.status } : { message: describeApi(res) };
}

/**
 * 目的: Seoul の接続先への接続の応答を観測し、切断して終える。
 * 入力: config(設定)、api(準備処理で得た管理者の Cookie を保持する API クライアント)、plan(プラン ID)。
 * 出力: 観測の記録。
 * 失敗時の方針: 応答が失敗でも観測を続けて記録する。最後に接続が残っていれば切断を試みる。
 */
async function observe(api: ApiClient, apiBaseUrl: string, plan: string | undefined, baselineIp: string, target?: string): Promise<Observation> {
  const label = target ?? "Seoul";
  const base = { observedAt: new Date().toISOString(), target: label, apiBaseUrl, plan };

  const list = await api.get<LocationLike[]>("/v1/connection/locations");
  if (!list.ok) {
    return { ...base, locationList: { ok: false, message: describeApi(list) }, logout: await logoutOf(api) };
  }
  const seoul = pickTarget(list.body, target);
  if (seoul === undefined) {
    const countries = [...new Set(list.body.map((location) => location.countryName))].join(", ");
    return { ...base, locationList: { ok: false, message: `${label} の接続先が一覧に無い（国: ${countries}）` }, logout: await logoutOf(api) };
  }

  const locationList = { ok: true, message: `一覧 ${list.body.length} 件`, seoul: seoul.id };
  const connect = await api.put("/v1/connection", { connect: true, locationId: seoul.id });
  const connectRecord = { ok: connect.ok, message: connect.ok ? `HTTP ${connect.status}` : describeApi(connect), locationId: seoul.id };
  const afterConnect = await connectionStatus(api);
  // 接続後の出口 IP（基準の IP と異なれば、Seoul の出口を通っている）
  const egress = connect.ok ? await egressRecord(api, baselineIp) : undefined;

  // 接続が残っていれば切断する（観測の後の後始末）
  let disconnect: Observation["disconnect"];
  if (afterConnect.status === "connected") {
    const res = await api.put("/v1/connection", { connect: false });
    disconnect = { ok: res.ok, message: res.ok ? `HTTP ${res.status}` : describeApi(res) };
  }
  // 次の観測（別のアカウント）で承認をやり直せるよう、AdGuard からログアウトする
  return { ...base, locationList, connect: connectRecord, afterConnect, egress, disconnect, logout: await logoutOf(api) };
}

/** 目的: 接続後の出口 IP を観測し、基準の IP と異なるかを記録する。 */
async function egressRecord(api: ApiClient, baselineIp: string): Promise<{ baselineIp: string; observed: string; differs: boolean }> {
  const observation: EgressObservation = await observeEgress(api);
  const differs = observation.kind === "observed" && observation.ip !== baselineIp;
  return { baselineIp, observed: describeObservation(observation), differs };
}

/** 目的: AdGuard からログアウトし、結果を記録する。 */
async function logoutOf(api: ApiClient): Promise<{ ok: boolean; message: string }> {
  const out = await api.delete("/v1/session");
  return { ok: out.ok, message: out.ok ? `HTTP ${out.status}` : describeApi(out) };
}

/**
 * 目的: 観測の記録を書き出す。秘密の値を含むときは書き出さない。
 * 入力: config(成果物の場所)、observation(記録)、forbidden(端末で入力した秘密の値)。
 * 出力: 書き出したファイルの場所。
 */
async function writeObservation(config: LiveConfig, observation: Observation, forbidden: readonly string[]): Promise<string> {
  const json = `${JSON.stringify(observation, null, 2)}\n`;
  const needles = forbidden.flatMap((secret) => [secret, JSON.stringify(secret).slice(1, -1)]);
  if (countForbidden(json, needles) > 0) {
    throw new Error("観測の記録に秘密の文字列が含まれるため、書き出しを中止した");
  }
  await mkdir(config.artifactsDir, { recursive: true });
  const file = join(config.artifactsDir, `observe-adguard-${observation.plan ?? "unknown"}-${observation.observedAt.replace(/[:.]/g, "-")}.json`);
  await writeFile(file, json, "utf8");
  return file;
}

/**
 * 目的: 入口。準備処理（管理者の入力・AdGuard の承認）の後に、接続先への接続の応答を観測する。
 * 出力: 終了コード（準備の中止は 2。観測の記録ができたら 0）。
 */
async function main(): Promise<number> {
  // 引数: [設定ファイル] [--target=接続先]。--target は ID・国コード・国名・都市名のいずれか（省略時は Seoul）
  const args = process.argv.slice(2);
  const targetArg = args.find((arg) => arg.startsWith("--target="));
  const target = targetArg?.slice("--target=".length);
  const configPath = args.find((arg) => !arg.startsWith("--")) ?? DEFAULT_CONFIG_PATH;
  let config: LiveConfig;
  try {
    config = loadConfig(process.env, configPath);
  } catch (error) {
    print(`準備の中止: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  const entered: string[] = [];
  const io: PrepareIo = {
    hidden: async (label) => {
      const value = await promptHidden(label);
      entered.push(value);
      return value;
    },
    visible: promptVisible,
    print,
  };

  let outcome: Awaited<ReturnType<typeof prepare>>;
  try {
    outcome = await prepare(config, "adguardvpn", { io, fetchPublicIp: () => fetchPublicIp(), now: () => new Date() });
  } catch (error) {
    print(`準備を中断した: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  if (!outcome.ok) {
    print(`準備の中止（${outcome.step}）: ${describeAbort(outcome.reason)}`);
    return 2;
  }

  const { api } = outcome.session;
  const observation = await observe(api, config.apiBaseUrl, outcome.session.vendor.planId, outcome.session.baseline.publicIp, target);
  const file = await writeObservation(config, observation, entered.filter((value) => value !== ""));

  print("");
  print(`プラン: ${observation.plan ?? "不明"}`);
  print(`対象の接続先: ${observation.target}`);
  print(`接続先の一覧: ${observation.locationList.message}${observation.locationList.seoul ? `（${observation.target}: ${observation.locationList.seoul}）` : ""}`);
  if (observation.connect) print(`${observation.target} への接続: ${observation.connect.ok ? "成功" : "失敗"}（${observation.connect.message}）`);
  if (observation.afterConnect) print(`接続後の状態: ${observation.afterConnect.status ?? observation.afterConnect.message}`);
  if (observation.egress) print(`出口 IP: ${observation.egress.observed}（基準 ${observation.egress.baselineIp} と${observation.egress.differs ? "異なる" : "同じ、または未確認"}）`);
  if (observation.disconnect) print(`切断: ${observation.disconnect.ok ? "成功" : "失敗"}（${observation.disconnect.message}）`);
  print(`ログアウト: ${observation.logout.ok ? "成功" : "失敗"}（${observation.logout.message}）`);
  print(`観測の記録: ${file}`);
  print("この記録を research.md の 2.6 の欄に転記してください。");
  return 0;
}

// 直接の実行のときだけ入口を動かす（単体テストから pickSeoul を読めるように）
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      print(`想定外の失敗: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    },
  );
}
