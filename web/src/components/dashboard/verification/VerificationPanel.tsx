// 責務: 設定ダイアログの「動作検証」タブの内容。実行ボタン・結果の要約・全体の進捗バー・3つのグループ（既定は折りたたみ）・
// 対象外の項目・IP確認サービスのURLの入力欄を表示する（webserver/design.md「設定の動作検証の実装方針」）。
// 検証の操作と状態はuseVerification（設定ダイアログが保持する）から受け取り、本部品は表示とグループの開閉のみを持つ。

import { useState } from "react";
import { StatusIcon } from "./StatusIcon";
import {
  GROUPS,
  STATE_LABELS,
  displayStateOf,
  summarizeGroup,
  totalsOf,
  type GroupId,
  type GroupSummary,
  type Verification,
  type VerificationCheck,
} from "./verification-view";

interface Props {
  verification: Verification | undefined;
  isStarting: boolean;
  error: string | undefined;
  onStart: () => void;
  // 未保存の変更があるか（検証は保存済みの設定に対して行う旨を示す）。
  hasUnsavedChanges: boolean;
  echoUrl: string;
  onEchoUrlChange: (value: string) => void;
}

function CheckDetail({ check }: { check: VerificationCheck }) {
  if (check.status === "pass") return check.observed ? <span className="verify-observed">{check.observed}</span> : null;
  if (check.status === "fail") {
    return (
      <div className="verify-detail verify-detail-fail">
        {check.expected ? <span><b>期待:</b> {check.expected}</span> : null}
        {check.observed ? <span><b>観測:</b> {check.observed}</span> : null}
        {check.hint ? <span><b>対処:</b> {check.hint}</span> : null}
      </div>
    );
  }
  if (check.status === "unconfirmed") {
    return (
      <div className="verify-detail verify-detail-unconfirmed">
        {check.reason ? <span><b>状況:</b> {check.reason}</span> : null}
        {check.hint ? <span><b>対処:</b> {check.hint}</span> : null}
      </div>
    );
  }
  return null;
}

function CheckRow({ check }: { check: VerificationCheck }) {
  const state = displayStateOf(check.status);
  return (
    <li className={`verify-row verify-state-${state}`}>
      <StatusIcon state={state} />
      <div className="verify-row-body">
        <span className="verify-name">{check.title}</span>
        <CheckDetail check={check} />
      </div>
      <span className="verify-label">{STATE_LABELS[state]}</span>
    </li>
  );
}

function GroupBody({ summary, expanded, started }: { summary: GroupSummary; expanded: boolean; started: boolean }) {
  if (!started) return <p className="verify-group-note">未実行</p>;
  if (summary.checks.length === 0) return <p className="verify-group-note">対象の項目はありません</p>;
  if (expanded) {
    return (
      <ul className="verify-rows">
        {summary.checks.map((check) => (
          <CheckRow key={check.id} check={check} />
        ))}
      </ul>
    );
  }
  if (summary.representative !== undefined) {
    return (
      <ul className="verify-rows">
        <CheckRow check={summary.representative} />
      </ul>
    );
  }
  if (summary.state === "pass") {
    return <p className="verify-group-note verify-group-note-pass">すべてOK（{summary.done}/{summary.checks.length}）</p>;
  }
  return <p className="verify-group-note">待機中（{summary.checks.length}項目）</p>;
}

function Group({ id, label, checks, started }: { id: GroupId; label: string; checks: readonly VerificationCheck[]; started: boolean }) {
  // 既定は閉じる。実行中のグループも自動では開かない（開閉は利用者が行う）。
  const [expanded, setExpanded] = useState(false);
  const summary = summarizeGroup(checks, id);
  const bodyId = `verify-group-${id}`;
  return (
    <section className={`verify-group verify-state-${summary.state}`} aria-label={label}>
      <button
        type="button"
        className="verify-group-header"
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={() => setExpanded((value) => !value)}
      >
        <StatusIcon state={summary.state} />
        <span className="verify-group-name">{label}</span>
        <span className="verify-badges" hidden={!started}>
          {summary.failCount > 0 ? <span className="verify-badge verify-badge-fail">NG {summary.failCount}</span> : null}
          {summary.unconfirmedCount > 0 ? (
            <span className="verify-badge verify-badge-unconfirmed">未確認 {summary.unconfirmedCount}</span>
          ) : null}
          <span className="verify-badge">
            {summary.done} / {summary.checks.length}
          </span>
        </span>
        <svg className="verify-chevron" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div id={bodyId} className="verify-group-body">
        <GroupBody summary={summary} expanded={expanded} started={started} />
      </div>
    </section>
  );
}

