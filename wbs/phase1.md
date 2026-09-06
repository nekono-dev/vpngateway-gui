# Phase 1: 骨格検証（モックCLI・最小Web・docker-compose初回疎通）

> 本ファイルはPhase2〜7（同ディレクトリの他ファイル）を踏まえて全体整合性を再評価した版である。再評価により追加・修正した箇所には「※全体整合性レビューによる追加」を付記する。

## 目的

このシステムで最も新規性・リスクが高い「Web→API→UDS→Proxyのコマンド実行パイプライン」を、実VPNベンダーCLIの代わりにモックCLIスクリプトで置き換えて、docker-composeで最初から最後まで実際に動かして確認できる状態にする。

## 前提

なし（グリーンフィールドからの最初のフェーズ）。

## スコープ外

| 項目 | 理由・先送り先 |
|---|---|
| `network_mode: host` / `NET_ADMIN` / `/dev/net/tun` | ホストネットワーク操作はリスクが高く、パイプライン検証に必須ではない。→ phase2.md |
| nftablesによる透過ゲートウェイ・Kill Switch実処理 | 同上。→ phase2.md |
| 3proxyによる明示的プロキシ | 同上。→ phase3.md |
| 実VPNベンダーCLI | サンドボックスに実CLIが存在しない。→ phase4.md |
| インストールスクリプト | ホストの永続変更はPhase2のネットワーク基盤移行と合わせて実施。→ phase2.md |
| 設定ダイアログ・接続ログ画面 | ダッシュボード最小限に絞り、対応するAPI実処理が揃うPhase5でまとめて実装。→ phase5.md |
| excludedDomains実処理 | → phase6.md |
| 認証・認可、レート制限 | → phase7.md |

## 全体整合性レビューでの指摘・対応

Phase2〜7の内容を踏まえてPhase1の設計を見直した結果、以下3点を当初案から修正する。

1. **UDS内部プロトコルのエンドポイントパスを明示する（`POST /exec`固定パス）。**
   当初案は「UDS上でコマンド実行リクエストを受けるHTTPサーバ」とだけ決めていたが、Phase2で設定反映用の`POST /settings`エンドポイントを同じUDSサーバに追加する計画がある（phase2.md「内部プロトコル拡張」）。Phase1の時点で`/exec`という具体的なパスに決めておくことで、Phase2での追加が既存エンドポイントの仕様変更ではなく単純な追加で済むようにする。
2. **APIサーバのproxy-clientモジュールを、実行系（`executeVendorCommand`）と将来の通知系（`notifySettings`、Phase2で追加）を別関数として最初から分離した構成にする。**
   1ファイル内に両方を実装するのではなく、Phase1では`executeVendorCommand`のみを実装し、Phase2で`notifySettings`を追加する前提の関数分離にしておく（同一ファイル内の別関数で可、モジュール分割は不要）。
3. **コマンド実行結果（stdout）のパース処理を、モック専用の決め打きコードではなく「vendor非依存のレスポンス整形層」と「モックCLI用パーサー」に分離する。**
   Phase1のモックCLIはstdoutをJSON固定にする割り切りをしているが、Phase4で実CLI（テキスト出力）に置き換える際にパーサーだけを差し替えられるよう、`api/src/profile/`配下にパーサーを関数として独立させ、プロファイルJSON側で将来パーサー種別を指定できる余地を残す（Phase1では`"outputFormat": "json"`をプロファイルに追加し、Phase4で`"text"`等を追加する程度の最小限の拡張性に留め、過剰な抽象化はしない）。

上記以外（モノレポ構成、UID/GID統一、ボリューム所有権の落とし穴、docker-compose設計）は当初案のまま妥当と判断した。なお、Phase1では`proxy`をDockerブリッジネットワーク（`app-net`）上で動かすが、Phase2で`network_mode: host`へ切り替える際は`networks:`定義を丸ごと除去する変更になる。これはvolume共有（UDS経路）には影響しないため、Phase1の設計を変更する必要はない旨をここに明記しておく。

