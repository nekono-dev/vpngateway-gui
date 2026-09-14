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

- **`outputFormat: "text"`**: 実CLIはJSONではなく人間可読なテキストを標準出力する（例: 未ログイン時の`status`は`"You are not logged in\nYou can log in by running \`adguardvpn-cli login\`"`、exit code `11`。ログイン済み・未接続時は`"VPN is disconnected\n..."`、exit code `0`）。テキスト出力のパーサー（`api/src/profile/response-parser.ts`の`parseTextOutput`）は、大文字小文字を無視した単語境界一致で`"connected"`という語の有無のみを判定基準とする（`"disconnected"`は`"connected"`を部分文字列として含むが、単語境界一致では誤検出しない）。**接続先国(country)は、確実に抽出できる固定書式を実機で確認できなかったため取得しない**（サードパーティ製の同CLIラッパー実装でも、出力書式のバージョン間ドリフトを理由に同様の割り切りをしている）。`ConnectionStatus.country`は元々optionalであり、この割り切りと整合する。
- **`login`アクションと`completionPattern`**: `login`はブラウザでのOAuth認証（デバイスコードフロー）完了を待つため、URLを出力した後も認証完了まで（最大約30分、CLI組み込みの制限）プロセスが終了しない。そのため`ActionDef`に`completionPattern`（正規表現文字列）を追加し、プロキシ側はstdoutがこのパターンに一致した時点でプロセスをkillせず応答する（`proxy/src/exec/command-runner.ts`の`runDetachableCommand`、内部プロトコルの`completionPattern`フィールド参照）。実機で確認した実際の出力: `"You need to authorize in your browser. The following link will be available for 1799 seconds: https://auth.adguard.io/device_code?user_code=XXXX-XXXX"`。
- **`connect`に`-y`フラグを付与**: execFile/spawnで実行するため対話的な確認プロンプトへ入力できない。`-y`（自動でyes回答）を付けないと、プロンプトが発生した場合にtimeoutMsまで応答が返らずタイムアウトする恐れがある。
- **`countries`一覧の出典と鮮度**: ログイン済みの実CLIで`adguardvpn-cli list-locations`を実行し、出力された一意なISOコード62件をそのまま採用した（2026-09-06時点）。この一覧はAdGuard側のサーバ増減により変化しうるため、管理者は定期的に`list-locations`を再実行し本ファイルを更新すること。
- **ログイン情報の永続化**: 実CLIは認証情報を`$HOME/.local/share/adguardvpn-cli`に保存する。プロキシコンテナ再作成のたびに再ログインが必要にならないよう、この配下をnamed volumeでマウントする（`docker-compose.yml`の`adguard-data`ボリューム参照）。
- **未検証事項（要実機接続検証）**: `connect`実行時に確立されたトンネル経由の実通信、および接続成功時の`status`/`connect`の正確な標準出力文言は、開発環境の制約（後述）によりこの実装時点では未検証。運用開始前に実際の接続で確認すること。

開発環境の制約: 本Phase 2の実装は、実際にインストールした実CLI（ログイン済み）に対して`status`・`login`・`list-locations`・`--help`系コマンドを実行し出力を確認した上で行ったが、`connect`（実際にトンネルを確立する操作）は、それを実行する開発環境自体のデフォルトルートを書き換えてしまい作業用ネットワーク接続を切断するリスクがあったため、意図的に実行していない。

# ユーザ向け設定の具体スキーマ

Web UIから変更可能な運用設定（目的・意味は../requirements.md参照）。APIサーバが永続化（設定ファイルまたは軽量DB、例 SQLite）し、プロキシサーバへの反映が必要なものはUDS経由で通知する。

| 設定項目 | 型 | 説明 |
|---|---|---|
| `killSwitch` | boolean | ONの場合、VPN切断検知時にLAN側通信を遮断する（デフォルト: true） |
| `excludedDomains` | string[] | VPNトンネルを経由させない宛先ドメイン（split-tunnel除外リスト） |
| `defaultCountry` | string | 接続時のデフォルト国 |
| `transparentGatewayEnabled` | boolean | 透過ゲートウェイモードの有効/無効 |
| `explicitProxyEnabled` | boolean | 明示的SOCKS5/HTTPプロキシモードの有効/無効 |
| `explicitProxyAllowedCidrs` | string[] | 明示的プロキシモードで接続を許可するLAN側CIDR |

# APIエンドポイント一覧（例）

AGENTS.mdのAPI設計原則（パスに動詞を含めない、HTTPメソッドで操作の意味を表現する、リソースを明確に特定する）に従う。

ベンダー（VPNクライアント操作プロファイル）はサーバ管理者が1台のサーバにつき1種類のみ設定するものであり、APIの仕分け対象ではない。ベンダーロックインを防ぐ手段は実行コマンドを管理者向け設定に外だしすることであって、APIでベンダーを選択・識別できるようにすることではないため、パスにベンダーは含めない。`connection` をリソースの単位とする。

| メソッド | パス | 説明 |
|---|---|---|
| `GET` | `/v1/connection` | 現在の接続状態を取得 |
| `PUT` | `/v1/connection` | 接続/切断を制御する（bodyに `connect`（boolean）や `country` 等の接続状態を指定） |
| `GET` | `/v1/connection/countries` | 選択可能な接続国一覧を取得 |
| `GET` | `/v1/connection/config` | ユーザ向け設定を取得 |
| `PUT` | `/v1/connection/config` | ユーザ向け設定を更新 |
| `GET` | `/v1/connection/log` | 接続・操作履歴（監査ログ）を取得 |
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

# エラーハンドリング方針

- プレースホルダー検証失敗、未知のベンダー指定等の入力エラー: `400 Bad Request`。
- プロキシサーバへの接続失敗（UDS未応答等）: `502 Bad Gateway`。
- プロキシサーバ側でのコマンド実行失敗（非ゼロexit）: `422 Unprocessable Entity` とし、bodyに `exitCode`・`stderr` 要約を含める。
- タイムアウト: `504 Gateway Timeout`。
