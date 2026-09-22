// 責務: Phase 7（プロバイダ抽象化基盤・操作の実行可否によるUI制限）の完了基準を、モックプロバイダCLI
// （Proton VPN公式CLIの挙動を模擬）に接続したWeb UIをPlaywrightで操作して検証する。
// 実行: node e2e/phase7/webgui-provider.mjs <baseUrl> <step>
//   unauth   : 未ログイン。接続が「ログインしてください」の理由付きで無効、ログインフォームが出る
//   free     : 失敗するログイン→無料アカウントでログイン。プラン表示・接続先リストが理由の枠・自動接続・切断
//   paid     : ログアウト→有料アカウントでログイン。国単位の一覧・ping無し・再計測は理由付きで無効・接続・接続先変更
//   twofa    : 2FAが必要なアカウント（コード無しは失敗、有りは成功）
//   learned  : 判定では有料に見えるが実行すると無料版の制限に当たる状況。403をトーストで通知し、以後の一覧が理由の枠になる
// 前提: e2e/phase7/mock-scenarios.shが起動したモック構成（各ステップは順番に実行する前提の状態を引き継ぐ）。

import { launch, assert } from "../lib/playwright.mjs";

const [baseUrl, step] = process.argv.slice(2);
const SECRET = "mock-pass";
const { browser, page } = await launch(baseUrl);

const status = () => page.locator("strong.connection-label");
const accountLine = () => page.locator(".session-status");
const connectButton = () => page.getByRole("button", { name: "接続", exact: true });
const loginButton = () => page.getByRole("button", { name: "ログイン", exact: true });

async function openDashboard() {
  await page.goto("/");
  await status().waitFor({ timeout: 30000 });
}

/** ログインフォームへ入力して送信する。 */
async function submitLogin(username, password, twoFactorCode) {
  await page.getByLabel("ユーザー名").fill(username);
  await page.getByLabel("パスワード").fill(password);
  if (twoFactorCode) await page.getByLabel(/2段階認証コード/).fill(twoFactorCode);
  await loginButton().click();
}

/** 画面（DOM全体）に秘密が現れていないことを確認する。 */
async function assertNoSecretOnPage(description) {
  const html = await page.content();
  assert(!html.includes(SECRET), `${description}: パスワードが画面（DOM）に残らない`);
}

/** ログアウトする（確認ダイアログは承諾）。 */
async function logout() {
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "ログアウト" }).click();
  await accountLine().filter({ hasText: "未ログイン" }).waitFor({ timeout: 15000 });
}

