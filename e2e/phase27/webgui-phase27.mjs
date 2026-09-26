// 責務: Phase 27（設定の動作検証）のWeb UIを、LAN端末役（p14-client）のブラウザでPlaywright検証する。ブラウザ自身の観測
// （IP確認サービスからの出口IPの取得、検証用の名前の解決による53番リダイレクトの確認）が、実際の経路で動くことを含めて確かめる。
// 実行: node e2e/phase27/webgui-phase27.mjs <baseUrl> <ok|ng> [スクリーンショットの出力先ディレクトリ] [画面幅]
//   ok: 全項目がOKになる状態で実行する（e2e/phase27/scenarios.sh Aと同じ設定・VPN接続中）
//     1. 「動作検証」タブに、実行ボタンと3つのグループ（未実行）、IP確認サービスのURLが出る
//     2. 実行中は、ボタンが無効（実行中 n/N）になり、閉じたグループには実行中の項目だけが「確認中…」で出る
//     3. 完了すると「もう一度実行」と要約（OK 13件）が出て、閉じたグループは「すべてOK（n/n）」になる
//     4. グループを開くと全項目が並び、この端末の出口IP・53番リダイレクトの通過がOK（ブラウザの観測が実際の経路で届いた）
//     5. 別のタブへ切り替えて戻っても結果が残り、ダイアログを閉じて開き直すと未実行へ戻る
//   ng: forwardチェーン末尾の遮断ルールを消した状態で実行する（呼び出し側が故障を注入しておく）
//     6. 要約にNGが出て、「設定の確認」グループのヘッダにNGの件数、閉じた状態で最初のNG（期待・観測・対処）が代表として出る
// 前提: ゲートウェイ役のWeb UIへ到達でき、Web UI利用者はE2E共通アカウント（lib/playwright.mjs）であること。

import { mkdirSync } from "node:fs";
import { launch, assert } from "../lib/playwright.mjs";

const [baseUrl, mode = "ok", shotDir, widthArg] = process.argv.slice(2);
const RUN_TIMEOUT_MS = 120_000;
const { browser, page } = await launch(baseUrl);
if (widthArg) await page.setViewportSize({ width: Number(widthArg), height: 900 });
if (shotDir) mkdirSync(shotDir, { recursive: true });
const shot = async (name) => {
  if (shotDir) await page.screenshot({ path: `${shotDir}/${name}.png`, fullPage: true });
};

async function openVerificationTab() {
  await page.getByRole("button", { name: "設定", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "設定" });
  await dialog.getByRole("tab", { name: /動作検証/ }).click();
  return dialog;
}

const group = (dialog, name) => dialog.getByRole("region", { name });