## 主要タスク

### Step 0: specs更新（AGENTS.mdの仕様駆動開発ルール順守のため実装前に実施）
- [ ] `specs/design.md`末尾に「# 実装フェーズ」節を追加し、Phase分け方針表を記載する。
- [ ] `specs/apiserver/design.md`「管理者向け設定」節直後に「## Phase 1における具体プロファイル」を追加する。
- [ ] `specs/apiserver/tasks.md`冒頭に、Phase1はモックCLI対象・設定は永続化のみである旨を追記する。
- [ ] `specs/proxyserver/design.md`／`requirements.md`冒頭付近に「# Phase 1における縮小構成」節を追加する。
- [ ] `specs/proxyserver/tasks.md`の透過ゲートウェイ／Kill Switch／明示的プロキシ／インストールスクリプト見出しに`(Phase 2以降)`を付記し、「## モックVPN CLI (Phase 1)」節を追加する。
- [ ] `specs/webserver/tasks.md`の設定ダイアログ／接続ログ見出しに`(Phase 2以降)`を付記する。

### Step 1: モノレポ雛形
- [ ] npm workspaces構成（`web`/`api`/`proxy`）。ルート`package.json`、`tsconfig.base.json`。
- [ ] 各サービス`"type":"module"`のTypeScript(ESM)、テストは`vitest`に統一。
- [ ] Dockerfileはリポジトリルートをbuild contextにする多段COPY構成にする。

### Step 2: proxy — UDSサーバ＋モックCLI
- [ ] `proxy/src/server.ts`: `http`組み込みモジュールで`/var/run/vpngw-ctl/exec.sock`にlisten。起動時に残存ソケットを`unlink`、listen後`chmodSync(0o770)`。**`POST /exec`パスで受信する**（※全体整合性レビューによる追加）。
- [ ] `proxy/src/allowlist.ts`: 実行可能バイナリ許可リスト（モックCLI絶対パスのみ登録）。
- [ ] `proxy/src/exec/command-runner.ts`: `execFile(binary, resolvedArgv, {timeout})`によるシェル非経由実行。
- [ ] `proxy/mock-cli/adguardvpn-cli-mock.mjs`: Node.jsスクリプト（shebang付き）。状態ファイルは`/tmp/vpngwgui-mock-state.json`。

  | argv | 動作 | stdout | exit |
  |---|---|---|---|
  | `connection -l <COUNTRY>` | 状態を`{"status":"connected","country":"<COUNTRY>"}`に更新 | 同JSON | 0 |
  | `connection -d` | 状態を`{"status":"disconnected"}`に更新 | 同JSON | 0 |
  | `connection -s` | 状態ファイルを読み取り出力 | 状態JSON | 0 |
  | `connection -l zz`（エラー注入用） | 変更なし | stderrに`ERROR: no server available for zz` | 1 |

- [ ] Dockerfile: `RUN mkdir -p /var/run/vpngw-ctl && chown 10001:10001 /var/run/vpngw-ctl`を先に実行（名前付きボリューム初回マウント時の所有権引き継ぎ対策）。api/proxy共に明示UID/GID(`10001:10001`)でユーザー作成。

