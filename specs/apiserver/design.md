# SPEC-API: APIサーバ基本設計

サービス全体設計（../design.md）で定義されたAPIサーバの詳細設計を示す。

# 管理者向け設定「VPNクライアント操作プロファイル」の具体スキーマ

サーバ管理者が用意し、APIコンテナに読み取り専用（`:ro`）でマウントするJSONファイル。

シェル文字列（例 `"adguardvpn-cli connection -l %COUNTRY%"`）としては保持せず、**argv配列**として保持する。値の代入段階でシェルメタ文字（`;` `|` `` ` `` `$()` 等）が入り込んでも解釈される余地をなくすためである。

```json
{
  "vendor": "adguardvpn",
  "binary": "/usr/bin/adguardvpn-cli",
  "actions": {
    "connect": {
      "argv": ["connection", "-l", "%COUNTRY%"],
      "placeholders": {
        "COUNTRY": {
          "pattern": "^[a-z]{2,3}(-[a-z0-9]+)?$",
          "source": "enum",
          "enumFrom": "adguardvpn.countries"
        }
      },
      "timeoutMs": 15000
    },
    "disconnect": {
      "argv": ["connection", "-d"],
      "placeholders": {},
      "timeoutMs": 10000
    },
    "status": {
      "argv": ["connection", "-s"],
      "placeholders": {},
      "timeoutMs": 5000
    }
  },
  "countries": ["jp", "us", "de", "sg"]
}
```

- `binary` はプロキシサーバ側の実行可能バイナリ許可リスト（proxyserver/design.md参照）と突き合わせる値であり、APIサーバはこの値を信頼してプロキシへ送信する送信データの一部に含める。
- `placeholders.<KEY>.pattern` は正規表現、`enumFrom` は同ファイル内の列挙値（例 `countries`）を指す。APIサーバはWeb UIから渡された値がこの許可条件を満たすかを必ず再検証する。
- ベンダー追加時は、このJSONを1ファイル追加し、プロキシサーバ側の許可リストにバイナリパスを追加するだけで対応できる（詳細はproxyserver/design.md）。

## Phase 1における具体プロファイル

Phase 1（`wbs/phase1.md`）では実VPNベンダーCLIの代わりにモックCLIスクリプトを使用する。この段階でのプロファイルは以下の内容とし、`outputFormat`フィールド（Phase 1では`"json"`固定）を追加する。これはモックCLIのstdoutをJSON固定にしている割り切りをプロファイル側から表現するためのもので、Phase 2で実CLI統合時に`"text"`等の値を追加し対応するパーサーを実装する拡張点となる（実CLI統合はネットワーク基盤移行より前のPhase 2で行う。理由は`wbs/README.md`「フェーズ分割の考え方」参照）。

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

`"zz"`はモックCLIのエラー注入用コード（proxyserver/design.md「Phase 1: モックVPN CLI仕様」参照）。プレースホルダー検証は`countries`（enumFrom参照先）に対する一致判定であるため、`zz`が`countries`に含まれていないとAPIサーバ側の入力検証（400）で弾かれ、プロキシ側の実行失敗（422）を再現できない。そのためPhase 1限定でテスト用コードとして`countries`に含めている（Web UIの国選択肢にも表示されるが、Phase 1はモックプロファイルでありWeb UIも本番運用しないため許容する）。

## Phase 2における具体プロファイル

Phase 2（`wbs/phase2.md`）でモックCLIから実VPNベンダーCLI（AdGuard VPN CLI）へ置換した。実バイナリ（v1.7.12、Linux amd64/arm64/armv7）を用いて実機検証した結果に基づき、以下の内容とする。

```json
{
  "vendor": "adguardvpn",
  "binary": "/usr/local/bin/adguardvpn-cli",
  "outputFormat": "text",
  "actions": {
    "connect": { "argv": ["connect", "-l", "%COUNTRY%", "-y"], "placeholders": { "COUNTRY": { "pattern": "^[a-z]{2}$", "source": "enum", "enumFrom": "adguardvpn.countries" } }, "timeoutMs": 30000 },
    "disconnect": { "argv": ["disconnect"], "placeholders": {}, "timeoutMs": 15000 },
    "status": { "argv": ["status"], "placeholders": {}, "timeoutMs": 8000 },
    "login": {
      "argv": ["login"],
      "placeholders": {},
      "timeoutMs": 15000,
      "completionPattern": "https://auth\\.adguard\\.io/device_code\\?user_code=[A-Z0-9-]+"
    }
  },
  "countries": ["ae", "ar", "..."]
}
```

実機検証で判明した点（`api/config/vpn-profile.json`が本番用の実データ）:

- **`outputFormat: "text"`**: 実CLIはJSONではなく人間可読なテキストを標準出力する（例: 未ログイン時の`status`は`"You are not logged in\nYou can log in by running \`adguardvpn-cli login\`"`、exit code `11`。ログイン済み・未接続時は`"VPN is disconnected\n..."`、exit code `0`）。テキスト出力のパーサー（`api/src/profile/response-parser.ts`の`parseTextOutput`）は、大文字小文字を無視した単語境界一致で`"connected"`という語の有無のみを判定基準とする（`"disconnected"`は`"connected"`を部分文字列として含むが、単語境界一致では誤検出しない）。**CLIは国コードを出力しない**（`status`は都市名のみ: `Connected to TOKYO in TUN mode, running on tun0`、`connect`は`Successfully Connected to TOKYO`）ため、国コード(country)はCLI出力から取得しない。接続先の都市名は`ConnectionStatus.location`として取れた場合のみ付与する（補助情報。取れなくても接続状態の判定には影響しない）。国コードは下記「接続先国の永続化」で補う。
- **`login`アクションと`completionPattern`**: `login`はブラウザでのOAuth認証（デバイスコードフロー）完了を待つため、URLを出力した後も認証完了まで（最大約30分、CLI組み込みの制限）プロセスが終了しない。そのため`ActionDef`に`completionPattern`（正規表現文字列）を追加し、プロキシ側はstdoutがこのパターンに一致した時点でプロセスをkillせず応答する（`proxy/src/exec/command-runner.ts`の`runDetachableCommand`、内部プロトコルの`completionPattern`フィールド参照）。実機で確認した実際の出力: `"You need to authorize in your browser. The following link will be available for 1799 seconds: https://auth.adguard.io/device_code?user_code=XXXX-XXXX"`。
- **`connect`に`-y`フラグを付与**: execFile/spawnで実行するため対話的な確認プロンプトへ入力できない。`-y`（自動でyes回答）を付けないと、プロンプトが発生した場合にtimeoutMsまで応答が返らずタイムアウトする恐れがある。
- **`countries`一覧の出典と鮮度（Phase 8で廃止。上記「Phase 8における具体プロファイル」参照）**: ログイン済みの実CLIで`adguardvpn-cli list-locations`を実行し、出力された一意なISOコード62件をそのまま採用した（2026-09-06時点）。この一覧はAdGuard側のサーバ増減により変化しうるため、管理者は定期的に`list-locations`を再実行し本ファイルを更新すること。
- **ログイン情報の永続化**: 実CLIは認証情報を`$HOME/.local/share/adguardvpn-cli`に保存する。プロキシコンテナ再作成のたびに再ログインが必要にならないよう、この配下をnamed volumeでマウントする（`docker-compose.yml`の`adguard-data`ボリューム参照）。
- **未検証事項（要実機接続検証）**: `connect`実行時に確立されたトンネル経由の実通信、および接続成功時の`status`/`connect`の正確な標準出力文言は、開発環境の制約（後述）によりこの実装時点では未検証。運用開始前に実際の接続で確認すること。

開発環境の制約: 本Phase 2の実装は、実際にインストールした実CLI（ログイン済み）に対して`status`・`login`・`list-locations`・`--help`系コマンドを実行し出力を確認した上で行ったが、`connect`（実際にトンネルを確立する操作）は、それを実行する開発環境自体のデフォルトルートを書き換えてしまい作業用ネットワーク接続を切断するリスクがあったため、意図的に実行していない。

## Phase 8における具体プロファイル

Phase 8（`wbs/phase8.md`）で、静的な`countries`と`enumFrom`による許可値検証を廃止し、接続先を実CLIの`list-locations`から都度取得する方式へ変更した（`countries`が陳腐化する問題、および国コード指定では米国の12都市などを選べない問題の解消）。

```json
{
  "vendor": "adguardvpn",
  "binary": "/usr/local/bin/adguardvpn-cli",
  "outputFormat": "text",
  "actions": {
    "connect": {
      "argv": ["connect", "-l", "%LOCATION%", "-y"],
      "placeholders": {
        "LOCATION": { "pattern": "^[^\\-\\s\\x00-\\x1f\\x7f][^\\x00-\\x1f\\x7f]{0,62}$", "source": "locations" }
      },
      "timeoutMs": 30000
    },
    "disconnect": { "argv": ["disconnect"], "placeholders": {}, "timeoutMs": 15000 },
    "status": { "argv": ["status"], "placeholders": {}, "timeoutMs": 8000 },
    "login": { "...": "変更なし" },
    "listLocations": { "argv": ["list-locations"], "placeholders": {}, "timeoutMs": 15000 }
  }
}
```

- `countries`フィールドを削除した。
- `placeholders.<KEY>.source`に`"locations"`を追加した。値が、直前に`listLocations`アクションで取得した接続先から導出した「接続時の指定名」（下記「接続先の識別と接続時の指定名」）のいずれかに一致することを検証する。`"enum"`（`enumFrom`の配列に含まれること）は従来どおり使える（`enumFrom`は`source: "enum"`のときのみ必須）。許可値はプロファイルではなく実行時に決まるため、`resolveArgv`は呼び出し元から許可値の集合（プレースホルダー名→値の配列）を受け取る。
- `pattern`は許可値検証の前段の防御（先頭が`-`でないこと＝CLIオプションとして解釈されない、制御文字・空白のみでない、長さ上限）であり、都市名の文字種は制限しない（`São Paulo`等の非ASCII都市名が実在し、実CLIも接続できることを実機確認した）。argvはシェルを経由しないため、記号を許してもコマンド注入にはならない。
- `listLocations`のアクション名は、他のアクション名（`connect`等）と同様のキャメルケースとし、実CLIのサブコマンド名（`list-locations`）とは`argv`で対応付ける。
- 管理者向け設定の`countries`を編集していた運用（`wbs/phase2.md`申し送り「経年劣化」）は不要になる。

# ユーザ向け設定の具体スキーマ

Web UIから変更可能な運用設定（目的・意味は../requirements.md参照）。APIサーバが永続化（設定ファイルまたは軽量DB、例 SQLite）し、プロキシサーバへの反映が必要なものはUDS経由で通知する。

| 設定項目 | 型 | 説明 |
|---|---|---|
| `killSwitch` | boolean | ONの場合、VPN切断検知時にLAN側通信を遮断する（デフォルト: true） |
| `excludedDomains` | string[] | VPNトンネルを経由させない宛先ドメイン（split-tunnel除外リスト） |
| `transparentGatewayEnabled` | boolean | 透過ゲートウェイモードの有効/無効 |
| `explicitProxyEnabled` | boolean | 明示的SOCKS5/HTTPプロキシモードの有効/無効 |
| `explicitProxyAllowedCidrs` | string[] | 明示的プロキシモードで接続を許可するLAN側CIDR |

`defaultCountry`はPhase 8で廃止した（接続処理に使われておらず、「最後に接続した接続先」の記憶がその役割を担うため。下記「接続先（ロケーション）」）。既存の設定ファイルに`defaultCountry`が残っていても、読み込み時に無視して次回の保存で消える。

# APIエンドポイント一覧（例）

AGENTS.mdのAPI設計原則（パスに動詞を含めない、HTTPメソッドで操作の意味を表現する、リソースを明確に特定する）に従う。

ベンダー（VPNクライアント操作プロファイル）はサーバ管理者が1台のサーバにつき1種類のみ設定するものであり、APIの仕分け対象ではない。ベンダーロックインを防ぐ手段は実行コマンドを管理者向け設定に外だしすることであって、APIでベンダーを選択・識別できるようにすることではないため、パスにベンダーは含めない。`connection` をリソースの単位とする。

| メソッド | パス | 説明 |
|---|---|---|
| `GET` | `/v1/connection` | 現在の接続状態を取得（接続中は`country`・`location`・`locationId`を含みうる。下記「接続先国の永続化」参照） |
| `PUT` | `/v1/connection` | 接続/切断を制御する（bodyに `connect`（boolean）と、接続時は `locationId`（接続先ID）を指定。接続中に別の`locationId`で呼ぶと接続先を変更する。Phase 8で`country`から変更） |
| `GET` | `/v1/connection/locations` | 選択可能な接続先（国・都市・ping値。お気に入り・前回接続の別を含む）をping昇順で取得（Phase 8。`GET /v1/connection/countries`を置換） |
| `PUT` | `/v1/connection/locations/{locationId}/favorite` | 接続先をお気に入りに登録する（冪等。Phase 8） |
| `DELETE` | `/v1/connection/locations/{locationId}/favorite` | 接続先のお気に入りを解除する（冪等。Phase 8） |
| `GET` | `/v1/connection/config` | ユーザ向け設定を取得 |
| `PUT` | `/v1/connection/config` | ユーザ向け設定を更新 |
| `GET` | `/v1/connection/log` | 接続・操作履歴（監査ログ）を取得 |
| `GET` | `/v1/connection/gateway` | 透過ゲートウェイ／Kill Switch（Phase 4以降は明示的プロキシも）の実際の稼働状況を取得（Phase 5で追加。下記「稼働状況取得」参照） |
| `POST` | `/v1/session` | VPNクライアントへのログインを代行する（`cli login` 実行時に払い出されるログインURL等をクライアントへ返却する） |

# OpenAPI仕様の生成・公開方針

- Fastify + TypeBox でリクエスト/レスポンスのスキーマを定義し、`@fastify/swagger` によりOpenAPI仕様を自動生成する。
- 手書きのOpenAPI YAMLやサーバスタブの生成・同期は行わない（スキーマがそのまま実装かつ仕様書の唯一の情報源となる）。
- 生成されたOpenAPI仕様は `/openapi.json`（または同等のパス）で公開し、orvalがこれを読み込んでWeb側クライアントを生成する。
- 後述のプロキシとの内部通信経路（UDS）は、このOpenAPI仕様の対象に含めない。

# プロキシとの内部通信仕様

- 通信経路: APIコンテナとプロキシコンテナが共有するDocker名前付きボリューム（例 `ctl-socket`）上のUnixドメインソケット（例 `/var/run/vpngw-ctl/exec.sock`）。
- APIサーバ側は `undici` の `Agent({ socketPath })` 等でUDS経由のHTTPリクエストを送信する。
- リクエストボディ（内部プロトコル、OpenAPI対象外）:

```json
{
  "vendor": "adguardvpn",
  "binary": "/usr/bin/adguardvpn-cli",
  "resolvedArgv": ["connect", "-l", "jp", "-y"],
  "timeoutMs": 15000,
  "completionPattern": "https://auth\\.adguard\\.io/device_code\\?user_code=[A-Z0-9-]+"
}
```

- `resolvedArgv` は、プレースホルダー検証済みの値を代入した最終的なargv配列（`binary` を含まない、コマンド本体のみ）。
- `completionPattern`（省略可、Phase 2で追加）: 指定された場合、プロキシ側はプロセスの終了を待たずstdoutがこの正規表現(文字列)に一致した時点で応答し、プロセス自体はkillせずバックグラウンドで実行を継続させる。ログイン代行（`login`アクション）のように、ブラウザでの認証完了まで数分かかる長時間プロセスに対応するための拡張点（proxyserver/design.md「実VPNベンダーCLI統合・ログイン代行 (Phase 2)」参照）。
- レスポンスボディには `exitCode`、`stdout`、`stderr`（要約または全量、ログサイズに応じて要検討）を含める。`completionPattern`に一致し応答した場合、`exitCode`は`null`（プロセスは実行継続中で終了コード未確定）になる。
- リクエスト/レスポンスは軽量なランタイムスキーマ検証（zod/TypeBox等）を行い、不正形式のリクエストでプロキシ側プロセスがクラッシュしないようにするが、これはOpenAPI仕様としては公開しない。

## 設定反映（`POST /settings`）内部プロトコル仕様（Phase 3で追加）

`POST /exec`とは別の待受パス（proxyserver/design.md「Phase 1における縮小構成」参照、`/exec`のパスをPhase 1時点で固定していたのはこの追加のため）。`/exec`同様OpenAPI非公開・同一UDSソケット上で待ち受ける。

- 送信タイミング: `PUT /v1/connection/config`でユーザ向け設定が更新されるたび（`api/src/routes/connection-config.ts`）。当初案では`killSwitch`変更時のみの通知を想定していたが、`transparentGatewayEnabled`もプロキシ側のnftables再構成（テーブルの適用/撤去）を要するため、更新後の設定全体を毎回送信する方式に変更した。加えて、APIサーバ起動時にも永続化済みの現在設定を一度送信する（`api/src/server.ts`）。これは、プロキシコンテナが自身では設定を永続化せず本エンドポイントでの通知のみに依存するため、APIコンテナは再作成されずプロキシコンテナのみが再作成された場合に生じうる「再起動後、次の設定変更まで最後に永続化された設定が反映されない」空白期間を緩和するための措置（起動順序の都合上、数回リトライする）。さらに、起動時1回では「APIコンテナは動き続けたままプロキシコンテナだけが再起動された」場合を救えないため、10秒周期（`SETTINGS_RESYNC_INTERVAL_MS`環境変数で変更可）で現在設定を再通知する（`api/src/server.ts`。通知は冪等で、失敗は無視して次周期で再試行する。実機検証で、これが無いとプロキシ単体の再起動後にKill Switchが再構成されずリークすることを確認した）。
- リクエストボディ: `UserSettings`（`api/src/schemas/settings.ts`）をそのまま送信する。

```json
{
  "killSwitch": true,
  "excludedDomains": [],
  "transparentGatewayEnabled": true,
  "explicitProxyEnabled": false,
  "explicitProxyAllowedCidrs": []
}
```

- プロキシ側は`killSwitch`・`transparentGatewayEnabled`のみを用いてnftablesルールセットを再構成する（他フィールドはPhase 4以降で参照予定。proxyserver/design.md「透過ゲートウェイモードの実現方式」「Kill Switch」参照）。
- レスポンスボディ: `{ "applied": boolean }`。`transparentGatewayEnabled=false`、またはLAN側インターフェース名が未設定（インストールスクリプト未実行環境）の場合は`false`（ルール撤去のみ実施、適用は行わない）。
- 通知が失敗（プロキシ未起動等でProxyUnavailableError/ProxyTimeoutError）した場合でも、`PUT /v1/connection/config`自体は失敗させない（設定の永続化は既に成功しているため）。失敗はログにのみ記録し、プロキシ復旧後の次回設定変更または接続状態監視ループでの再構成に委ねる。

## 稼働状況取得（`GET /v1/connection/gateway`、Phase 5で追加）

Web UIのダッシュボードが「設定値」ではなく「実際に適用されている状態」を表示するための読み取り専用エンドポイント。`GET /v1/connection/config`（永続化された設定値）とは別リソースとして扱う（設定はONだがLAN_IFACE未設定で未構成、といった乖離を利用者に示すため）。APIサーバは状態を保持せず、プロキシ内部エンドポイント`GET /status`（proxyserver/design.md参照）へUDS経由で問い合わせた結果を中継する。

```json
{
  "transparentGateway": {
    "state": "active",
    "vpnInterface": "tun0",
    "killSwitchBlocking": false
  }
}
```

- `transparentGateway.state`: `"active"`（nftablesルール適用中）／`"stopped"`（`transparentGatewayEnabled=false`）／`"unconfigured"`（有効設定だが`LAN_IFACE`未設定でルールを構成できない）／`"error"`（有効設定だが直近のnft適用が失敗、または再構成の完了前でルールの実態が不明。実装時に追加）。
- `vpnInterface`: 検出中のVPNトンネルIF名。未接続時は省略。
- `killSwitchBlocking`: Kill Switchによりforwardが遮断中（VPN未接続かつ`killSwitch=true`）か。
- **拡張余地**: Phase 4で`explicitProxy`（`state`: `active`/`stopped`/`crashLoop`）を同レスポンスへ追加する。Phase 5時点では含めず、Web UIは暫定的に「未対応」表示とする（wbs/phase5.md参照）。
- proxy未応答時は既存方針どおり`502`／`504`（下記エラーハンドリング方針）。

## 接続先国の永続化（Phase 5で追加）

実CLIは国コードを出力しないため、`GET /v1/connection`が接続国を返せず、Web UIの再読み込み（クライアント側の状態の消失）で「接続国」表示が失われた（Phase 5初期実装ではクライアントのメモリ保持による暫定対応で、再読み込みで消える不具合だった）。クライアントに保持させると再読み込み・別端末・別ブラウザで再現しないため、APIサーバ側で保持する（`api/src/connection-state/connection-state-store.ts`）。

- **【Phase 8での変更】** 要求は国コードではなく`locationId`になった。保存するのは`locationId`と、そこから導出した国コード（`country`）と、`connect`出力から読み取った都市名（`location`）で、`GET /v1/connection`は`locationId`も返す（Webが「現在の接続先」を特定するため）。以下の「国」は「接続先（`locationId`）と国」と読み替える。
- **保存**: `PUT /v1/connection`の接続（`connect=true`）が成功し接続中と判定された時点で、要求した`country`と、`connect`出力から読み取った接続先の都市名（`location`）を`CONNECTION_STATE_FILE`（既定`/var/lib/vpngwgui/connection-state.json`、`api-data`ボリューム上。コンテナ再作成でも保持）へ保存する。接続コマンドが失敗した場合は保存しない。
- **返却**: `PUT`の応答と`GET /v1/connection`は、接続中かつ保存内容が実際の接続先と整合する場合に`country`を付与する。`location`（実CLIが報告する都市名）も併せて返す。
- **整合性（古い国を返さない）**: `status`の都市名が保存時の`location`と異なる場合（VPNがAPI外で再接続された等）は`country`を返さず保存内容を消去する。都市名が保存時・観測時のどちらかで不明な場合は判定できないため保存内容を信頼する。
- **消去**: 切断（`connect=false`）の成功時、`GET /v1/connection`で切断を観測した時（VPN断・proxy再起動を含む）、接続先の不一致を検知した時。保存ファイルが破損・形状不正の場合は例外とせず国なしとして扱う。
- **既知の限界**: 接続先の都市名が同一のまま別経路で国のみ異なる指定で再接続された場合は検知できない（`-l`に対し同じ都市が選ばれる場合のみ。実害は表示のみ）。API外から接続した場合（保存なし）は`country`が返らない（`location`のみ）。

## 接続先（ロケーション）（Phase 8で追加）

### 取得（`GET /v1/connection/locations`）

`listLocations`アクションを実行し、標準出力（表形式）をパースして返す。キャッシュはしない（呼び出しごとに実CLIを実行する。約1秒。ping値の鮮度を利用者の「再計測」操作で決めるため）。

```
ISO   COUNTRY              CITY                           PING ESTIMATE
JP    Japan                Tokyo                          4
US    United States        Las Vegas                      111
CN    China                Shanghai (Virtual)             59
```

```json
[
  { "id": "jp-tokyo", "country": "jp", "countryName": "Japan", "city": "Tokyo", "pingMs": 4, "favorite": false, "lastConnected": true },
  { "id": "cn-shanghai-virtual", "country": "cn", "countryName": "China", "city": "Shanghai (Virtual)", "pingMs": 59, "favorite": true, "lastConnected": false }
]
```

- **パース**: 実CLIの出力は固定幅の表である。国名（`United States`）・都市名（`Las Vegas`）が空白を含むため空白区切りでは分割できず、ヘッダ行（`ISO`/`COUNTRY`/`CITY`/`PING`）の各列の開始位置を基準に切り出す。ANSIエスケープは除去する。ヘッダ行に一致しない行（空行・末尾の案内文）は読み飛ばす。ヘッダが見つからない出力は想定外の出力として例外にする（500。CLIの書式変更を黙って空リストにしないため）。ping値が数値でない行は`pingMs`を省略する。
- **並び順**: `pingMs`昇順（`pingMs`なしは末尾）。同値は元の出力順を保つ（安定ソート）。Web UIはこの順序をそのまま表示する（並べ替えロジックをWebに持たせない）。
- **失敗**: コマンドが非ゼロ終了（未ログイン等）は既存方針どおり422（`stderr`にstdoutを格納、`lib/failure-output.ts`）、プロキシ未応答は502/504。
- **`favorite`**: お気に入りストアに`id`が含まれるか。**`lastConnected`**: 最後に接続した接続先の`id`と一致するか（高々1件）。

### 接続先の識別と接続時の指定名

- **`id`**: `<国コード小文字>-<都市名のslug>`。slugは、都市名をNFD正規化して分音記号（結合文字）を除去し、小文字化し、英数字以外の連続を`-`1つに置換して前後の`-`を除いたもの（例: `Las Vegas` → `las-vegas`、`São Paulo` → `sao-paulo`、`Shanghai (Virtual)` → `shanghai-virtual`）。英数字が残らない場合は`location`とする。URLパスへそのまま置ける文字（`a-z0-9-`）のみで構成する。ベンダーCLIの表示名の揺れに依存しない安定したキーとして、お気に入り・最後の接続先の永続化にも使う。
- **接続時の指定名**: `connect -l`へ渡す文字列は、表示の都市名から末尾の`(Virtual)`（前の空白を含む）を除いたもの。実機で、`Shanghai (Virtual)`のままでは接続に失敗し（`Mumbai (Virtual)`は「There is no location」）、`Shanghai`／`Mumbai`で接続できることを確認した（2026-09-21）。都市名は国名・ISOコードとも衝突しない（実CLIは都市名・国名・ISOコードのいずれでも解釈するが、この一覧では都市名を渡す）。
- 接続先の`id`は`PUT /v1/connection`へ渡され、APIが**その場で`listLocations`を再実行して**該当する行を特定し、その接続時の指定名を`%LOCATION%`へ代入する（許可値＝現在の一覧の全指定名。一覧に存在しない`id`は400）。クライアントから都市名を直接受け取らないことで、任意の文字列がCLIへ渡ることを防ぎつつ、サーバ増減にも追従する。この再取得により、接続操作が約1秒長くなる。

### 接続（`PUT /v1/connection`）の変更

- リクエスト: `{ "connect": true, "locationId": "us-las-vegas" }`／`{ "connect": false }`。`connect=true`で`locationId`がなければ400。`country`は廃止した。
- 接続中に別の`locationId`で呼ぶと接続先を変更する（実CLIの`connect -l`は接続中でも呼べ、現在の接続先を切断してから接続する。実機で確認。Web UIの「接続先を変更」ボタンはこの呼び出しを行う）。
- 成功（接続中と判定）時: (1)接続状態（`connection-state-store`）へ`locationId`・`country`・`location`を保存、(2)**最後に接続した接続先**（`last-location-store`）へ`locationId`を保存する。最後の接続先は切断しても消さない。
- 監査ログの`input`には`{ connect, locationId }`が入る（接続先の国は`locationId`の先頭から読める）。

### 永続化

いずれも`api-data`ボリューム（`/var/lib/vpngwgui/`）上の単一JSONファイル。read-modify-write、競合は考慮しない（`settings-store.ts`と同方針）。ファイルが無い・壊れている場合は空として扱い、例外にしない（お気に入り・前回の接続先を失うだけで動作は継続する）。

| ストア | 環境変数（既定パス） | 内容 |
|---|---|---|
| お気に入り（`locations/favorite-locations-store.ts`） | `FAVORITE_LOCATIONS_FILE`（`favorite-locations.json`） | `{ "ids": ["jp-tokyo", ...] }`。上限200件 |
| 最後の接続先（`locations/last-location-store.ts`） | `LAST_LOCATION_FILE`（`last-location.json`） | `{ "id": "jp-tokyo" }` |

- お気に入りの登録・解除は、`id`が現在の`list-locations`に存在するかを確認しない（CLIを実行せず即応答するため）。形式（`^[a-z]{2}-[a-z0-9-]{1,64}$`）のみ検証し、不正なら400。一覧に存在しない`id`は`GET /v1/connection/locations`に現れないだけで、サーバの再追加時に復活する。
- お気に入りの上限超過は400。

### 配置（AGENTS.mdの規約）

接続先のドメイン知識（表のパース、ID・指定名の導出、お気に入り・最後の接続先の保存）は`api/src/locations/`にまとめる（`location-list-parser.ts`・`location-id.ts`・`favorite-locations-store.ts`・`last-location-store.ts`）。ドメイン非依存の文字列処理（NFD正規化によるslug化）は`lib/`に置く（`lib/slugify.ts`）。

# エラーハンドリング方針

- **【Phase 8】** Fastifyのスキーマ検証エラー（不正なbody・パスパラメータ）も`400`（`invalid_input`）で返す。従来は500になっていた。
- プレースホルダー検証失敗、未知のベンダー指定等の入力エラー: `400 Bad Request`。
- プロキシサーバへの接続失敗（UDS未応答等）: `502 Bad Gateway`。
- プロキシサーバ側でのコマンド実行失敗（非ゼロexit）: `422 Unprocessable Entity` とし、bodyに `exitCode`・`stderr` 要約を含める。実CLIはエラーメッセージをstderrではなくstdoutへ出力するため（例: 接続していない時の`disconnect`は`Failed to disconnect. Process is not running`をstdoutへ出し exit code 14）、`stderr`が空の場合はstdoutを同フィールドへ格納する（`lib/failure-output.ts`。ANSIエスケープ除去・前後空白除去）。
- タイムアウト: `504 Gateway Timeout`。
