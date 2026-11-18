# 旧方式参照と変更対象の棚卸し

## 目的と調査方法

この一覧は single-node-deployment の後続タスクが対象ファイルを選び、責務の重複を避けるための基準である。旧方式の参照を含むファイルも、すべて削除対象とは限らない。特に DoH URL、外部サービス URL、製品内で維持する Kill Switch の動作は、同じ検索語に一致しても本仕様の撤去対象ではない。

2026-11-18 にリポジトリルートで次の検索を実施した（依存物と lockfile を除外）。

```sh
rg -n -i 'https?://|api.?ca|web.?ca|tls|certificate|certificates|pki|installer|vpngwgui-ctl|sshpass|\bscp\b|\bssh\b|role|pairing' --glob '!node_modules/**' --glob '!*.lock' .
rg -n -i 'kill.?switch|killSwitch|installer|vpngwgui-ctl|api.?ca|https?://|SSH|SCP|pairing|role' web/src api/src .github e2e/vendor-live e2e/hosted package.json README.md docker-compose.yml compose installer
```

検索結果は既存の API/Web/Gateway TLS、DoH・外部検証 URL、旧 installer・分離配置、Kill Switch UI/API、hosted と vendor-live E2E、配布 workflow に分類した。以下は旧方式との関係があり、この仕様の後続作業で確認・更新・撤去するファイルである。無関係な TLS 機能（DoH/upstream、ISP 模擬、一般的なテスト URL 等）は対象境界に含めない。

## 境界別対象ファイルと所有タスク

### root Compose とホスト準備（2.1–2.8、6.4）

- root/fragment 定義: `docker-compose.yml`, `compose/web.yml`, `compose/api.yml`, `compose/gateway.yml`, `vendors/*/compose.yml`
- 新しい TLS override と設定例: `compose/web-tls.yml`, `compose/api-tls.yml`, `.env.example`（作成物）
- ホスト準備・boot guard: `compose/host-preparation.sh` と `compose/host-preparation/`（作成物）、`scripts/deploy-verify.sh`
- Gateway の起動・通信・guard: `proxy/Dockerfile`, `proxy/src/server.ts`, `proxy/src/gateway-channel/`, `proxy/src/network/guard-ruleset.ts`, `proxy/src/network/gateway-guard.ts`, `proxy/src/network/gateway-stop-guard.ts`（後者は作成物）
- API の reboot 要求接続: `api/src/proxy-client/`, `api/src/routes/connection-gateway.ts`, `proxy/src/host-control/host-reboot.ts`
- 分離配置専用 fragment の削除は 6.4、ホスト準備の実装は 2.x、reboot request は 2.6–2.7 が所有する。

### API / Web / Gateway の transport・証明書（4.1–4.6、5.1–5.2）

- Web の待受と証明書（4.1、4.3）: `web/server/index.ts`, `web/server/tls-options.ts`, `web/Dockerfile`。Web listener と TLS 証明書読込の切替は 4.1、Cookie Secure 連携は 4.3 が所有する。
- Web→API proxy と設定（4.2）: `web/server/index.ts`（proxy 設定）, `web/vite.config.ts`, `api/src/app.ts`, `api/src/server.ts`, `api/src/web-security-config.ts`（作成物）。同一ノード内 HTTP 化と API の既存 HTTPS/証明書境界撤去を 4.2 が所有する。現行 API HTTPS listener の証明書読込実装・テスト `api/src/tls-options.ts`, `api/src/tls-options.test.ts` もここに含む。
- API→Gateway transport/TLS（4.5–4.6）: `api/src/proxy-client/proxy-client.ts`, `api/src/proxy-client/gateway-transport.ts`（作成物）, `api/src/proxy-client/gateway-tls-options.ts`, `api/src/proxy-client/proxy-client.test.ts`, `proxy/src/gateway-channel/server.ts`, `proxy/src/gateway-channel/tls-options.ts`, `proxy/src/gateway-channel/tls-options.test.ts`, `proxy/src/server.ts`。API 側 mTLS client 証明書の任意化と Gateway 側 mTLS server 証明書の任意化をそれぞれの transport 境界タスクが所有する。
- 関連する既存 TLS 単体テスト: 上記に明記したテストのほか、各対象の隣接 `*.test.ts` は該当する所有タスクが扱う。DoH/upstream や ISP 模擬証明書のテストはこの境界ではない。

### Kill Switch の設定変更拒否と UI（2.8、4.6）

