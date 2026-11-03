// 責務: 手動の入口。準備処理の後に試験を続けて実行し、終了コードを返す（要件 4.1・7.1・7.2）。
// 終了コード: 全て合格で 0、試験の失敗（設定の復元の失敗・中断を含む）で 1、準備の中止（CI からの起動を含む）で 2。
// 設定の復元は、試験の結果や中断によらず、試験の後に必ず行う（要件 4.2・8.3）。

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ApiClient } from "../common/api-client";
import { countForbidden, formatSummary, writeReport, type TestResult } from "../common/report";
import { DEFAULT_CONFIG_PATH, loadConfig, type LiveConfig } from "./lib/config";
import { prepare } from "./lib/prepare";
import { describeAbort, type LiveSession, type PrepareIo } from "./lib/prepare-types";
import { fetchPublicIp } from "./lib/public-ip";
import { ensureEgressPrerequisite, restoreSettings, type RestoreResult } from "./lib/settings";
import { print, promptHidden, promptVisible } from "./lib/terminal";
import { adguardCases } from "./scenarios/adguard";
import { protonCases } from "./scenarios/proton";
import { describeApi, runCases } from "./scenarios/run";

/** 試験の対象にできるベンダー。 */
const VENDORS = ["protonvpn", "adguardvpn"] as const;
type VendorId = (typeof VENDORS)[number];

/**
 * 目的: 試験するベンダーを端末で選ばせる。
 * 出力: VENDORS のいずれか。他の入力は選び直させる。
 */
async function chooseVendor(): Promise<VendorId> {
  for (;;) {
    const answer = (await promptVisible("試験するベンダー（protonvpn / adguardvpn）: ")).trim();
    if ((VENDORS as readonly string[]).includes(answer)) return answer as VendorId;
    print(`「${answer}」は選べない。protonvpn か adguardvpn を入力する`);
  }
}

/**
 * 目的: 結果の一覧を端末に表示する。失敗は、期待・観測・理由を続けて表示する（要件 4.1・5.1・5.2）。
 */
function printResults(results: readonly TestResult[]): void {
  print(formatSummary(results));
  for (const result of results.filter((item) => item.outcome === "fail")) {
    print(`  失敗: ${result.name}`);
    if (result.expected !== undefined) print(`    期待: ${result.expected}`);
    if (result.observed !== undefined) print(`    観測: ${result.observed}`);
    if (result.reason !== undefined) print(`    理由: ${result.reason}`);
  }
}

/**
 * 目的: 失敗したときの接続とベンダーの状態を得る（要件 5.3）。秘密の値を含む項目は取らない。
 * 入力: api(管理者の Cookie を保持する API クライアント)。
 * 出力: 接続の状態と、ベンダーのログイン状態・プランの ID。
 */
async function snapshotState(api: ApiClient): Promise<Record<string, unknown>> {
  const connection = await api.get<{ status?: string; locationId?: string; country?: string }>("/v1/connection");
  const session = await api.get<{ loggedIn?: boolean; plan?: { id?: string } }>("/v1/session");
  return {
    connection: connection.ok
      ? { status: connection.body.status, locationId: connection.body.locationId, country: connection.body.country }
      : { error: describeApi(connection) },
    session: session.ok ? { loggedIn: session.body.loggedIn, planId: session.body.plan?.id } : { error: describeApi(session) },
  };
}

/** 成果物の書き出しに使う依存（結果・設定の記録・秘密の値）。 */
interface ArtifactInput {
  readonly config: LiveConfig;
  readonly results: readonly TestResult[];
  readonly forbidden: readonly string[];
  readonly record: Record<string, unknown>;
}

/**
 * 目的: 成果物（results.json・summary.txt・run.json）を書き出す。秘密の値を含むときは書き出さない（要件 5.4）。
 * 入力: input(結果・設定の記録・秘密の値)。
 * 出力: 書き出し先のディレクトリ。
 * 失敗時の方針: 秘密の値が含まれていれば、例外を投げて書き出さない。
 */
