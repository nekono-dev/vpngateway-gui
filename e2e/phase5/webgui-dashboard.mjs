// 責務: Phase 5（Web UI完成）の完了基準を、実VPN・実proxyに接続したWeb UIをPlaywrightで操作して検証する。
// 実行: node e2e/phase5/webgui-dashboard.mjs <baseUrl> <step> [引数...]
//   initial            : 稼働状況の初期表示（透過ゲートウェイ・明示的プロキシの実状態）と設定ダイアログの暫定表示
//                        （明示的プロキシの暫定表示はPhase 4で実状態表示へ置換済み。除外ドメインはPhase 6まで暫定）
//   flow <country>     : ログイン→国選択→接続→再読み込み後も接続国表示→透過ゲートウェイOFF/ON→状態確認→切断 の通し操作
//   log                : 接続ログダイアログに直前までの操作が新しい順で表示される
//   ks-off             : Kill Switch OFF+VPN未接続=稼働中（遮断なし）、ONに戻すと遮断中（切断状態で実施）
//   error-422 <country>: 実CLIの異常終了（接続中でないのに切断）でトーストに要約、詳細（stderr）が折りたたみに入る
//   error-502          : proxy停止中の操作で502トースト、稼働状況は取得失敗表示（環境変数PROXY_STOP_CMD/PROXY_START_CMDが必要）
//   screenshot <path>  : 現在のダッシュボードを撮影
// 稼働状況表示は5秒ポーリングで更新されるため、待機上限は余裕を持って20秒とする。

import { execSync } from "node:child_process";
import { launch, assert } from "../lib/playwright.mjs";

const [baseUrl, step, ...args] = process.argv.slice(2);
const POLL_WAIT_MS = 20000;
const { browser, page } = await launch(baseUrl);

/** 稼働状況カードの透過ゲートウェイ欄に指定テキストのバッジが出るまで待つ（明示的プロキシ欄の同名バッジと混同しない）。 */
async function expectGateway(text, description) {
  await page
    .getByTestId("status-transparent-gateway")
    .locator(".badge", { hasText: text })
    .waitFor({ timeout: POLL_WAIT_MS });
  assert(true, description);
}

async function openDashboard() {
  await page.goto("/");
  await page.locator("strong.connection-label").waitFor({ timeout: 30000 });
}

/** 設定ダイアログで指定チェックボックス（ラベル部分一致）を目的の状態にして保存する。 */
async function setCheckbox(labelText, checked) {
  await page.getByRole("button", { name: "設定", exact: true }).click();
  const box = page.getByRole("dialog", { name: "設定" }).getByLabel(labelText);
  await box.waitFor();
  await box.setChecked(checked);
  await page.getByRole("button", { name: "保存" }).click();
  await page.getByRole("dialog", { name: "設定" }).waitFor({ state: "hidden" });
}