### Step 3: api — プロファイル読込＋UDSクライアント＋主要エンドポイント
- [ ] `api/config/vpn-profile.json`（Phase1用モックプロファイル、下記内容）。
- [ ] `api/src/proxy-client/proxy-client.ts`: undici `Agent({socketPath})`で`POST /exec`へ送信する`executeVendorCommand()`を実装（`notifySettings()`はPhase2で追加、関数は分離しておく＝※全体整合性レビューによる追加）。
- [ ] `api/src/profile/`: プロファイルローダー、プレースホルダー検証（`api/src/lib/regex-match.ts`はプリミティブのみのポータビリティテスト適合ヘルパーとして分離）、**レスポンス整形（stdout）をプロファイルの`outputFormat`（Phase1は`"json"`固定）で分岐するパーサー関数として分離**（※全体整合性レビューによる追加、Phase4で`"text"`パーサーを追加する前提）。
- [ ] `api/src/settings/settings-store.ts`: ユーザ向け設定の単一JSONファイルread-modify-write永続化。design.md記載の全項目（`killSwitch`等）をスキーマに持たせるが、Phase1では永続化のみでproxyへの実反映は行わない。
- [ ] `api/src/audit-log/audit-log-store.ts`: JSONL追記による監査ログ。
- [ ] エンドポイント実装順: `/v1/connection/countries` → proxy-client → `GET /v1/connection` → `PUT /v1/connection` → `GET/PUT /v1/connection/config` → `GET /v1/connection/log` →（余力があれば）`POST /v1/session`。
- [ ] Fastifyエラーハンドラで400/502/422/504を判定・返却。

Phase1用プロファイル（`api/config/vpn-profile.json`、`outputFormat`追加）:
```json
{
  "vendor": "adguardvpn",
  "binary": "/usr/local/bin/adguardvpn-cli-mock",
  "outputFormat": "json",
  "actions": {
    "connect": {
      "argv": ["connection", "-l", "%COUNTRY%"],
      "placeholders": {
        "COUNTRY": { "pattern": "^[a-z]{2}$", "source": "enum", "enumFrom": "adguardvpn.countries" }
      },
      "timeoutMs": 15000
    },
    "disconnect": { "argv": ["connection", "-d"], "placeholders": {}, "timeoutMs": 10000 },
    "status": { "argv": ["connection", "-s"], "placeholders": {}, "timeoutMs": 5000 }
  },
  "countries": ["jp", "us", "de", "sg"]
}
```

### Step 4: web — 最小ダッシュボード
- [ ] `api/scripts/export-openapi.ts`でOpenAPI JSONを書き出し、`web/orval.config.ts`（`client:'fetch'`, `baseUrl:'/api'`）で`web/src/generated/api/`へクライアント生成。
- [ ] `@fastify/http-proxy`で`/api/*` → `http://api:3000`へリバースプロキシ。
- [ ] `ConnectionStatusCard` / `CountrySelect`（選択肢のみ、自由入力不可） / `ConnectDisconnectButton`（`isSubmitting`で二重送信防止）。
- [ ] `useConnectionPolling`フック（5秒間隔、非表示タブでは停止）。

### Step 5: docker-compose全体構成
```yaml
services:
  web:
    build: { context: ., dockerfile: web/Dockerfile }
    ports: ["8080:8080"]
    networks: [app-net]
    depends_on: [api]
    environment: { API_ORIGIN: http://api:3000 }

  api:
    build: { context: ., dockerfile: api/Dockerfile }
    networks: [app-net]
    user: "10001:10001"
    depends_on: [proxy]
    volumes:
      - ctl-socket:/var/run/vpngw-ctl
      - ./api/config/vpn-profile.json:/etc/vpngwgui/vpn-profile.json:ro
      - api-data:/var/lib/vpngwgui
    environment:
      VPN_PROFILE_PATH: /etc/vpngwgui/vpn-profile.json
      PROXY_SOCKET_PATH: /var/run/vpngw-ctl/exec.sock
      SETTINGS_FILE: /var/lib/vpngwgui/settings.json
      AUDIT_LOG_FILE: /var/lib/vpngwgui/audit.log

  proxy:
    build: { context: ., dockerfile: proxy/Dockerfile }
    networks: [app-net]      # Phase2で network_mode: host に置換予定
    user: "10001:10001"
    volumes:
      - ctl-socket:/var/run/vpngw-ctl
    environment: { CTL_SOCKET_PATH: /var/run/vpngw-ctl/exec.sock }

networks:
  app-net: {}
volumes:
  ctl-socket: {}
  api-data: {}
```

## 中断・再開に関する注意（本フェーズが複数セッションに跨る場合）

