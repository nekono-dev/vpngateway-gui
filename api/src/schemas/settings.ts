// 責務: ユーザ向け設定（Web UIから変更可能な運用設定）のTypeBoxスキーマ定義。
// apiserver/design.md「ユーザ向け設定の具体スキーマ」に対応する。
// Phase 1ではプロキシへの実反映は行わないが、design.mdの全項目をスキーマとして持たせる。

import { Type, type Static } from "@sinclair/typebox";

export const UserSettingsSchema = Type.Object({
  killSwitch: Type.Boolean(),
  excludedDomains: Type.Array(Type.String()),
  defaultCountry: Type.String(),
  transparentGatewayEnabled: Type.Boolean(),
  explicitProxyEnabled: Type.Boolean(),
  explicitProxyAllowedCidrs: Type.Array(Type.String()),
});
export type UserSettings = Static<typeof UserSettingsSchema>;

// PUTは部分更新を許可する（Web UIは設定ダイアログの全項目を一括送信する想定だが、
// スキーマとしては将来の部分更新にも対応できるようPartialにしておく）。
export const UserSettingsPatchSchema = Type.Partial(UserSettingsSchema);
export type UserSettingsPatch = Static<typeof UserSettingsPatchSchema>;