try {
  await openDashboard();

  if (step === "initial") {
    const explicitProxyRow = page.getByTestId("status-explicit-proxy");
    await explicitProxyRow.locator(".badge").first().waitFor({ timeout: POLL_WAIT_MS });
    assert(
      (await page.getByText("未対応（Phase 4で対応予定）").count()) === 0,
      "明示的プロキシ欄に「未対応」の暫定表示が出ない（実状態の表示に置換済み）",
    );
    assert(
      /停止|稼働中|未構成|起動失敗|エラー/.test(await explicitProxyRow.innerText()),
      "明示的プロキシ欄に実状態（停止/稼働中等）が表示される",
    );
    await page.getByRole("button", { name: "設定", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "設定" });
    await dialog.getByText("Phase 6で対応予定").waitFor();
    assert(
      (await dialog.getByText("Phase 4で対応予定").count()) === 0,
      "設定ダイアログの明示的プロキシ欄に未対応の暫定表示が出ない（除外ドメイン欄のみPhase 6まで暫定表示）",
    );
    await page.getByRole("button", { name: "キャンセル" }).click();
  } else if (step === "flow") {
    const [country] = args;
    await page.getByRole("button", { name: "VPNベンダーへログイン" }).click();
    await page.locator(".login .hint").waitFor({ timeout: 30000 });
    assert(true, "ログインボタンで応答メッセージ（ログイン済みまたは認証URL）が表示される");

    await page.getByLabel("接続国").selectOption(country);
    await page.getByRole("button", { name: "接続", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "接続しました" }).waitFor({ timeout: 60000 });
    assert(true, "接続成功で成功トーストが表示される");
    await page.locator("strong.connection-label", { hasText: "接続中" }).waitFor({ timeout: 30000 });
    assert(
      await page.getByText(`接続国: ${country.toUpperCase()}`).isVisible(),
      "接続後、選択した国が「接続国」として表示される",
    );
    // 接続国はAPI側に永続化されているため、再読み込み（クライアントの状態を全て失う）後も表示される
    await page.reload();
    await page.getByText(`接続国: ${country.toUpperCase()}`).waitFor({ timeout: 30000 });
    assert(true, "ブラウザを再読み込みしても「接続国」が表示される");
    await expectGateway("稼働中", "接続後、透過ゲートウェイが「稼働中」表示に追従する");
    assert(
      (await page.locator(".status-list .hint", { hasText: "VPN IF:" }).innerText()).length > 0,
      "稼働中表示にVPNインターフェース名が併記される",
    );

    await setCheckbox("透過ゲートウェイモード", false);
    await expectGateway("停止", "透過ゲートウェイOFFで「停止」表示に追従する");
    await setCheckbox("透過ゲートウェイモード", true);
    await expectGateway("稼働中", "透過ゲートウェイONで「稼働中」表示に追従する");

    await page.getByRole("button", { name: "切断", exact: true }).click();
    await page.locator("strong.connection-label", { hasText: /^切断$/ }).waitFor({ timeout: 60000 });
    assert(true, "切断で画面が「切断」表示に切り替わる");
    assert(
      (await page.getByText(/接続国:/).count()) === 0,
      "切断後は接続国の暫定表示が消える",
    );
    await expectGateway("Kill Switchにより遮断中", "切断後、Kill Switch遮断中（VPN未接続）表示に追従する");
  } else if (step === "log") {
    await page.getByRole("button", { name: "接続ログ" }).click();
    const rows = page.getByRole("dialog", { name: "接続ログ" }).locator("tbody tr");
    await rows.first().waitFor();
    const texts = await rows.allInnerTexts();
    assert(texts.length >= 2, `接続ログに操作履歴が${texts.length}件表示される`);
    assert(texts[0].includes("切断"), "先頭（最新）は直前の「切断」操作");
    assert(texts.some((row) => row.includes("接続") && /[A-Z]{2}/.test(row)), "接続操作の行に接続国が表示される");
    await page.getByRole("button", { name: "閉じる" }).click();
  } else if (step === "ks-off") {
    await setCheckbox("Kill Switch", false);
    await expectGateway("稼働中", "Kill Switch OFF（フェイルオープン）では遮断中にならず「稼働中」表示になる");
    await setCheckbox("Kill Switch", true);
    await expectGateway("Kill Switchにより遮断中", "Kill Switch ONに戻すと遮断中表示になる");
  } else if (step === "error-422") {
    const [country] = args;
    await page.getByLabel("接続国").selectOption(country);
    await page.getByRole("button", { name: "接続", exact: true }).click();
    await page.locator("strong.connection-label", { hasText: "接続中" }).waitFor({ timeout: 60000 });
    // ポーリングによる表示更新を止め、UI上は「接続中」のまま実CLIだけを切断状態にする（切断ボタン押下時に実CLIを異常終了させるため）
    await page.route("**/api/v1/connection", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ json: { status: "connected" } });
      } else {
        await route.continue();
      }
    });
    const external = await page.request.put("/api/v1/connection", { data: { connect: false } });
    assert(external.status() === 200, "（準備）画面外から実CLIを切断した");
    await page.getByRole("button", { name: "切断", exact: true }).click();
    const toast = page.getByRole("alert").filter({ hasText: "切断に失敗しました" });
    await toast.waitFor({ timeout: 30000 });
    assert((await toast.innerText()).includes("exit code"), "422トーストの要約に「VPNコマンドが異常終了: exit code N」が出る");
    const details = toast.locator("details");
    assert((await details.getAttribute("open")) === null, "詳細（stderr）は折りたたまれている");
    await details.locator("summary").click();
    const stderrText = await details.locator("pre").innerText();
    assert(stderrText.trim().length > 0, `詳細を開くとstderrが表示される: ${stderrText.trim().slice(0, 80)}`);
    assert(!(await toast.locator("span").first().innerText()).includes(stderrText.trim()), "stderrは要約（通常表示）に含まれない");
  } else if (step === "error-502") {
    const [country] = args;
    await page.getByLabel("接続国").selectOption(country);
    execSync(process.env.PROXY_STOP_CMD, { stdio: "ignore" });
    try {
      await page.getByRole("button", { name: "接続", exact: true }).click();
      const toast = page.getByRole("alert").filter({ hasText: "プロキシサーバに接続できません" });
      await toast.waitFor({ timeout: 30000 });
      assert(true, "proxy停止中の接続操作で502トースト（プロキシサーバに接続できません）が表示される");
      await page.locator(".status-list [role=alert]").waitFor({ timeout: POLL_WAIT_MS });
      assert(true, "稼働状況欄は取得失敗を表示する");
    } finally {
      execSync(process.env.PROXY_START_CMD, { stdio: "ignore" });
    }
  } else if (step === "screenshot") {
    await page.screenshot({ path: args[0], fullPage: true });
    assert(true, `スクリーンショットを保存: ${args[0]}`);
  } else {
    throw new Error(`unknown step: ${step}`);
  }
} finally {
  await browser.close();
}
