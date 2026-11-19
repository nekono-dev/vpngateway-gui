# 統合検証記録（task 8.2）

最終更新: 2026-11-19 06:24 UTC

## (a) deploy-verify

- 実施: `sh scripts/test-deploy-verify.sh`（`scripts/deploy-verify.sh static` を clean env で実行）。2026-11-19 06:26:17–06:26:33 UTC、終了 status 0。
- 結果: root Compose + 16 vendor/TLS config 組合せ、project 名/優先順位/別名 volume、host-preparation CLI/test、Compose contract/TLS contract、bundle shellcheck が PASS。壊れた bundle の proxy service 削除を検出し非0終了。
- 検査: bundle build/extract、root と vendor/TLS の16 Compose 組合せ、project 固定・優先順位・volume 名、公開 port・TLS mount・UDS volume、host-preparation の CLI/テスト、Compose 契約、配布 shell の ShellCheck。
- 異常系: 抽出 bundle の `docker-compose.yml` から proxy service を削除して再検査し、非0終了を確認。`VERIFY_SSH_PASSWORD` が process argument にならず `SSHPASS` 環境で `sshpass -e` に渡されることを静的に確認。
- `lab` はこのローカル作業では未実行。実機受入タスクが `acceptance-env.md` の LXD lab を担当する。

## (b) root・workspace テストと build

2026-11-19 の実行結果（すべて status 0）:

| 時刻 (UTC) | コマンド | 結果 |
|---|---|---|
| 06:31:46–06:32:18 | `npm test` | proxy 40 files / 367 tests、API 76 / 609、Web 44 / 312、Web server 3 / 23。合計 163 files / 1,311 tests。neutrality OK、host-preparation shell suite と deploy-verify static suite PASS |
| 06:32:18–06:32:40 | `npm run build` | proxy/API TypeScript build と Web Vite production build PASS |
| 06:23:43 | `npm run test:e2e-unit` | 22 files / 139 tests PASS |

`npm test` は package unit tests、`web test:server`、neutrality、`test:install` runner を実行する。追加した `api/src/schemas/settings.test.ts` は API 件数に含まれる。

## OpenAPI / Web generated API client

- 再生成コマンド: `npm run generate:api-client`（API schema export と Web Orval generate の公式手順）。
- 確認: `api/openapi.json` と `web/src/generated/` は git-ignored build output。再現時は上記コマンドを実行し、`npm run build`、`npm run test -w web`、`npm run test:server -w web` を確認する。
- 2026-11-19 06:22:34 UTC に再生成。`api/openapi.json` と `web/src/generated/api/endpoints.schemas.ts` に `gatewayGuard`、`gateway_protection_mismatch`、connection config の 503 `kill_switch_not_applied` / `gateway_setting_not_applied` が含まれることを確認した。設定適用時の proxy 内部 503 `guard_apply_failed` は API が `kill_switch_not_applied` へ変換するため API generated client の応答コードとしては含めない。
- Orval は `gatewayGuard.lastUpdatedAt` の nullable `anyOf` について Swagger schema validation warning を出すが、生成を完了し、build/tests は通過した。schema 表現の整理は別途確認事項。

## (c) GitHub-hosted runner の hosted E2E

**to be filled after the hosted CI run**。controller が実行する workflow URL、commit、5.3〜5.5 および 5.7 の spec ごとの結果を追記する。実 VPN 資格情報を使う 5.6 vendor-live はこの対象外。