- API の設定・Gateway 反映: `api/src/routes/connection-config.ts`, `api/src/settings/`, `api/src/proxy-client/proxy-client.ts`, `api/src/schemas/settings.ts`, `proxy/src/settings-request.ts`, `proxy/src/network/`
- 関連テスト: `api/src/routes/connection-config.test.ts`, `api/src/settings/*.test.ts`, `proxy/src/settings-request.test.ts`, `proxy/src/network/*.test.ts`
- Web の設定トグルと説明: `web/src/components/dashboard/SettingsDialog.tsx`, `web/src/components/dashboard/SettingsDialog.test.tsx`（Kill Switch 設定の所有箇所。ほかの画面に追加箇所がある場合は同じ UI タスクで調整）
- ここでは既存 Kill Switch の基本機能を撤去しない。停止時 guard が反映できない有効値変更の拒否と、透過ゲートウェイのみを対象とする説明が対象。

### E2E・検証経路（5.1–5.7）

- 共通 E2E API client: `e2e/common/api-client.ts`, `e2e/common/api-client.test.ts`
- hosted stack と導入 fixture: `e2e/hosted/fixtures/stack.ts`, `e2e/hosted/fixtures/installer.ts`, `e2e/hosted/lib/provision.sh`, `e2e/hosted/playwright.config.ts`
- hosted API/UI/Gateway/lifecycle シナリオ: `e2e/hosted/specs/api/`, `e2e/hosted/specs/ui/`, `e2e/hosted/specs/gateway/`, `e2e/hosted/specs/lifecycle/`
- hosted 補助資材: `e2e/hosted/fixtures/gateway.ts`, `e2e/hosted/fixtures/ui.ts`, `e2e/hosted/lib/topology.sh`, `e2e/hosted/lib/certs.sh`, `e2e/hosted/vendors/`
- vendor-live: `e2e/vendor-live/lib/config.ts`, `e2e/vendor-live/prepare.ts`, `e2e/vendor-live/lib/prepare.test.ts`, `e2e/vendor-live/lib/config.test.ts` と `e2e/vendor-live/` 内の関連呼び出し元
- 境界: hosted の共通 stack/provision 準備は 5.1–5.2、VPN 操作シナリオは 5.3、TLS matrix は 5.4、lifecycle は 5.5、vendor-live は 5.6、Gateway 通信シナリオは 5.7 が所有する。共有 fixture の変更は担当タスク内で必要最小限にし、隣接タスクが同一ファイルを変更する場合は逐次作業順で統合する。
- `e2e/hosted/fixtures/gateway.ts` 等にある ISP/DoH 模擬用 TLS はシナリオの依存資材として維持し、API/Web の旧 PKI と混同しない。

### 配布 workflow・installer・文書（6.1–6.5、6.2）

- 配布: `.github/workflows/release-installer.yml`, `.github/workflows/installer-check.yml`（6.1 が Compose bundle の公開・検査へ置換）
- 旧 installer command/bootstrap/test: `installer/`（6.3 が撤去）、root `package.json` の `test:install`（6.3 が置換）
- 旧 PKI・遠隔配置・role selection・pairing の実装: `installer/setup.sh`, `installer/app.sh`, `installer/main.sh`, `installer/config.schema`, `installer/app.conf`（6.3/6.5 の境界で撤去。installer 配下の実体は 6.3 が削除し、6.5 は旧経路参照の不存在を確認する）
- 利用者向け文書: `README.md`, `.kiro/steering/product.md`, `.kiro/steering/tech.md`, `.kiro/steering/structure.md`, `.kiro/steering/roadmap.md`（6.2 が所有）
- 旧導入・常設コマンドへの参照が他の製品コードや設定に残る場合は、それぞれの上記境界タスクが同じ所有責務の範囲で更新する。

## 対象外として維持する参照

- `proxy/src/dns-relay/`、`proxy/src/verification/` 等の DoH/外部サービス URL と検証機能。
- `e2e/hosted/` の ISP/DoH 模擬サーバ用証明書・URL。
- ベンダー bundle の `vendors/*/` 宣言・runner 固有資材。Compose fragment の merge 契約以外のベンダー動作・宣言変更は本仕様の範囲外。
- Kill Switch の既存通常動作。変更対象は停止時 guard との連携と設定 UI の適用範囲説明に限る。

## 重複解消のルール

各ファイルの機能上の所有者は上記の境界タスクとする。複数境界の変更が必要な共有ファイル（例: `proxy/src/server.ts`, `api/src/server.ts`, `e2e/hosted/fixtures/stack.ts`）は、対象機能を列挙した各タスク記述に従い、タスクの逐次実行順に変更を統合する。同じ行・同じ契約を別タスクで独立に置換しない。後続タスクは着手時に現行コードと本一覧を再確認し、検索で新たに見つかった対象は該当所有境界に追記する。

## 後続タスクの対象ファイル選定

1.1 以降のすべてのタスクは、実装・検証・撤去の対象ファイルを選ぶ際に、まず本 inventory の境界別一覧を参照する。該当する所有タスクの範囲と現行コードを照合し、検索で追加の関連ファイルが見つかった場合は、その所有境界の対象として一覧に追記してから作業する。
