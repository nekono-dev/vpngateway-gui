// 責務: Phase 8（接続先選択UIの刷新）の完了基準を、実VPN・実proxyに接続したWeb UIをPlaywrightで操作して検証する。
// 実行: node e2e/phase8/webgui-locations.mjs <baseUrl> <step> [引数...]
//   list                    : 接続先が都市単位・ping昇順で表示される／再計測／設定ダイアログにデフォルト接続国が無い
//   filter                  : 国名・都市名の絞り込み
//   favorite <都市A> <都市B>: ★登録→「お気に入り」タブ（ping順）→再読み込み・別ブラウザでも保持→解除
//   connect <都市>          : リストで選択して接続（(Virtual)付きも可）。接続中バッジ・接続国表示・再読み込み後も保持
//   change <都市>           : 接続中に別の接続先を選ぶと［接続先を変更］が現れ、押すと切り替わる。同じ接続先では出ない
//   disconnect              : 切断
//   last <都市>             : 切断中に再読み込み→最後に接続した接続先が選択済み・「前回」。選択せず［接続］で接続できる
//   error-list              : proxy停止中に再計測→エラー＋再取得。接続中なら［切断］は可。復旧後の再取得で回復（PROXY_STOP_CMD/PROXY_START_CMD必須）
// 接続・切断はVPN確立を伴うため、待機上限は90秒とする。

import { execSync } from "node:child_process";
import { launch, assert } from "../lib/playwright.mjs";

const [baseUrl, step, ...args] = process.argv.slice(2);
const CONNECT_WAIT_MS = 90000;
const { browser, page } = await launch(baseUrl);

const rows = () => page.locator("li.location-item");
const rowOf = (city) => rows().filter({ has: page.locator(".location-name strong", { hasText: new RegExp(`^${city.replace(/[()]/g, "\\$&")}$`) }) });
const status = () => page.locator("strong.connection-label");

async function openDashboard() {
  await page.goto("/");
  await status().waitFor({ timeout: 30000 });
  await rows().first().waitFor({ timeout: 30000 });
}

/** リストの行（都市名で特定）を選択する。ラジオは視覚的に隠しているためラベルを押す。 */
async function selectCity(city) {
  await rowOf(city).locator("label.location-row").click();
  assert(await rowOf(city).locator("input[type=radio]").isChecked(), `${city}が選択状態になる`);
}

async function pingValues() {
  const texts = await rows().locator(".location-ping").allInnerTexts();
  return texts.map((text) => (text.trim() === "-" ? undefined : Number.parseInt(text, 10)));
}