async function writeArtifacts(input: ArtifactInput): Promise<string> {
  const dir = join(input.config.artifactsDir, new Date().toISOString().replace(/[:.]/g, "-"));
  await writeReport(dir, input.results, input.forbidden);
  const json = `${JSON.stringify(input.record, null, 2)}\n`;
  // JSON 内の表記（引用符や \ のエスケープ）も検査する（writeReport と同じ規則）
  const needles = input.forbidden.flatMap((secret) => [secret, JSON.stringify(secret).slice(1, -1)]);
  if (countForbidden(json, needles) > 0) {
    throw new Error("実行の記録に秘密の文字列が含まれるため、書き出しを中止した");
  }
  await writeFile(join(dir, "run.json"), json, "utf8");
  return dir;
}

/**
 * 目的: 準備の後に試験を実行し、設定を試験の前の値に戻し、結果を表示して成果物を書き出す。
 * 入力: config(設定)、session(準備の結果)、forbidden(秘密の値。成果物に含めない)。
 * 出力: 終了コード（0 は全て合格、1 は試験の失敗・復元の失敗・中断）。
 * 失敗時の方針: 試験の結果に関わらず、設定を必ず戻す。Ctrl-C は次の試験の前に止め、設定を戻してから終える。
 */
async function runVendorTests(config: LiveConfig, session: LiveSession, forbidden: readonly string[]): Promise<number> {
  const controller = new AbortController();
  const onInterrupt = (): void => {
    controller.abort();
    print("中断（Ctrl-C）を受け付けた。次の試験は行わず、設定を戻してから終える");
  };
  process.on("SIGINT", onInterrupt);
  try {
    const prerequisite = await ensureEgressPrerequisite(session.api);
    if (!prerequisite.ok) {
      print(`試験の前提の設定を有効にできない: ${prerequisite.reason}`);
      return 1;
    }

    const baselineIp = session.baseline.publicIp;
    const cases =
      session.vendor.vendor === "protonvpn"
        ? protonCases({ api: session.api, baselineIp, planId: session.vendor.planId })
        : adguardCases({ api: session.api, baselineIp });

    let results: TestResult[] = [];
    let restore: RestoreResult = { ok: true };
    try {
      results = await runCases(cases, { api: session.api, signal: controller.signal });
    } finally {
      restore = await restoreSettings(session.api, prerequisite.snapshot, prerequisite.changed);
    }

    printResults(results);
    if (!restore.ok) {
      for (const item of restore.failed) {
        print(`設定 ${item.name} を ${String(item.recorded)} に戻せなかった。管理画面で手により直す`);
      }
    }

    const failed = results.some((result) => result.outcome === "fail");
    const state = failed ? await snapshotState(session.api) : undefined;
    const dir = await writeArtifacts({
      config,
      results,
      forbidden,
      record: {
        apiBaseUrl: config.apiBaseUrl,
        vendor: session.vendor.vendor,
        baseline: session.baseline,
        settings: {
          snapshot: prerequisite.snapshot,
          changed: prerequisite.changed,
          restored: restore.ok,
          failed: restore.ok ? [] : restore.failed,
        },
        state,
      },
    });
    print(`成果物: ${dir}`);

    const interrupted = controller.signal.aborted;
    return failed || !restore.ok || interrupted ? 1 : 0;
  } finally {
    process.off("SIGINT", onInterrupt);
  }
}

/**
 * 目的: 入口。設定を読み、ベンダーを選び、準備処理の後に試験を実行する。
 * 出力: 終了コード。
 */
async function main(): Promise<number> {
  let config: LiveConfig;
  try {
    config = loadConfig(process.env, process.argv[2] ?? DEFAULT_CONFIG_PATH);
  } catch (error) {
    print(`準備の中止: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  // 端末で入力された秘密の値（管理者とベンダーの資格情報・2FA）。成果物に含めないために覚えておく
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
    const vendor = await chooseVendor();
    outcome = await prepare(config, vendor, { io, fetchPublicIp: () => fetchPublicIp(), now: () => new Date() });
  } catch (error) {
    // 準備の途中の入力の中断（Ctrl-C など）。試験の設定はまだ変えていないので、戻す必要はない
    print(`準備を中断した: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  if (!outcome.ok) {
    print(`準備の中止（${outcome.step}）: ${describeAbort(outcome.reason)}`);
    return 2;
  }
  return runVendorTests(config, outcome.session, entered.filter((value) => value !== ""));
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    print(`想定外の失敗: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  },
);
