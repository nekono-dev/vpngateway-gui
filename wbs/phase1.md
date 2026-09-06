# Phase 1: 骨格検証（モックCLI・最小Web・docker-compose初回疎通）

> 本ファイルはPhase2〜7（同ディレクトリの他ファイル）を踏まえて全体整合性を再評価した版である。再評価により追加・修正した箇所には「※全体整合性レビューによる追加」を付記する。

## 目的

このシステムで最も新規性・リスクが高い「Web→API→UDS→Proxyのコマンド実行パイプライン」を、実VPNベンダーCLIの代わりにモックCLIスクリプトで置き換えて、docker-composeで最初から最後まで実際に動かして確認できる状態にする。

## 前提

なし（グリーンフィールドからの最初のフェーズ）。

## スコープ外

| 項目 | 理由・先送り先 |
|---|---|
| `NET_ADMIN` / `/dev/net/tun` | 実CLIがトンネルを確立するために必要になるが、パイプライン検証（モックCLI）には不要。→ phase2.md（2026-09-06のフェーズ計画見直しにより、実VPNベンダーCLI統合と合わせてPhase2に前倒し。以下同様） |
| 実VPNベンダーCLI | サンドボックスに実CLIが存在しない。→ phase2.md |
| `network_mode: host` | ホストネットワーク操作はリスクが高く、パイプライン検証に必須ではない。→ phase3.md |
| nftablesによる透過ゲートウェイ・Kill Switch実処理 | 同上。→ phase3.md |
| インストールスクリプト | ホストの永続変更はPhase3のネットワーク基盤移行と合わせて実施。→ phase3.md |
| 3proxyによる明示的プロキシ | ホストネットワーク操作はリスクが高く、パイプライン検証に必須ではない。→ phase4.md |
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
- [x] `specs/design.md`末尾に「# 実装フェーズ」節を追加し、Phase分け方針表を記載する。
- [x] `specs/apiserver/design.md`「管理者向け設定」節直後に「## Phase 1における具体プロファイル」を追加する。
- [x] `specs/apiserver/tasks.md`冒頭に、Phase1はモックCLI対象・設定は永続化のみである旨を追記する。
- [x] `specs/proxyserver/design.md`／`requirements.md`冒頭付近に「# Phase 1における縮小構成」節を追加する。
- [x] `specs/proxyserver/tasks.md`の透過ゲートウェイ／Kill Switch／明示的プロキシ／インストールスクリプト見出しに`(Phase 2以降)`を付記し、「## モックVPN CLI (Phase 1)」節を追加する。
- [x] `specs/webserver/tasks.md`の設定ダイアログ／接続ログ見出しに`(Phase 2以降)`を付記する。

### Step 1: モノレポ雛形
- [x] npm workspaces構成（`web`/`api`/`proxy`）。ルート`package.json`、`tsconfig.base.json`。
- [x] 各サービス`"type":"module"`のTypeScript(ESM)、テストは`vitest`に統一。
- [x] Dockerfileはリポジトリルートをbuild contextにする多段COPY構成にする。

### Step 2: proxy — UDSサーバ＋モックCLI
- [x] `proxy/src/server.ts`: `http`組み込みモジュールで`/var/run/vpngw-ctl/exec.sock`にlisten。起動時に残存ソケットを`unlink`、listen後`chmodSync(0o770)`。**`POST /exec`パスで受信する**（※全体整合性レビューによる追加）。
- [x] `proxy/src/allowlist.ts`: 実行可能バイナリ許可リスト（モックCLI絶対パスのみ登録）。
- [x] `proxy/src/exec/command-runner.ts`: `execFile(binary, resolvedArgv, {timeout})`によるシェル非経由実行。
- [x] `proxy/mock-cli/adguardvpn-cli-mock.mjs`: Node.jsスクリプト（shebang付き）。状態ファイルは`/tmp/vpngwgui-mock-state.json`。

  | argv | 動作 | stdout | exit |
  |---|---|---|---|
  | `connection -l <COUNTRY>` | 状態を`{"status":"connected","country":"<COUNTRY>"}`に更新 | 同JSON | 0 |
  | `connection -d` | 状態を`{"status":"disconnected"}`に更新 | 同JSON | 0 |
  | `connection -s` | 状態ファイルを読み取り出力 | 状態JSON | 0 |
  | `connection -l zz`（エラー注入用） | 変更なし | stderrに`ERROR: no server available for zz` | 1 |

- [x] Dockerfile: `RUN mkdir -p /var/run/vpngw-ctl && chown 10001:10001 /var/run/vpngw-ctl`を先に実行（名前付きボリューム初回マウント時の所有権引き継ぎ対策）。api/proxy共に明示UID/GID(`10001:10001`)でユーザー作成。

