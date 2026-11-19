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

## 6.3 撤去後の残存参照調査

2026-11-19、installer 撤去後の現在の作業ツリーで下記を実行した。検索は大文字小文字を無視し、Git の追跡状態・ignore 設定に依存しないため、未追跡・ignored の作業ファイル（`e2e/artifacts/` を含む）も対象にした。`.claude` はその中の worktree checkout を除外するため対象外。依存物、生成物・ビルド出力、lockfile は除外した。検索結果は 137 行（.kiro 文書 115 行、その他 22 行）。

```sh
grep -rInIiE 'installer|installer/|installer-check|release-installer|test:install|vpngwgui-ctl|VPNGW_INSTALL_LIB|--only-roles|rotate-pairing|remote_role_args|build-bootstrap|bootstrap\.sh|install\.sh|setup\.sh' . --exclude-dir=.git --exclude-dir=.claude --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=build --exclude-dir=coverage --exclude-dir=.next --exclude-dir=generated --exclude='openapi.json' --exclude='*.lock' > /tmp/task63-grep-hits.txt
wc -l /tmp/task63-grep-hits.txt
```

`grep -rInIiE` は再帰・行番号・ファイル名・大文字小文字無視を指定する。出力ファイルはリポジトリ外の `/tmp` に置いた。以下は全ヒットファイルと件数、および残存理由である（該当語の説明自体を含む仕様・履歴文書も同じ検索に一致する）。

- **6.1 が所有する配布 workflow（1 hit）**: `.github/workflows/release-installer.yml` 15 行目は `installer-check.yml` の呼び出し。workflow は Compose bundle 配布・検査へ置換済みで、旧 installer の実行経路ではない。
- **維持する npm test 契約（2 hits）**: `package.json` 12 行目の `test:install` 呼び出しと 16 行目の `compose/host-preparation/tests/run.sh` への割当て。6.3 の要件どおりテスト名を保ち、runner は置換済み。
- **6.4 所有の fragment 整理（compose/api.yml 2、compose/gateway.yml 3、compose/web.yml 4 hits）**: 旧 installer/setup.sh や install.sh が fragment、証明書、環境値を設定していた旨のコメント・案内。専用 fragment の廃止・更新は 6.4 の境界なので 6.3 では変更しない。
- **7.2 所有（1 hit）**: `scripts/deploy-verify.sh` 9 行目は旧 install.sh 再実行へのコメントで、統合検証スクリプトの更新は 7.2 の対象。
- **現行の負例検査（1 hit）**: `scripts/test-readme-contract.sh` 72 行目は README に旧コマンド語が現れたら拒否するテスト式であり、旧経路ではない。
- **過去の実行記録（8 hits）**: `e2e/artifacts/hosted/2026-11-11/full-run.log`（487、1006、1460 行）、`e2e/artifacts/hosted/2026-11-11/gateway-final.log`（7、479 行）、`e2e/artifacts/hosted/2026-11-11-city-acceptance/final/full-run.log`（495、1020、1478 行）。過去の E2E 出力であり、現在の実行資材ではないため保持。
- **履歴・別タスク資料（115 hits）**: `.kiro/discovery/single-node-deployment-intent.md`（1）、`.kiro/handoff/2026-11-11-city-selection-complete.md`（1）、`.kiro/specs/cicd/brief.md`（10）、`.kiro/specs/e2e-tests/{brief.md (3),design.md (14),requirements.md (1),research.md (6),tasks.md (4)}`、`.kiro/specs/location-city-selection/acceptance-2026-11-11.md`（1）、`.kiro/specs/multihop-backend/{design.md (2),research.md (2)}`、`.kiro/specs/single-node-deployment/{brief.md (1),design.md (11),inventory.md (15),research.md (20),tasks.md (19)}`、`.kiro/specs/vendor-live-e2e/{design.md (1),research.md (1)}`、`.kiro/steering/{roadmap.md (1),tech.md (1)}`。これらは調査経緯、要件・設計・タスク境界、過去の検証結果を記録する文書で、現行コード経路ではない。別仕様資料と inventory 以外の文書は変更しない。

この調査で、6.3 の境界（installer command 層・設定・bootstrap 生成・専用テスト）に属する実ファイルの残存は見つからなかった。`installer/` の実体は撤去済みで、旧経路を参照する現行実行設定はない。host reboot は既存の 2.6（`compose/host-preparation/host-reboot.sh`）・2.7（API→proxy→依頼ファイル接続）の所有範囲であり、6.3 では移管・変更していない。

## 6.4 撤去後の残存参照調査

2026-11-19、3つの分離配置用 Compose fragment を作業ツリーから削除した後、リポジトリルートで大文字小文字を無視して検索した。`grep -r` は ignore 設定に従わないため `e2e/artifacts/` 等の ignored 資材も走査対象。依存物だけを除外した。`.claude/worktrees/` の別 worktree は検索に含めて残存理由を記録し、現 worktree の対象ファイルとは扱わない。

