// 責務: 端末の入力と表示。資格情報と 2FA のコードは入力中の文字を表示しない（要件 1.3・2.2）。承認の案内を表示する（要件 3.1）。

import { createInterface } from "node:readline";
import { Writable } from "node:stream";

/**
 * 目的: 入力中の文字を表示せずに 1 行を受け取る（ユーザー名・パスワード・2FA のコード）。
 * 入力: label(表示する見出し。秘密の値は含めない)。
 * 出力: 入力された行（改行を除く）。
 * 失敗時の方針: 対話端末（TTY）でなければ例外を投げる（パイプから秘密を受け取らない）。
 */
export function promptHidden(label: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return Promise.reject(new Error("対話端末（TTY）が必要。資格情報はパイプやファイルから受け取らない"));
  }
  let muted = false;
  // 入力のエコーを出力に流さない（muted の間は表示しない）
  const output = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      if (!muted) process.stdout.write(chunk);
      callback();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  process.stdout.write(label);
  muted = true;
  return new Promise((resolve, reject) => {
    // 回答の前に閉じた（Ctrl-C や入力の終わり）なら、待たずに失敗にする。解決の後の close は無視される
    rl.once("close", () => reject(new Error("入力が途中で閉じられた（Ctrl-C など）")));
    rl.question("", (answer) => {
      muted = false;
      process.stdout.write("\n");
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * 目的: 承認の URL と確認コードを端末に表示する（AdGuard の device 認証）。検証サーバの画面は開かない（要件 3.5）。
 * 入力: url(承認の URL)、code(確認コード。表示のみ)。
 */
export function showDeviceLogin(url: string, code: string | undefined): void {
  process.stdout.write("\n【AdGuard の承認】\n");
  process.stdout.write(`  開発者の別の端末のブラウザで次を開き、承認する: ${url}\n`);
  if (code !== undefined) process.stdout.write(`  確認コード: ${code}\n`);
  process.stdout.write("  承認が完了するまで待つ（上限 5 分）\n\n");
}

/**
 * 目的: 通常の案内・結果を表示する（秘密を含めないこと）。
 * 入力: message(表示する文字列)。
 */
export function print(message: string): void {
  process.stdout.write(`${message}\n`);
}

/**
 * 目的: 入力中の文字を表示して 1 行を受け取る（承認の確認など、秘密ではない応答）。
 * 入力: label(表示する見出し)。
 * 出力: 入力された行（改行を除く）。
 */
export function promptVisible(label: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY === true });
  return new Promise((resolve, reject) => {
    rl.once("close", () => reject(new Error("入力が途中で閉じられた（Ctrl-C など）")));
    rl.question(label, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}