try {
  await openDashboard();

  if (step === "unauth") {
    await accountLine().filter({ hasText: "未ログイン" }).waitFor({ timeout: 15000 });
    assert(true, "アカウントが「未ログイン」と表示される");
    assert(await page.getByLabel("パスワード").isVisible(), "ログインフォーム（入力型）が表示される");
    assert(await connectButton().isDisabled(), "［接続］が無効になる");
    assert(
      (await page.locator("#connect-restriction").innerText()).includes("ログインしてください"),
      "［接続］の無効の理由「ログインしてください」が表示される",
    );
    assert((await page.locator("li.location-item").count()) === 0, "接続先リストは表示されない");
    assert(await loginButton().isDisabled(), "入力が空の間はログインを送信できない");
  } else if (step === "free") {
    // 1) パスワード違い → 失敗。パスワード欄は空になり、画面にも残らない
    await submitLogin("free@example.com", "wrong-pass");
    await page.getByText(/ログインに失敗しました/).first().waitFor({ timeout: 15000 });
    assert((await page.getByLabel("パスワード").inputValue()) === "", "ログイン失敗後、パスワード欄が空になる");
    assert((await page.getByLabel("ユーザー名").inputValue()) === "free@example.com", "ユーザー名は残る（再入力の手間を避ける）");
    await assertNoSecretOnPage("失敗後");

    // 2) 正しい資格情報 → 無料プラン
    await submitLogin("free@example.com", SECRET);
    await accountLine().filter({ hasText: "ログイン済み（プラン: Free）" }).waitFor({ timeout: 15000 });
    assert(true, "ログイン後、プラン「Free」が表示される");
    await assertNoSecretOnPage("成功後");
    assert((await page.getByLabel("パスワード").count()) === 0, "ログイン済みの間はログインフォームが消える");

    // 3) 無料プラン: 一覧が理由の枠に置き換わる（消えるのではなく理由が表示される）
    await page.getByText("無料プランでは接続先を選べません").first().waitFor({ timeout: 15000 });
    assert((await page.locator("li.location-item").count()) === 0 && (await page.getByRole("tablist").count()) === 0, "接続先リスト（タブ・行）は表示されず、理由の枠に置き換わる");

    // 4) 自動接続（接続先を指定しない）
    await connectButton().waitFor({ timeout: 15000 });
    assert(await connectButton().isEnabled(), "自動接続として［接続］が使える");
    await connectButton().click();
    await status().filter({ hasText: "接続中" }).waitFor({ timeout: 30000 });
    assert(true, "接続中になる");
    const connection = await (await page.request.get("/api/v1/connection")).json();
    assert(connection.status === "connected" && connection.location === "JP-FREE#5 in Tokyo, Japan" && connection.locationId === undefined,
      `APIが接続先IDなし・CLIの接続先（${connection.location}）を返す`);
    await page.getByRole("button", { name: "切断", exact: true }).click();
    await status().filter({ hasText: "切断" }).waitFor({ timeout: 30000 });
    assert(true, "切断できる");
  } else if (step === "paid") {
    await logout();
    assert(true, "ログアウトで「未ログイン」に戻る");
    await submitLogin("paid@example.com", SECRET);
    await accountLine().filter({ hasText: "ログイン済み（プラン: Paid）" }).waitFor({ timeout: 15000 });
    assert(true, "有料アカウントでログインするとプラン「Paid」が表示される");
    await page.locator("li.location-item").first().waitFor({ timeout: 15000 });
    assert((await page.locator("li.location-item").count()) === 4, "国単位の一覧（4か国）が表示される");
    assert((await page.locator(".location-ping").count()) === 0, "ping値の列は表示されない（プロバイダがpingを提供しない）");
    assert(await page.getByRole("button", { name: "再計測" }).isDisabled(), "［再計測］は無効");
    assert((await page.locator("#refresh-restriction").innerText()).includes("利用できません"), "［再計測］の無効の理由が表示される");

    await page.locator("li.location-item", { hasText: "Japan" }).locator("label.location-row").click();
    await connectButton().click();
    await status().filter({ hasText: "接続中" }).waitFor({ timeout: 30000 });
    let connection = await (await page.request.get("/api/v1/connection")).json();
    assert(connection.locationId === "jp-japan" && connection.country === "jp", `国を指定して接続し、APIが接続先ID・国を返す（${JSON.stringify(connection)}）`);

    // 接続先変更（有料のみ）
    await page.locator("li.location-item", { hasText: "Switzerland" }).locator("label.location-row").click();
    const changeButton = page.getByRole("button", { name: "接続先を変更" });
    await changeButton.waitFor({ timeout: 10000 });
    await changeButton.click();
    await page.getByText("接続先を変更しました").waitFor({ timeout: 30000 });
    connection = await (await page.request.get("/api/v1/connection")).json();
    assert(connection.locationId === "ch-switzerland" && connection.location.startsWith("CH#12"), `接続先を変更できる（${connection.location}）`);
    await page.getByRole("button", { name: "切断", exact: true }).click();
    await status().filter({ hasText: "切断" }).waitFor({ timeout: 30000 });
  } else if (step === "twofa") {
    await logout();
    await submitLogin("free2fa@example.com", SECRET);
    await page.getByText(/ログインに失敗しました/).first().waitFor({ timeout: 15000 });
    assert((await accountLine().innerText()).includes("未ログイン"), "2FAコード無しではログインできない");
    await submitLogin("free2fa@example.com", SECRET, "123456");
    await accountLine().filter({ hasText: "ログイン済み（プラン: Free）" }).waitFor({ timeout: 15000 });
    assert(true, "2FAコード付きでログインできる");
    await assertNoSecretOnPage("2FAログイン後");
  } else if (step === "learned") {
    // 事前（シェル側）: 無料アカウントでログインした状態で、判定用の表示プランだけを有料へ食い違わせてある。
    await page.locator("li.location-item").first().waitFor({ timeout: 30000 });
    assert(true, "判定では有料に見えるため、接続先リストが表示される");
    await page.locator("li.location-item", { hasText: "Japan" }).locator("label.location-row").click();
    await connectButton().click();
    await page.getByText(/現在のプランでは利用できない操作です/).first().waitFor({ timeout: 30000 });
    assert(true, "403（プラン制限）が、通常の失敗と区別した文言で通知される");
    await page.getByText("現在のプランでは利用できない操作です").last().waitFor({ timeout: 15000 });
    await page.waitForFunction(() => document.querySelectorAll("li.location-item").length === 0, undefined, { timeout: 20000 });
    assert(true, "実行可否の再取得により、接続先リストが理由の枠に置き換わる（学習した制限がUIへ反映される）");
    const caps = (await (await page.request.get("/api/v1/connection/capabilities")).json()).capabilities;
    assert(caps.connectToLocation.reason === "planRestricted" && caps.connectAuto.available, "APIのcapabilityがplanRestricted、自動接続は可");
  } else {
    throw new Error(`unknown step: ${step}`);
  }
} finally {
  await browser.close();
}