```sh
grep -rInIiE 'compose/(web|api|gateway)\.yml|docker compose.*-f.*compose/(web|api|gateway)\.yml|COMPOSE_FILE.*(web|api|gateway)\.yml' . --exclude-dir=.git --exclude-dir=node_modules
```

検索結果は29行。内訳は現 worktree 18行、`.claude/worktrees/` 内の別 worktree 11行。現 worktree で実行経路として旧 fragment を読む参照は0件。残りは次のとおり。

- **負例テスト（1 hit）**: `scripts/test-compose-contract.sh` は撤去対象の3パス名を検査用文字列として列挙し、ファイルが存在すれば失敗する。
- **履歴・仕様資料（17 hits）**: `.kiro/specs/e2e-tests/brief.md`（1）、`.kiro/specs/single-node-deployment/{inventory.md,design.md,tasks.md,research.md}`（各2/3/3/4）、`.kiro/specs/multihop-backend/{brief.md,design.md,research.md}`（各1/2/1）。過去の構成調査・設計・タスク境界を記録した参照で、実行資材ではない。利用者指示により、inventory.md 以外の spec 文書は変更しない。
- **別 worktree（11 hits）**: `.claude/worktrees/dev-add-branch-release-workflow/` 内の旧 Compose、installer、テスト、仕様記録。現在の worktree の実行経路ではなく、別 worktree の所有物なので変更しない。

Compose 設定検査は `scripts/test-compose-contract.sh` と `scripts/test-compose-tls-contract.sh` に集約し、root 単体、各 vendor、両 vendor、Web HTTPS/Gateway TLS の4組合せを含む各構成で `docker compose -p vpngwgui ... config --quiet` を実行する。root 側の service・volume・network・公開 port と proxy の host networking/capability/mount 契約も検査する。README、steering、workflow、bundle manifest、E2E 実行 fixture、`.dockerignore` に旧 fragment の実行参照はなかった。

## 6.5 撤去後の残存参照調査

2026-11-19、6.5 の変更後にリポジトリルートから大文字小文字を無視して再調査した。`rg --hidden -uuu` で隠しファイル、ignore 対象、未追跡ファイルも検索した。`.env` と ignored な `e2e/vendor-live/config.local.json` も検索対象に含めたが、認証値は出力・記録していない。依存物、lockfile、圧縮/画像/巨大な地理データ、ビルド出力・source map は検索対象から除いた。`.claude/worktrees/` は別 worktree のスナップショットとして含めて別扱いにした。

```sh
rg --hidden -uuu -l -i 'remote|ssh|scp|pairing|ペアリング|installer.{0,50}(role|roles)|role.{0,40}(install|deployment|installer)|役割.{0,30}(選択|配置|インストール)|pki|api-ca|ca\.crt|vpngwgui-ctl|bootstrap|setup\.sh|GATEWAY_HOST|GATEWAY_BASE_URL|8443|COMPOSE_FILE|certificate.{0,40}(generat|issue)|openssl' . --glob '!.git/**' --glob '!**/node_modules/**' --glob '!**/*.map' --glob '!**/*.gz' --glob '!**/*.png' --glob '!api/src/geo/places.json' --glob '!package-lock.json' --glob '!**/dist/**' --glob '!**/build/**' --glob '!**/coverage/**' > /tmp/task65-final-all-files.txt
wc -l /tmp/task65-final-all-files.txt
```

結果は123ファイル。`rg -l` のみで内容や設定値は記録していない。`.claude/worktrees/dev-add-branch-release-workflow/` 配下の58ファイルは別 worktree の古い snapshot に属し、現 worktree のコード・配布物ではないため変更しない。現 worktree の一致は、広い語の誤検出を含め次のように分類した。

