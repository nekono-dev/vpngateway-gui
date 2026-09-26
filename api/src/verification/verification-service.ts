// 責務: 設定の動作検証の実行と結果の保持。設定から項目を決め、実行順に1項目ずつ実行し、項目ごとの状態を公開する
// （apiserver/design.md「設定の動作検証」の「実行」）。結果はメモリ上に直近5件のみ保持し、永続化しない。
// ゲートウェイとの通信・時刻・待機は注入する（単体テストのため）。

import { randomBytes, randomUUID } from "node:crypto";
import type { UserSettings } from "../schemas/settings.js";
import type { Verification, VerificationCheck } from "../schemas/verification.js";
import type { CheckNonceRecord, GatewayCheckInput, GatewayCheckResult } from "../proxy-client/proxy-client.js";
import type { AuditLogEntry } from "../schemas/audit-log.js";
import { VerificationRunningError } from "../errors.js";
import { CHECK_DEFINITIONS } from "./check-catalog.js";
import { judgeClientEgress, judgeDnsRedirect, type CheckResult } from "./client-judgements.js";

// 画面で進行が分かるよう、各項目を「実行中」として見せる最短の時間（検証の内容は待たせず、結果の公開だけを遅らせる）。
const MIN_RUNNING_MS = 400;
// ブラウザの出口IPの提出を、項目の順番が来てから待つ時間。
const CLIENT_EGRESS_WAIT_MS = 15_000;
// 検証名の受信を、項目の順番が来てから待つ時間と、確認の間隔。
const DNS_REDIRECT_WAIT_MS = 10_000;
const DNS_REDIRECT_POLL_MS = 500;
// 検証名の有効期間（秒）。
const CHECK_NONCE_TTL_SECONDS = 60;
// 検証名のドメイン。実在するドメイン配下の存在しない名前にする（`.invalid`等は、OSのリゾルバが問い合わせを出さずに
// ローカルで応答することがあるため使わない）。
const CHECK_NONCE_DOMAIN = "example.com";
const MAX_KEPT_VERIFICATIONS = 5;
const GATEWAY_UNREACHABLE = "ゲートウェイに接続できないため、確認できません。";

export interface VerificationDependencies {
  runGatewayCheck(input: GatewayCheckInput): Promise<GatewayCheckResult>;
  registerCheckNonce(name: string, ttlSeconds: number): Promise<void>;
  fetchCheckNonce(name: string): Promise<CheckNonceRecord | undefined>;
  appendAuditLog(entry: Omit<AuditLogEntry, "timestamp">): void;
  now(): number;
  sleep(ms: number): Promise<void>;
}

interface Job {
  view: Verification;
  // ブラウザが提出した出口IP（取得失敗はnull、未提出はundefined）。
  browserEgressIp: string | null | undefined;
  egressWaiters: (() => void)[];
  done: Promise<void>;
}

// 前の項目の結果のうち、後続の項目が使う値。
interface RunContext {
  tunnelIp?: string;
  bypassIp?: string;
}

function snapshot(view: Verification): Verification {
  return structuredClone(view);
}

function applyResult(check: VerificationCheck, result: CheckResult): void {
  check.status = result.status;
  for (const key of ["expected", "observed", "hint", "reason"] as const) {
    if (result[key] !== undefined) check[key] = result[key];
  }
}

export class VerificationService {
  private readonly jobs: Job[] = [];
  private running = false;

  constructor(private readonly deps: VerificationDependencies) {}

  /**
   * 目的: 検証を開始する。対象の項目を決め、53番リダイレクトの確認が対象なら検証名をゲートウェイへ登録してから返す
   *      （ブラウザが、応答を受け取った直後に検証名を解決できるようにするため）。項目の実行は応答後も続く。
   * 入力: settings(保存済みのユーザ向け設定)。
   * 出力: 開始直後の検証（全項目が待機中または対象外）。
   * 失敗時の方針: 実行中の検証があればVerificationRunningError（409）。検証名の登録に失敗しても開始し、その項目は未確認になる。
   */
  async start(settings: UserSettings): Promise<Verification> {
    if (this.running) throw new VerificationRunningError("a verification is already running");
    this.running = true;
    try {
      const checks: VerificationCheck[] = CHECK_DEFINITIONS.map((definition) => {
        const reason = definition.notApplicableReason(settings);
        return {
          id: definition.id,
          title: definition.title,
          group: definition.group,
          status: reason === undefined ? "pending" : "notApplicable",
          ...(reason === undefined ? {} : { reason }),
        };
      });
      const view: Verification = { id: randomUUID(), state: "running", startedAt: new Date(this.deps.now()).toISOString(), checks };
      if (checks.some((check) => check.id === "dns-redirect-path" && check.status === "pending")) {
        const dnsName = `vpngw-${randomBytes(8).toString("hex")}.${CHECK_NONCE_DOMAIN}`;
        try {
          await this.deps.registerCheckNonce(dnsName, CHECK_NONCE_TTL_SECONDS);
          view.clientProbe = { dnsName };
        } catch {
          // 登録できなければ、ブラウザに名前を渡さない（項目は未確認になる）。
        }
      }
      const job: Job = { view, browserEgressIp: undefined, egressWaiters: [], done: Promise.resolve() };
      this.jobs.push(job);
      if (this.jobs.length > MAX_KEPT_VERIFICATIONS) this.jobs.shift();
      job.done = this.execute(job, settings).finally(() => {
        this.running = false;
      });
      return snapshot(view);
    } catch (error) {
      this.running = false;
      throw error;
    }
  }

