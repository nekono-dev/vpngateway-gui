// 責務: ベンダーCLIの実行結果が成功かどうかの判定。
// 終了コード0を成功とするが、アクションにsuccessPatternがあれば、終了コードが0以外でも出力が一致すれば成功とみなす
// （Proton VPN CLIの`disconnect`は、実際の接続を切断できても終了コード1を返すため）。

import type { ActionDef } from "./profile.schema.js";

export function isCommandSuccess(
  action: Pick<ActionDef, "successPattern">,
  result: { exitCode: number | null; stdout: string; stderr: string },
): boolean {
  if (result.exitCode === 0) return true;
  if (action.successPattern === undefined) return false;
  return new RegExp(action.successPattern, "m").test(`${result.stdout}\n${result.stderr}`);
}