- **現行 Compose / TLS の契約（維持）**: `README.md`, `.env.example`, `compose/api-tls.yml`, `scripts/test-compose-tls-contract.sh` の `COMPOSE_FILE`、operator が用意する CA/client/server 証明書の mount・パス、Web の例示 port `8443` は新契約の override と TLS 検査である。証明書を生成・配布する製品経路ではない。
- **hosted / server テスト用証明書（維持）**: `e2e/hosted/lib/{certs.sh,tls-matrix-certs.sh}`, `e2e/hosted/lib/tls-certs.test.ts`, `e2e/hosted/services/isp*`, `web/server/testdata/` と近接テストは明示的に許可された throwaway/fixture 資材であり、製品用 PKI ではない。`proxy/src/gateway-channel/tls-options.test.ts`, `api/src/proxy-client/gateway-tls-options.test.ts` も一時テスト証明書だけを生成する。
- **検証サーバ上の統合検証（7.2 所有・未完了の旧方式の残りとして明記）**: `scripts/deploy-verify.sh` は現状、作業ツリーを SSH で検証サーバへ転送し `VERIFY_INSTALL_DIR` へ展開して素の `docker compose build/up` を実行する旧い遠隔配置の流れで、コメントにも installer 生成の `.env` と `install.sh` の再実行が残る。これは 6.5 が撤去する対象ではなく（6.5 は製品のコード・設定・テスト・生成スクリプトの旧経路を扱う）、タスク 7.2 の作業そのものとして所有される: 7.2 は、配布物（Compose bundle）の展開と `-p vpngwgui` の固定名、host-preparation の check/apply、Compose の merge/config、公開 port、TLS の mount、UDS volume の検査へ置き換え、旧い転送・素の lifecycle コマンド・installer への言及を除去する。7.2 の完了条件に含まれるため、7.2 の完了後にこの残存を再調査して記録する。`.env.example` の `VERIFY_*` はその統合検証の設定として維持する。
- **現行 host-preparation の局所語（維持）**: `compose/host-preparation/common.sh` と `tests/check.test.sh` の `remote` は Docker daemon がローカル Unix socket かを検査・拒否する機能、`boot-guard.sh` とその tests の `bootstrap` は起動時に初期 BLOCK を作る新方式機能である。
- **テスト語・一般用語（維持）**: `scripts/test-readme-contract.sh` は README に旧 command が再導入されないことを検査し、hosted topology/runner/DNS listener の `ssh`, `remote`, `role` はホスト通信・socket peer・アクセシビリティ属性である。ベンダー entrypoint の `REMOTE=0` は session metadata である。
- **履歴・仕様・過去成果物（維持）**: `.kiro/specs/`（本 inventory 以外は指示により未変更）、`.kiro/discovery/`, `.kiro/handoff/`, E2E artifacts/logs は旧方式の設計経緯や過去の出力を記録しており、実行設定ではない。`.agents/skills/` と `.claude/skills/` の汎用テンプレートにある `role`/`bootstrap` もアプリの installer 役割ではない。
- **削除した現行 test 参照**: `api/src/server.test.ts` に残っていた `API_TLS_*`, `GATEWAY_PKI_DIR` と旧 `GATEWAY_TLS_CERT_FILE` / `GATEWAY_TLS_KEY_FILE` 名、および PKI という旧説明を取り除き、現行の `GATEWAY_TLS_*_FILE` / `WEB_TLS_*_FILE` が未設定の既定 HTTP listener test とした。
- **削除した ignored な残骸**: 古い `web/dist-server/` に source から既に撤去済みの API TLS loader（`GATEWAY_PKI_DIR`, `/etc/vpngwgui/pki`, `api-ca.crt`）が残っていたため、古い生成物を除去した後に現在の source から再生成し、同じ旧 path が含まれないことを確認した。ignored な `e2e/vendor-live/config.local.json` の旧 API CA 設定 `caPath` だけも削除し、他のローカル設定値は維持した。これらは現行 source の機能ではないが、無視対象ファイルの調査で見つかった旧設定残骸だった。

旧方式の具体的な command/path (`vpngwgui-ctl`, `GATEWAY_HOST`, `GATEWAY_BASE_URL`, `/etc/vpngwgui/pki`, `api-ca.crt`, pairing/role-selection の実装、installer の certificate generation/distribution) は現 worktree の実行コード、Compose/config、schema/OpenAPI、API/Web UI、generation script に0件。release workflow と workflow-call の `.github/workflows/{release-installer.yml,installer-check.yml}` は task 6.1 で Compose bundle の build/check に置換済みであり、`scripts/test-compose-bundle.sh` が `scripts/bundle-manifest.txt` の資材と展開後 Compose config を検査する。残る workflow 名は既存の呼び出し path であり、旧 installer の処理・資材参照ではない。

別 worktree の検索内訳も確認した。`.claude/worktrees/dev-add-branch-release-workflow/` には旧 `installer/`、API HTTPS listener、分離配置 Compose fragment、旧 E2E fixture などの snapshot が残るが、現 branch の実行経路・Git index に属さないため本 task では変更しない。


## 7.2 deploy-verify 更新後の旧方式参照調査

2026-11-19 に deploy-verify の実行ファイルと配布 env 雛形を再調査した。実行経路に紛れる旧遠隔配置、installer、素の lifecycle、`.env` コピー、rsync、旧 install path の語を検索し、配布 `.env.example` 内の `VERIFY_*` も個別に確認した。

```sh
if rg --hidden -n -i 'VERIFY_INSTALL_DIR|VERIFY_INSTALL|rsync|install\.sh|installer|docker compose (build|up|ps)|cp .*\.env|\.env.*(copy|cp)' scripts/deploy-verify.sh; then exit 1; else echo 'legacy deploy-verify patterns: 0'; fi
if rg -n 'VERIFY_' .env.example; then exit 1; else echo '.env.example VERIFY_*: 0'; fi
rg -n 'VERIFY_' scripts/deploy-verify.sh scripts/deploy-verify.env.example .kiro/specs/single-node-deployment/acceptance-env.md
```

最初の2検索はともに0件。3つ目は `VERIFY_HOST`, `VERIFY_USER`, `VERIFY_SSH_PASSWORD`, `VERIFY_LAB` の script/documentation 参照だけを表示した。旧 install 先・installer・rsync・作業ツリー転送・`.env` copy・`docker compose build/up/ps` は deploy-verify の実行コードに残らず、lab は既設 `.env` を維持したまま `/root/vpngwgui` に bundle を展開する。