Phase1は単一セッションで完了しない可能性がある。Step0〜5は前Stepの成果に依存する順序だが、**Step2（proxy）とStep3（api）はそれぞれ単体で動作確認・コミットが可能**なため、以下の単位を区切りとして進めることを推奨する。

1. Step0（specs更新）完了後 → コミット
2. Step1（モノレポ雛形）完了後 → コミット
3. Step2（proxy: UDSサーバ＋モックCLI）完了後 → `docker compose up proxy`単体起動＋`curl --unix-socket /var/run/vpngw-ctl/exec.sock`等での疎通確認を行ってからコミット
4. Step3（api）完了後 → `docker compose up -d proxy api`でapi+proxy疎通確認（本ファイル「完了基準」のcurlシナリオのうち`localhost:3000`宛の部分に相当）を行ってからコミット
5. Step4（web）完了後 → web単体ビルド・orval生成確認後にコミット
6. Step5（docker-compose全体）完了後 → 「完了基準」の全項目通過を確認してからコミット

**セッション再開時の進捗判断方法**:
- 本ファイルのStep内チェックボックスの状態を確認する（実装完了ごとに`[ ]`→`[x]`へ更新すること。現時点では未着手のため全て`[ ]`）。
- `git log`で直近のコミットがどのStepに対応するかを確認する。
- `specs/*/tasks.md`のチェック状態と本ファイルのチェック状態に齟齬がないか確認する（AGENTS.mdの仕様駆動開発ルールにより、実装とspecsの記述が乖離した場合は都度更新する）。
- 実装中に本ファイル記載の設計（UDSパス名、プロファイルスキーマ等）からの変更が必要になった場合は、まず本ファイルおよび該当specsを更新してから実装を再開する。

## 完了基準（初回動作確認シナリオ）

```bash
docker compose build
docker compose up -d

# proxyのUDS起動確認
docker compose exec proxy sh -c 'ls -l /var/run/vpngw-ctl/exec.sock'

# Web経由でAPIまで到達確認
curl -s http://localhost:8080/api/v1/connection/countries        # → ["jp","us","de","sg"]
curl -s http://localhost:8080/api/v1/connection                  # → {"status":"disconnected"}

# 接続→状態反映確認
curl -s -X PUT http://localhost:8080/api/v1/connection -H 'Content-Type: application/json' -d '{"connect":true,"country":"jp"}'
curl -s http://localhost:8080/api/v1/connection                  # → {"status":"connected","country":"jp"}

curl -s -X PUT http://localhost:8080/api/v1/connection -H 'Content-Type: application/json' -d '{"connect":false}'

# 入力エラー（未許可国コード）→ 400
curl -s -o /dev/null -w '%{http_code}\n' -X PUT http://localhost:8080/api/v1/connection -H 'Content-Type: application/json' -d '{"connect":true,"country":"xx"}'

# プロキシ側実行失敗（モックのエラー注入国コード）→ 422
curl -s -o /dev/null -w '%{http_code}\n' -X PUT http://localhost:8080/api/v1/connection -H 'Content-Type: application/json' -d '{"connect":true,"country":"zz"}'

# プロキシ未応答 → 502
docker compose stop proxy
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/api/v1/connection
docker compose start proxy

# 監査ログ
curl -s http://localhost:8080/api/v1/connection/log
```

ブラウザ確認: `http://<ホスト>:8080/`で国選択→接続ボタン押下→ローディング→「接続中」表示への変化、ボタン連打時に二重リクエストが発生しないことをDevToolsで確認する。

## 次フェーズへの申し送り

- Phase2開始時、`docker-compose.yml`のproxyサービスを`network_mode: host`に切り替え、`networks: [app-net]`を除去する。
- `POST /exec`に加えて`POST /settings`をPhase2で追加する（`proxy-client.ts`の`notifySettings()`もこのタイミングで実装）。
- プロファイルの`outputFormat`は、Phase4で実CLI統合する際に`"text"`等の値を追加し、対応するパーサーを`api/src/profile/`に追加する。