### Step 3: api — プロファイル読込＋UDSクライアント＋主要エンドポイント
- [x] `api/config/vpn-profile.json`（Phase1用モックプロファイル、下記内容）。
- [x] `api/src/proxy-client/proxy-client.ts`: undici `Agent({socketPath})`で`POST /exec`へ送信する`executeVendorCommand()`を実装（`notifySettings()`はPhase2で追加、関数は分離しておく＝※全体整合性レビューによる追加）。
- [x] `api/src/profile/`: プロファイルローダー、プレースホルダー検証（`api/src/lib/regex-match.ts`はプリミティブのみのポータビリティテスト適合ヘルパーとして分離）、**レスポンス整形（stdout）をプロファイルの`outputFormat`（Phase1は`"json"`固定）で分岐するパーサー関数として分離**（※全体整合性レビューによる追加、Phase4で`"text"`パーサーを追加する前提）。
- [x] `api/src/settings/settings-store.ts`: ユーザ向け設定の単一JSONファイルread-modify-write永続化。design.md記載の全項目（`killSwitch`等）をスキーマに持たせるが、Phase1では永続化のみでproxyへの実反映は行わない。
- [x] `api/src/audit-log/audit-log-store.ts`: JSONL追記による監査ログ。
- [x] エンドポイント実装順: `/v1/connection/countries` → proxy-client → `GET /v1/connection` → `PUT /v1/connection` → `GET/PUT /v1/connection/config` → `GET /v1/connection/log` →（余力があれば）`POST /v1/session`。
- [x] Fastifyエラーハンドラで400/502/422/504を判定・返却。

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
  "countries": ["jp", "us", "de", "sg", "zz"]
}
```

### Step 4: web — 最小ダッシュボード
- [x] `api/scripts/export-openapi.ts`でOpenAPI JSONを書き出し、`web/orval.config.ts`（`client:'fetch'`, `baseUrl:'/api'`）で`web/src/generated/api/`へクライアント生成。
- [x] `@fastify/http-proxy`で`/api/*` → `http://api:3000`へリバースプロキシ。
- [x] `ConnectionStatusCard` / `CountrySelect`（選択肢のみ、自由入力不可） / `ConnectDisconnectButton`（`isSubmitting`で二重送信防止）。
- [x] `useConnectionPolling`フック（5秒間隔、非表示タブでは停止）。

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
curl -s http://localhost:8080/api/v1/connection/countries        # → ["jp","us","de","sg","zz"]（"zz"はエラー注入用テストコード）
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

## 実施結果

2026-09-06、上記手順を実装し`docker-compose build && docker-compose up -d`で起動、完了基準のcurlシナリオ（countries取得・接続・切断・400・422・502・監査ログ・Web配信・設定PUT/バリデーション）を全て実行して想定通りの結果を確認した。

## 次フェーズへの申し送り

> 2026-09-06、フェーズ計画を全体的に見直し、実VPNベンダーCLI統合（当初Phase4）をPhase2に前倒しし、ネットワーク基盤移行（当初Phase2）をPhase3に、明示的プロキシ（当初Phase3）をPhase4に、それぞれ繰り下げた（詳細は`wbs/README.md`「フェーズ分割の考え方」参照）。以下は改訂後の番号で記載する。

- Phase2開始時、実VPNベンダーCLIバイナリをproxyイメージに同梱し、モックCLIパスの代わりに実CLIパスを許可リストに登録する。`docker-compose.yml`のproxyサービスには`cap_add: [NET_ADMIN]`・`devices: [/dev/net/tun]`を追加するが、`network_mode: host`への切り替え・`networks: [app-net]`の除去はPhase3で行う。
- `POST /exec`に加えて`POST /settings`をPhase3で追加する（`proxy-client.ts`の`notifySettings()`もこのタイミングで実装）。
- プロファイルの`outputFormat`は、Phase2で実CLI統合する際に`"text"`等の値を追加し、対応するパーサーを`api/src/profile/`に追加する。
- **プレースホルダー列挙値チェックとモックCLIのエラー注入コードの整合性に注意**: APIサーバは`enumFrom`参照先（`countries`）に対して必ず列挙値チェックを行うため、モックCLIのエラー注入用コード`"zz"`を`countries`に含めておかないと、422検証用のリクエストがAPIサーバの400で弾かれてしまう（実装中に発見・修正済み。`api/config/vpn-profile.json`の`countries`に`"zz"`を含めている。Phase2で実プロファイルに置き換える際はこのテスト用コードを含めないこと）。
- Dockerイメージの`npm prune --omit=dev`後もworkspaces構成上、他ワークスペースの本番依存（例: api側イメージにweb側のreact等）が`node_modules`に残り、イメージサイズが最適ではない。Phase2以降でイメージサイズが問題になる場合は、workspaceごとのnode_modules分離（`npm ci --workspace`の個別インストールや`pnpm deploy`相当の仕組み）を検討する。
- `undici`の`Pool("http://localhost", { socketPath })`でUDS経由のHTTPリクエストが問題なく機能することを確認した（apiserver/design.mdの`Agent({socketPath})`という記載から`Pool`に変更したが、挙動は設計意図と同一）。