try {
  await openDashboard();

  if (step === "list") {
    const count = await rows().count();
    assert(count >= 50, `接続先が都市単位で${count}件表示される（国コード62件ではなく都市単位）`);
    const pings = (await pingValues()).filter((ping) => ping !== undefined);
    assert(pings.every((ping, i) => i === 0 || pings[i - 1] <= ping), `ping値が昇順に並ぶ（先頭${pings[0]}ms〜末尾${pings.at(-1)}ms）`);
    assert((await rowOf("Tokyo").count()) === 1, "Tokyoが表示される");
    assert((await rowOf("Shanghai (Virtual)").count()) === 1, "(Virtual)付きの接続先が表示される");
    assert((await rows().locator(".location-iso").first().innerText()).length === 2, "国コードのバッジが表示される");

    const before = await pingValues();
    await page.getByRole("button", { name: "再計測" }).click();
    await page.getByRole("button", { name: "再計測" }).waitFor({ timeout: 30000 });
    assert((await rows().count()) === count, "再計測後も同じ件数が表示される");
    const after = await pingValues();
    console.log(`INFO: 再計測前後のping先頭3件 ${before.slice(0, 3)} → ${after.slice(0, 3)}`);

    await page.getByRole("button", { name: "設定", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "設定" });
    await dialog.getByText("Kill Switch").waitFor();
    assert((await dialog.getByText("デフォルト接続国").count()) === 0, "設定ダイアログにデフォルト接続国が存在しない");
    await page.getByRole("button", { name: "キャンセル" }).click();
  } else if (step === "filter") {
    const total = await rows().count();
    const box = page.getByRole("searchbox", { name: "接続先を絞り込み" });
    await box.fill("japan");
    assert((await rows().count()) === 1 && (await rowOf("Tokyo").count()) === 1, "「japan」で国名から絞り込める（Tokyoのみ）");
    await box.fill("VEGAS");
    assert((await rowOf("Las Vegas").count()) === 1, "都市名の大文字小文字を区別せず絞り込める");
    await box.fill("us vegas");
    assert((await rows().count()) === 1, "空白区切りの複数語はすべて満たす行だけに絞る");
    await box.fill("us");
    const usCount = await rows().count();
    assert(usCount >= 10 && usCount < total, `「us」で国コードから絞り込める（${usCount}件）`);
    await box.fill("zzzzzz");
    await page.getByText("該当する接続先がありません。").waitFor();
    assert(true, "該当なしの案内が出る");
    await box.fill("");
    assert((await rows().count()) === total, "絞り込みを消すと全件に戻る");
  } else if (step === "favorite") {
    const [cityA, cityB] = args;
    for (const city of [cityA, cityB]) {
      await rowOf(city).getByRole("button", { name: `${city}をお気に入りに追加` }).click();
      await rowOf(city).getByRole("button", { name: `${city}のお気に入りを解除` }).waitFor();
    }
    assert(true, `${cityA}・${cityB}に★を付けられる`);
    await page.getByRole("tab", { name: /お気に入り \(2\)/ }).click();
    const names = await rows().locator(".location-name strong").allInnerTexts();
    assert(names.length === 2 && names.includes(cityA) && names.includes(cityB), `「お気に入り」タブに登録した2件だけが出る: ${names}`);
    const pings = await pingValues();
    assert(pings[0] <= pings[1], `お気に入りもping昇順（${names[0]} ${pings[0]}ms → ${names[1]} ${pings[1]}ms）`);

    await page.reload();
    await rows().first().waitFor({ timeout: 30000 });
    await page.getByRole("tab", { name: /お気に入り \(2\)/ }).waitFor();
    assert(true, "再読み込み後もお気に入りが保持される");
    const other = await browser.newContext({ baseURL: baseUrl });
    const otherPage = await other.newPage();
    await otherPage.goto("/");
    await otherPage.getByRole("tab", { name: /お気に入り \(2\)/ }).waitFor({ timeout: 30000 });
    assert(true, "別ブラウザ（別コンテキスト）でもお気に入りが共通");
    await other.close();

    await page.getByRole("tab", { name: /お気に入り \(2\)/ }).click();
    for (const city of [cityA, cityB]) {
      await rowOf(city).getByRole("button", { name: `${city}のお気に入りを解除` }).click();
    }
    await page.getByText(/お気に入りはまだありません/).waitFor();
    assert(true, "解除して0件になると案内が出る");
  } else if (step === "connect") {
    const [city] = args;
    await selectCity(city);
    await page.getByText(`選択中の接続先:`).first().waitFor();
    await page.getByRole("button", { name: "接続", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "接続しました" }).waitFor({ timeout: CONNECT_WAIT_MS });
    assert(true, `${city}への接続で成功トーストが出る`);
    await status().filter({ hasText: "接続中" }).waitFor({ timeout: 30000 });
    assert((await rowOf(city).getByText("接続中", { exact: true }).count()) === 1, `${city}の行に「接続中」バッジが付く`);
    assert((await rowOf(city).getByText("前回", { exact: true }).count()) === 1, `${city}の行に「前回」バッジが付く`);
    await page.getByText(/接続国: /).waitFor();
    await page.reload();
    await rows().first().waitFor({ timeout: 30000 });
    await rowOf(city).getByText("接続中", { exact: true }).waitFor({ timeout: 30000 });
    assert(true, "再読み込み後も現在の接続先に「接続中」が付く（APIが接続先を保持）");
  } else if (step === "change") {
    const [city] = args;
    const current = await rows().filter({ hasText: "接続中" }).locator(".location-name strong").innerText();
    assert((await page.getByRole("button", { name: "接続先を変更" }).count()) === 0, "接続中の既定では［接続先を変更］は出ない");
    await selectCity(city);
    await page.getByRole("button", { name: "接続先を変更" }).waitFor();
    assert((await page.getByRole("button", { name: "切断", exact: true }).isVisible()), `${current}接続中に${city}を選ぶと［接続先を変更］が出て、［切断］も残る`);
    await selectCity(current);
    assert((await page.getByRole("button", { name: "接続先を変更" }).count()) === 0, "現在の接続先を選び直すと［接続先を変更］は消える");
    await selectCity(city);
    await page.getByRole("button", { name: "接続先を変更" }).click();
    await page.getByRole("status").filter({ hasText: "接続先を変更しました" }).waitFor({ timeout: CONNECT_WAIT_MS });
    assert(true, "［接続先を変更］で成功トーストが出る");
    await rowOf(city).getByText("接続中", { exact: true }).waitFor({ timeout: 30000 });
    assert((await rows().filter({ hasText: "接続中" }).count()) === 1, `接続中バッジが${city}に移り、1件だけになる`);
    assert((await page.getByRole("button", { name: "接続先を変更" }).count()) === 0, "変更後は［接続先を変更］が消える");
  } else if (step === "disconnect") {
    await page.getByRole("button", { name: "切断", exact: true }).click();
    await status().filter({ hasText: /^切断$/ }).waitFor({ timeout: CONNECT_WAIT_MS });
    assert((await rows().filter({ hasText: "接続中" }).count()) === 0, "切断で「接続中」バッジが消える");
  } else if (step === "last") {
    const [city] = args;
    assert(await rowOf(city).locator("input[type=radio]").isChecked(), `切断後に再読み込みしても、最後に接続した${city}が選択済み`);
    assert((await rowOf(city).getByText("前回", { exact: true }).count()) === 1, `${city}に「前回」バッジが付く`);
    await page.getByRole("button", { name: "接続", exact: true }).click();
    await status().filter({ hasText: "接続中" }).waitFor({ timeout: CONNECT_WAIT_MS });
    await rowOf(city).getByText("接続中", { exact: true }).waitFor({ timeout: 30000 });
    assert(true, `リストを選択せず［接続］だけで、最後の接続先（${city}）へ接続できる`);
  } else if (step === "error-list") {
    execSync(process.env.PROXY_STOP_CMD, { stdio: "ignore" });
    try {
      await page.getByRole("button", { name: "再計測" }).click();
      const alert = page.locator(".location-error");
      await alert.waitFor({ timeout: 40000 });
      assert((await alert.innerText()).includes("接続先の取得に失敗しました"), "proxy停止中の再計測で、リスト領域にエラーが出る");
      assert(await page.getByRole("button", { name: "再取得" }).isVisible(), "再取得ボタンが出る");
      assert(await page.getByRole("button", { name: "切断", exact: true }).isEnabled(), "接続中だった場合、取得失敗でも［切断］は押せる");
    } finally {
      execSync(process.env.PROXY_START_CMD, { stdio: "ignore" });
    }
    await page.waitForTimeout(8000);
    await page.getByRole("button", { name: "再取得" }).click();
    await rows().first().waitFor({ timeout: 40000 });
    assert(true, "proxy復旧後の再取得でリストが回復する");
  } else {
    throw new Error(`unknown step: ${step}`);
  }
} finally {
  await browser.close();
}