try {
  let dialog = await openVerificationTab();

  // 1. 実行前
  const runButton = dialog.getByRole("button", { name: "検証を実行" });
  assert(await runButton.isEnabled(), "実行前は「検証を実行」ボタンが押せる");
  for (const name of ["設定の確認", "ゲートウェイの通信確認", "この端末からの確認"]) {
    assert(await group(dialog, name).getByText("未実行").isVisible(), `実行前: ${name}は未実行`);
  }
  assert((await dialog.getByLabel("IP確認サービスのURL").inputValue()).startsWith("https://"), "IP確認サービスのURLが表示される");
  await shot(`${mode}-1-before`);

  // 2. 実行中
  await runButton.click();
  const running = dialog.getByRole("button", { name: /実行中 \d+\/\d+/ });
  await running.waitFor({ timeout: 10_000 });
  assert(await running.isDisabled(), "実行中はボタンが無効（実行中 n/N）");
  const runningRow = dialog.locator(".verify-row.verify-state-running");
  await runningRow.first().waitFor({ timeout: 10_000 });
  assert((await runningRow.count()) === 1, "閉じたグループに、実行中の項目が1つだけ表示される");
  assert(await runningRow.getByText("確認中…").isVisible(), "実行中の項目は「確認中…」");
  assert((await dialog.locator(".verify-row-body").count()) <= 3, "閉じている間は、各グループに代表の1行まで");
  await shot(`${mode}-2-running`);

  // 3. 完了
  await dialog.getByRole("button", { name: "もう一度実行" }).waitFor({ timeout: RUN_TIMEOUT_MS });
  await shot(`${mode}-3-completed`);

  if (mode === "ok") {
    assert(await dialog.getByText("OK 13件").isVisible(), "完了: 要約がOK 13件");
    assert((await dialog.getByText(/^NG \d+件$/).count()) === 0, "完了: NGは無い");
    for (const [name, total] of [["設定の確認", 5], ["ゲートウェイの通信確認", 6], ["この端末からの確認", 2]]) {
      assert(await group(dialog, name).getByText(`すべてOK（${total}/${total}）`).isVisible(), `完了: ${name}はすべてOK（${total}/${total}）`);
    }

    // 4. グループを開く
    const client = group(dialog, "この端末からの確認");
    await client.getByRole("button", { expanded: false }).click();
    assert(await client.getByRole("button", { expanded: true }).isVisible(), "グループのヘッダを押すと開く");
    const egressRow = client.locator(".verify-row", { hasText: "この端末の出口 IP" });
    assert(await egressRow.getByText("OK", { exact: true }).isVisible(), "この端末の出口IPがOK（ブラウザの出口IPがVPNの出口と一致）");
    const egress = await egressRow.locator(".verify-observed").textContent();
    console.log(`この端末の出口IP: ${egress}`);
    const redirectRow = client.locator(".verify-row", { hasText: "53番リダイレクトの通過" });
    assert(
      await redirectRow.getByText("この端末の問い合わせが、中継リゾルバへ誘導されたことを確認").isVisible(),
      "53番リダイレクトの通過: ブラウザの名前解決が誘導されたことを確認",
    );
    const gatewayGroup = group(dialog, "ゲートウェイの通信確認");
    await gatewayGroup.getByRole("button", { expanded: false }).click();
    assert((await gatewayGroup.locator(".verify-row").count()) === 6, "開いたグループには全項目（6件）が並ぶ");
    await shot(`${mode}-4-expanded`);
    await client.getByRole("button", { expanded: true }).click();
    assert(await client.getByText("すべてOK（2/2）").isVisible(), "もう一度押すと閉じる");

    // 5. タブの切り替え・ダイアログの開き直し
    await dialog.getByRole("tab", { name: "通信制御" }).click();
    await dialog.getByRole("tab", { name: /動作検証/ }).click();
    assert(await dialog.getByText("OK 13件").isVisible(), "別のタブへ切り替えて戻っても、結果が残る");
    await dialog.getByRole("button", { name: "キャンセル" }).click();
    dialog = await openVerificationTab();
    assert(await group(dialog, "設定の確認").getByText("未実行").isVisible(), "ダイアログを閉じて開き直すと、未実行へ戻る");
  } else {
    // 6. NGの表示
    assert(await dialog.getByText(/^NG 2件$/).isVisible(), "完了: 要約にNG 2件");
    const config = group(dialog, "設定の確認");
    assert(await config.getByText("NG 2", { exact: true }).isVisible(), "「設定の確認」のヘッダにNGの件数（NG 2）");
    const rows = config.locator(".verify-row");
    assert((await rows.count()) === 1, "閉じた状態では、代表の1行だけが出る");
    assert(await rows.getByText("透過ゲートウェイの構成").isVisible(), "代表は、グループ内で最初にNGになった項目");
    assert(await rows.getByText("期待:").isVisible() && (await rows.getByText("観測:").isVisible()) && (await rows.getByText("対処:").isVisible()),
      "NGの代表行に、期待・観測・対処が出る");
    assert(await group(dialog, "ゲートウェイの通信確認").getByText("すべてOK（6/6）").isVisible(), "他のグループはすべてOKのまま");
    await shot(`${mode}-4-ng-collapsed`);
  }
  console.log("PASS: すべての確認に合格");
} finally {
  await browser.close();
}
