// 責務: Phase 28（Web UI利用者認証の専用E2E）を実ブラウザ（Playwright）で検証する。
// 他phaseの`launch()`（E2E共通アカウントで初期設定・ログインを自動的に済ませる）とは異なり、
// `launchWithoutSignIn()`を使い、認証フローそのもの（初回アクセス時の画面表示・正誤ログイン・
// ログアウト・セッション切れ・アカウント変更）を検証する。
// 実行前提: Web UI利用者アカウントが未作成の状態（`reset_operator_account`等でインストール直後の
// 未設定状態へ戻した直後）であること。既にアカウントが作成済みの環境で実行すると、初期設定画面の
// 検証（先頭）で失敗する。
// 実行: node e2e/phase28/webgui-operator-auth.mjs <baseUrl>

import { launchWithoutSignIn, assert } from "../lib/playwright.mjs";

const [baseUrl] = process.argv.slice(2);
const { browser, page } = await launchWithoutSignIn(baseUrl);

const USERNAME = "phase28-admin";
const PASSWORD = "phase28-password-1";
const NEW_PASSWORD = "phase28-password-2";

// ヘッダーの「ログアウト」ボタン（Web UI利用者のログアウト）。VPNベンダー側のログアウトボタン
// （SessionCard、VPNベンダーへログイン済みの間だけ表示）と同じ表示名のため、ヘッダーに絞り込む。
const header = () => page.locator("header.app-header");

try {
  // 未設定状態での初回アクセス
  await page.getByRole("heading", { name: "初期設定" }).waitFor({ timeout: 15000 });
  assert(true, "未設定の状態で初回アクセスすると初期設定画面が表示される");

  // パスワード確認不一致
  await page.getByLabel("ユーザー名").fill(USERNAME);
  await page.getByLabel("パスワード（4文字以上）").fill(PASSWORD);
  await page.getByLabel("パスワード（確認）").fill("mismatched-password");
  await page.getByRole("button", { name: "設定する" }).click();
  await page.getByRole("alert").filter({ hasText: "パスワードが一致しません" }).waitFor({ timeout: 5000 });
  assert(true, "パスワード確認が不一致だとエラーが表示され、設定できない");

  // 正しい入力での初期設定→ダッシュボード表示
  await page.getByLabel("パスワード（確認）").fill(PASSWORD);
  await page.getByRole("button", { name: "設定する" }).click();
  await page.getByRole("heading", { name: "VPNGateway-GUI" }).waitFor({ timeout: 15000 });
  assert(true, "正しい入力で初期設定が完了しダッシュボードが表示される");

  // ログアウト→ログイン画面への遷移
  await header().getByRole("button", { name: "ログアウト" }).click();
  await page.getByRole("heading", { name: "ログイン" }).waitFor({ timeout: 15000 });
  assert(true, "ログアウトするとログイン画面へ遷移する");

  // 誤ったパスワードでのログイン失敗
  await page.getByLabel("ユーザー名").fill(USERNAME);
  await page.getByLabel("パスワード").fill("wrong-password");
  await page.getByRole("button", { name: "ログイン" }).click();
  await page.getByRole("alert").filter({ hasText: "ユーザー名またはパスワードが正しくありません" }).waitFor({ timeout: 5000 });
  assert(true, "誤ったパスワードでのログインは失敗し、エラーが表示される");

  // 正しいパスワードでのログイン成功
  await page.getByLabel("パスワード").fill(PASSWORD);
  await page.getByRole("button", { name: "ログイン" }).click();
  await page.getByRole("heading", { name: "VPNGateway-GUI" }).waitFor({ timeout: 15000 });
  assert(true, "正しいパスワードでログインするとダッシュボードが表示される");

  // セッション切れ（セッションCookieが無効になった状態）→ログイン画面への遷移
  // （このアプリのセッションはAPIプロセスのメモリ保持のみでTTLを持たないため、Cookie側から
  // 見た「無効なセッション」を模擬する。AuthContext側の検知経路はTTL失効時と同じ401判定）。
  await page.context().clearCookies();
  await page.reload();
  await page.getByRole("heading", { name: "ログイン" }).waitFor({ timeout: 15000 });
  assert(true, "セッションが無効な状態でアクセスするとログイン画面へ戻る");

  // 再ログイン（以降のアカウント変更検証のため）
  await page.getByLabel("ユーザー名").fill(USERNAME);
  await page.getByLabel("パスワード").fill(PASSWORD);
  await page.getByRole("button", { name: "ログイン" }).click();
  await page.getByRole("heading", { name: "VPNGateway-GUI" }).waitFor({ timeout: 15000 });

  // アカウント変更ダイアログを開く
  await page.getByRole("button", { name: "設定", exact: true }).click();
  const settingsDialog = page.getByRole("dialog", { name: "設定" });
  await settingsDialog.getByRole("tab", { name: "通信制御" }).waitFor({ timeout: 15000 });
  await settingsDialog.getByRole("button", { name: "アカウント情報を変更" }).click();
  const accountDialog = page.getByRole("dialog", { name: "アカウント設定" });
  await accountDialog.waitFor({ timeout: 15000 });

  // 誤った現在パスワードでは変更できない
  await accountDialog.getByLabel("現在のパスワード").fill("wrong-current-password");
  await accountDialog.getByLabel(/新しいパスワード/).fill(NEW_PASSWORD);
  await accountDialog.getByRole("button", { name: "アカウントを変更" }).click();
  await accountDialog.getByRole("alert").filter({ hasText: "現在のパスワードが正しくありません" }).waitFor({ timeout: 5000 });
  assert(true, "誤った現在パスワードではアカウントを変更できない");

  // 正しい現在パスワードでパスワードを変更できる
  await accountDialog.getByLabel("現在のパスワード").fill(PASSWORD);
  await accountDialog.getByLabel(/新しいパスワード/).fill(NEW_PASSWORD);
  await accountDialog.getByRole("button", { name: "アカウントを変更" }).click();
  await accountDialog.getByRole("status").filter({ hasText: "変更しました" }).waitFor({ timeout: 5000 });
  assert(true, "正しい現在パスワードで新しいパスワードに変更できる");
  await accountDialog.getByRole("button", { name: "閉じる" }).click();
  await settingsDialog.getByRole("button", { name: "キャンセル" }).click();

  // 変更後のパスワードでログインできることを確認する
  await header().getByRole("button", { name: "ログアウト" }).click();
  await page.getByRole("heading", { name: "ログイン" }).waitFor({ timeout: 15000 });
  await page.getByLabel("ユーザー名").fill(USERNAME);
  await page.getByLabel("パスワード").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "ログイン" }).click();
  await page.getByRole("heading", { name: "VPNGateway-GUI" }).waitFor({ timeout: 15000 });
  assert(true, "変更した新しいパスワードでログインできる");
} finally {
  await browser.close();
}