export function VerificationPanel({ verification, isStarting, error, onStart, hasUnsavedChanges, echoUrl, onEchoUrlChange }: Props) {
  const checks = verification?.checks ?? [];
  const totals = totalsOf(checks);
  const running = isStarting || verification?.state === "running";
  const completed = verification?.state === "completed";
  const notApplicable = checks.filter((check) => check.status === "notApplicable");
  const percent = (count: number): string => (totals.total === 0 ? "0%" : `${(count / totals.total) * 100}%`);

  return (
    <div className="verify-panel">
      <p className="hint">現在の設定に基づいて、有効な機能が実際に動作しているかを確認します。VPNの接続や設定は変更しません。</p>

      <div className="verify-actions">
        <button type="button" className="primary verify-run" disabled={running} onClick={onStart}>
          {running ? (
            <>
              <StatusIcon state="running" />
              実行中 {totals.done}/{totals.total}
            </>
          ) : completed ? (
            "もう一度実行"
          ) : (
            "検証を実行"
          )}
        </button>
        {completed ? (
          <span className="verify-summary">
            <span className="verify-summary-pass">OK {totals.pass}件</span>
            {totals.fail > 0 ? <span className="verify-summary-fail">NG {totals.fail}件</span> : null}
            {totals.unconfirmed > 0 ? <span className="verify-summary-unconfirmed">未確認 {totals.unconfirmed}件</span> : null}
          </span>
        ) : null}
      </div>
      {hasUnsavedChanges ? <p className="restriction">保存済みの設定で検証します（未保存の変更は反映されません）。</p> : null}
      {error ? <p role="alert">{error}</p> : null}

      <div>
        <div
          className="verify-progress"
          role="progressbar"
          aria-label="検証の進捗"
          aria-valuemin={0}
          aria-valuemax={totals.total}
          aria-valuenow={totals.done}
        >
          <i className="verify-progress-pass" style={{ width: percent(totals.pass) }} />
          <i className="verify-progress-fail" style={{ width: percent(totals.fail) }} />
          <i className="verify-progress-unconfirmed" style={{ width: percent(totals.unconfirmed) }} />
        </div>
        <div className="verify-progress-caption">
          <span>{verification === undefined ? "未実行" : completed ? "完了" : "実行中"}</span>
          <span>
            {totals.done} / {totals.total}
          </span>
        </div>
      </div>

      <div className="verify-groups">
        {GROUPS.map((group) => (
          // 検証を実行し直すたびに、グループの開閉を既定（閉じる）へ戻す。
          <Group key={`${verification?.id ?? "none"}-${group.id}`} id={group.id} label={group.label} checks={checks} started={verification !== undefined} />
        ))}
      </div>

      {notApplicable.length > 0 ? (
        <details className="verify-not-applicable">
          <summary>対象外の項目（{notApplicable.length}件）</summary>
          <ul>
            {notApplicable.map((check) => (
              <li key={check.id}>
                {check.title}（{check.reason}）
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <label>
        IP確認サービスのURL
        <input type="text" placeholder="https://api.ipify.org" value={echoUrl} onChange={(event) => onEchoUrlChange(event.target.value)} />
      </label>
      <p className="hint">
        ゲートウェイと、この画面を開いているブラウザの双方が、出口IPの取得に使います。ブラウザからの接続（CORS）を許可し、IPv4アドレスのみを返すサービスを指定してください。
      </p>
    </div>
  );
}