  /** 目的: 検証の進行・結果を返す。保持していない（古い・存在しない）IDはundefined。 */
  get(id: string): Verification | undefined {
    const job = this.jobs.find((candidate) => candidate.view.id === id);
    return job === undefined ? undefined : snapshot(job.view);
  }

  /**
   * 目的: ブラウザが取得した出口IPを受け取る（最初の提出のみ採用する）。
   * 入力: id(検証ID), ip(IPv4アドレス。取得に失敗した場合はnull。形式は呼び出し元で検証済み)。
   * 出力: 採用したらtrue、既に提出済みならfalse。検証が見つからなければundefined。
   */
  submitEgressIp(id: string, ip: string | null): boolean | undefined {
    const job = this.jobs.find((candidate) => candidate.view.id === id);
    if (job === undefined) return undefined;
    if (job.browserEgressIp !== undefined) return false;
    job.browserEgressIp = ip;
    for (const wake of job.egressWaiters.splice(0)) wake();
    return true;
  }

  /** 目的: 検証の完了を待つ（テスト用）。 */
  async whenDone(id: string): Promise<void> {
    await this.jobs.find((candidate) => candidate.view.id === id)?.done;
  }

  private async execute(job: Job, settings: UserSettings): Promise<void> {
    const context: RunContext = {};
    for (const check of job.view.checks) {
      if (check.status !== "pending") continue;
      check.status = "running";
      const startedAt = this.deps.now();
      let result: CheckResult;
      try {
        result = await this.runCheck(check.id, job, settings, context);
      } catch (error) {
        result = { status: "unconfirmed", reason: `確認中にエラーが発生しました（${error instanceof Error ? error.message : String(error)}）。` };
      }
      const elapsed = this.deps.now() - startedAt;
      if (elapsed < MIN_RUNNING_MS) await this.deps.sleep(MIN_RUNNING_MS - elapsed);
      applyResult(check, result);
    }
    job.view.state = "completed";
    job.view.finishedAt = new Date(this.deps.now()).toISOString();
    const count = (status: string): number => job.view.checks.filter((check) => check.status === status).length;
    this.deps.appendAuditLog({
      action: "verification_run",
      input: {
        checks: job.view.checks.filter((check) => check.status !== "notApplicable").length,
        pass: count("pass"),
        fail: count("fail"),
        unconfirmed: count("unconfirmed"),
      },
    });
  }

  private async runCheck(id: string, job: Job, settings: UserSettings, context: RunContext): Promise<CheckResult> {
    if (id === "client-egress") {
      await this.waitForEgress(job);
      return judgeClientEgress(job.browserEgressIp, context.tunnelIp);
    }
    if (id === "dns-redirect-path") return this.checkDnsRedirectPath(job);

    let outcome: GatewayCheckResult;
    try {
      outcome = await this.deps.runGatewayCheck({
        check: id,
        echoUrl: settings.verifyEchoUrl,
        ...(context.tunnelIp === undefined ? {} : { expectedEgressIp: context.tunnelIp }),
        ...(context.bypassIp === undefined ? {} : { bypassProbeIp: context.bypassIp }),
      });
    } catch {
      return { status: "unconfirmed", reason: GATEWAY_UNREACHABLE };
    }
    if (outcome.status === "pass" && outcome.value !== undefined) {
      if (id === "tunnel-egress") context.tunnelIp = outcome.value;
      if (id === "bypass-set") context.bypassIp = outcome.value;
    }
    // 項目IDと後続用の値（value）は、利用者向けの結果に含めない。
    const { status, expected, observed, hint, reason } = outcome;
    return { status, expected, observed, hint, reason };
  }

  private async waitForEgress(job: Job): Promise<void> {
    if (job.browserEgressIp !== undefined) return;
    await Promise.race([new Promise<void>((resolve) => job.egressWaiters.push(resolve)), this.deps.sleep(CLIENT_EGRESS_WAIT_MS)]);
  }

  private async checkDnsRedirectPath(job: Job): Promise<CheckResult> {
    const dnsName = job.view.clientProbe?.dnsName;
    if (dnsName === undefined) return { status: "unconfirmed", reason: "検証用の名前をゲートウェイへ登録できなかったため、確認できません。" };
    let record: CheckNonceRecord | undefined;
    for (let attempt = 0; attempt <= DNS_REDIRECT_WAIT_MS / DNS_REDIRECT_POLL_MS; attempt += 1) {
      try {
        record = await this.deps.fetchCheckNonce(dnsName);
      } catch {
        return { status: "unconfirmed", reason: GATEWAY_UNREACHABLE };
      }
      if (record?.received === true || attempt * DNS_REDIRECT_POLL_MS >= DNS_REDIRECT_WAIT_MS) break;
      await this.deps.sleep(DNS_REDIRECT_POLL_MS);
    }
    return judgeDnsRedirect(record);
  }
}
