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

- `binary` はランナー側の実行可能バイナリ許可リスト（../runner/design.md参照。Phase 11以降は各ランナーが自ベンダーのバイナリ1つだけを許可する）と突き合わせる値であり、APIサーバはこの値を信頼してランナーへ送信する送信データの一部に含める。
- `placeholders.<KEY>.pattern` は正規表現、`enumFrom` は同ファイル内の列挙値（例 `countries`）を指す。APIサーバはWeb UIから渡された値がこの許可条件を満たすかを必ず再検証する。
- ベンダー追加時は、このJSONを1ファイル追加し、そのベンダーのランナー（許可リストに自ベンダーのバイナリを持つコンテナ）を追加するだけで対応できる（Phase 11。詳細は../runner/design.md「VPNベンダーCLI（ランナー）の追加方法」）。

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
- `placeholders.<KEY>.source`に`"locations"`を追加した。値が、直前に`listLocations`アクションで取得した接続先から導出した「接続時の指定名」（下記「接続先の識別と接続時の指定名」）のいずれかに一致することを検証する。（`"enum"`（`enumFrom`）はPhase 12で廃止した。）許可値はプロファイルではなく実行時に決まるため、`resolveArgv`は呼び出し元から許可値の集合（プレースホルダー名→値の配列）を受け取る。
- `pattern`は許可値検証の前段の防御（先頭が`-`でないこと＝CLIオプションとして解釈されない、制御文字・空白のみでない、長さ上限）であり、都市名の文字種は制限しない（`São Paulo`等の非ASCII都市名が実在し、実CLIも接続できることを実機確認した）。argvはシェルを経由しないため、記号を許してもコマンド注入にはならない。
- `listLocations`のアクション名は、他のアクション名（`connect`等）と同様のキャメルケースとし、実CLIのサブコマンド名（`list-locations`）とは`argv`で対応付ける。
- 管理者向け設定の`countries`を編集していた運用（`wbs/phase2.md`申し送り「経年劣化」）は不要になる。

## Phase 9における具体プロファイル（プロバイダ抽象化・プラン制限）

Phase 9（`wbs/phase9.md`）で、プロバイダごとの機能差・プラン制限をデータで表現するため、プロファイルを以下のように拡張する。（**Phase 12で、ベンダー固有の暗黙の既定値を廃止し、下記の項目の一部を必須にした。「Phase 12におけるプロファイルの明示化」参照。以降の表の「既定」「省略時は従来のAdGuard形式」は、Phase 12で廃止された記述である**。）設計の全体像は../design.md「プロバイダ抽象化アーキテクチャ」。

```json
{
  "vendor": "protonvpn",
  "binary": "/usr/bin/protonvpn",
  "outputFormat": "text",
  "loginMethod": "credentials",
  "output": { "locationPattern": "^(?:Server:|Connected to)\\s+(.+?)\\.?\\s*$" },
  "features": { "changeLocation": true, "locationPing": false },
  "actions": {
    "connect": {
      "argv": ["connect", "--country", "%LOCATION%"],
      "placeholders": { "LOCATION": { "pattern": "^[A-Za-z]{2}$", "source": "locations" } },
      "timeoutMs": 90000,
      "restrictedPattern": "not available on the free plan"
    },
    "connectAuto": { "argv": ["connect"], "placeholders": {}, "timeoutMs": 90000 },
    "disconnect": { "argv": ["disconnect"], "placeholders": {}, "timeoutMs": 30000 },
    "status": { "argv": ["status"], "placeholders": {}, "timeoutMs": 15000 },
    "login": {
      "argv": ["signin", "%USERNAME%"],
      "placeholders": { "USERNAME": { "pattern": "^[^\\-\\s\\x00-\\x1f\\x7f][^\\s\\x00-\\x1f\\x7f]{0,127}$", "source": "input" } },
      "timeoutMs": 60000
    },
    "logout": { "argv": ["signout"], "placeholders": {}, "timeoutMs": 30000 },
    "listLocations": {
      "argv": ["countries", "list"],
      "placeholders": {},
      "timeoutMs": 30000,
      "table": { "iso": "Code", "country": "Country" },
      "connectNameFrom": "iso",
      "restrictedPattern": "not available on the free plan"
    },
    "account": {
      "argv": ["config", "list"],
      "placeholders": {},
      "timeoutMs": 15000,
      "notLoggedInPattern": "Authentication required",
      "plans": [
        {
          "id": "free",
          "label": "Free",
          "pattern": "Upgrade to enable|To upgrade to VPN Plus",
          "restricts": ["connectToLocation", "locationList"],
          "restrictionMessage": "無料プランでは接続先を選べません。最速の無料サーバへ自動接続します。"
        }
      ],
      "defaultPlan": { "id": "paid", "label": "Paid" }
    }
  }
}
```

### 追加・変更する項目

| 項目 | 内容 |
|---|---|
| `loginMethod` | `"deviceUrl"`（`login`が認証URLを出力する）／`"credentials"`（ユーザー名・パスワード・2FAコードの入力型）。**Phase 12で必須**（既定なし）。 |
| `actions.connect` | **省略可**に変更（接続先を指定する接続）。`%LOCATION%`を含み、`listLocations`と組で「接続先を指定した接続」（`connectToLocation`）になる。 |
| `actions.connectAuto` | 新規・省略可。接続先を指定しない接続（プロバイダが最速・既定のサーバを選ぶ）。 |
| `actions.login` / `listLocations` | **省略可**に変更（プロバイダ非対応を表す）。`disconnect`・`status`は必須。`connect`と`connectAuto`は少なくとも一方が必須（ロード時に検証し、満たさなければ起動失敗）。 |
| `actions.logout` | 新規・省略可。`DELETE /v1/session`が実行する。 |
| `actions.account` | 新規・省略可。ログイン状態・プランを判定する**副作用のない読み取り専用**コマンド。詳細は下記「ログイン状態・プランの判定」。 |
| `actions.<name>.restrictedPattern` | 新規・省略可。コマンドが失敗したとき、標準出力・標準エラーがこの正規表現に一致すればプラン制限による失敗とみなす（下記「実行失敗からの学習」）。 |
| `actions.<name>.successPattern` | 新規・省略可。終了コードが0以外でも、標準出力・標準エラーがこの正規表現（複数行モード）に一致すれば成功とみなす。CLIの終了コードが実態と合わないベンダー向け（Proton VPN CLIの`disconnect`は、実際の接続を切断したときだけ終了コード1で`Disconnected.`と出力する）。`PUT /v1/connection`とベンダー切替時の切断で使う（`api/src/profile/command-success.ts`）。 |
| `actions.listLocations.table` | 出力表の列名の対応（`iso`・`country`は必須、`city`・`ping`は省略可）。**Phase 12で`listLocations`があるとき必須**（既定なし）。 |
| `actions.listLocations.connectName` | **Phase 12で`connectNameFrom`を置き換え、`listLocations`があるとき必須**。`{ "from": "city"\|"iso", "stripPattern"?: 正規表現 }`。`%LOCATION%`へ代入する接続時の指定名の出典（`city`＝都市名、`iso`＝ISO国コード）と、指定名から取り除く部分（`stripPattern`に一致する部分を空にする。例: 表示にだけ付く注記）。 |
| `placeholders.<KEY>.source` | `"locations"`（実行時に決まる許可値）・`"input"`（利用者入力を`pattern`のみで検証。ログインのユーザー名）・`"secret"`（Phase 12。秘密の入力。`pattern`のみで検証し、**argvに置けず**標準入力（`login.stdin`）にだけ使う。ログ・エラー応答では伏字にする）。`"enum"`・`enumFrom`はPhase 12で廃止した。`pattern`は先頭が`-`でない（CLIオプションと解釈されない）ことを必ず要求する。 |
| `output` | **Phase 12でtext形式のとき必須**。`connectedPattern`（正規表現。フラグ`i`。標準出力が一致すれば接続中）と`locationPattern`（正規表現。フラグ`im`。第1キャプチャが接続先の表示名。一致しなければ接続先は不明）。json形式では使わない。 |
| `displayName` | 新規・省略可（Phase 11）。画面に出すベンダー名。省略時は`vendor`。 |
| `features.changeLocation` / `features.locationPing` | 新規・省略可（既定`true`）。プロバイダが「接続中の接続先変更」「ping値の提供」に対応するか。`false`なら`unsupported`として扱う。 |

`plans`の各要素: `id`（プラン識別子）、`label`（画面表示名）、`pattern`（`account`の出力に対する正規表現）、`restricts`（そのプランで制限するオペレーションの配列）、`restrictionMessage`（省略可。制限理由として画面に出す文）。

## Phase 12におけるプロファイルの明示化（ベンダー非依存）

要件は`../requirements.md`「ベンダー非依存性」、設計の全体は`../design.md`「ベンダー非依存の設計原則」。APIのコードが暗黙に持っていたベンダー固有の既定値を、プロファイルの必須項目へ移す。**動作は変えない**（既存2プロファイルは、従来の既定値と同じ値を明示する）。旧形式（必須項目が欠けたプロファイル）は、欠けた項目を示して起動を失敗させる。互換のための既定値は残さない。

```json
{
  "vendor": "<ID>",
  "loginMethod": "deviceUrl",
  "output": {
    "connectedPattern": "(?<![a-zA-Z])connected(?![a-zA-Z])",
    "locationPattern": "(?<![a-zA-Z])Connected to (.+?)(?: in \\S+ mode|\\s*$)"
  },
  "actions": {
    "listLocations": {
      "argv": ["..."], "placeholders": {}, "timeoutMs": 15000,
      "table": { "iso": "ISO", "country": "COUNTRY", "city": "CITY", "ping": "PING" },
      "connectName": { "from": "city", "stripPattern": "\\s*\\(Virtual\\)\\s*$" }
    },
    "login": {
      "argv": ["signin", "%USERNAME%"],
      "placeholders": {
        "USERNAME": { "pattern": "...", "source": "input" },
        "PASSWORD": { "pattern": "^[^\\x00-\\x1f\\x7f]{1,512}$", "source": "secret" },
        "TWO_FACTOR_CODE": { "pattern": "^[0-9A-Za-z]{4,32}$", "source": "secret", "optional": true }
      },
      "stdin": ["%PASSWORD%", "%TWO_FACTOR_CODE%"],
      "timeoutMs": 60000
    }
  }
}
```

- **`connectedPattern`・`locationPattern`**: 従来は`response-parser.ts`が既定の正規表現を持っていた。text形式では両方を必須にする（json形式は、`status`・`country`を持つ内部規約のまま、ベンダー中立）。
- **`table`・`connectName`**: 従来は`location-list-parser.ts`が列名の既定を、`location-id.ts`が`(Virtual)`の除去を持っていた。`connectName`はロード時に`stripPattern`の正規表現の妥当性を検証する。
- **`loginMethod`**: 必須。`GET /v1/session`は宣言された値を返す。
- **`login.stdin`とsecret**: `credentials`方式のとき、`login`は`stdin`（行のテンプレートの配列）を持つ。各行は、固定の文字列か、`source: "secret"`のプレースホルダー（`%PASSWORD%`・`%TWO_FACTOR_CODE%`）。`optional: true`のプレースホルダーは、値が未指定・空のとき、その行を出さない。`PASSWORD`・`TWO_FACTOR_CODE`・`USERNAME`は、APIの`POST /v1/session`のボディのキー（`password`・`twoFactorCode`・`username`）に対応する固定の語彙である。値は`pattern`で検証する（従来コードが固定で持っていたパスワードの長さ・制御文字の禁止・2FAの形式は、プロファイルの`pattern`へ移る。改行・制御文字を許す`pattern`は、標準入力への余分な行の混入を招くため、ロード時に`\x00-\x1f`を許さない`pattern`だけを`secret`に受理する）。`secret`のプレースホルダーを`argv`に置くプロファイルは、ロード時に失敗させる。
- **`enum`の廃止**: `source: "enum"`・`enumFrom`・`resolveEnumFrom`を削除した。

## オペレーションと実行可否（capability）

オペレーションは固定の語彙（../design.md）で、UIの操作と1対1に対応する。各オペレーションの実行可否は、次の順で評価する（先に該当した原因を採用する）。

| 順 | 原因（`reason`） | 条件 |
|---|---|---|
| 1 | `unsupported` | プロファイルに必要なアクションが無い。`login`＝`login`定義あり、`logout`＝`logout`定義あり、`connectToLocation`＝`connect`と`listLocations`の定義あり、`connectAuto`＝`connectAuto`定義あり、`disconnect`＝常に可、`locationList`＝`listLocations`定義あり、`changeLocation`＝`connectToLocation`可かつ`features.changeLocation!==false`、`locationFavorites`＝`locationList`可、`pingMeasurement`＝`locationList`可かつ`features.locationPing!==false` |
| 2 | `notLoggedIn` | ログイン状態が「未ログイン」と判定された場合の`logout`・`connectToLocation`・`connectAuto`・`locationList`（`disconnect`と`login`は常に可能）。判定不能（不明）のときは制限しない |
| 3 | `planRestricted` | 判定されたプランの`restricts`に含まれる、または実行失敗から学習した制限（下記） |

依存するオペレーションは原因ごと継承する: `changeLocation`は`connectToLocation`に、`locationFavorites`・`pingMeasurement`は`locationList`に従う（プランの`restricts`へ列挙しなくてよい）。`connectToLocation`と`locationList`は**相互に依存**する（接続先を指定できないなら一覧を選べても意味が無く、一覧を取得できないなら接続先を解決できない）。一方だけが実行不可なら、もう一方も同じ原因・理由文で実行不可にする（例: 実行失敗から`connectToLocation`の制限を学習したとき、一覧も理由の枠に置き換わる）。

各オペレーションの応答は`{ "available": boolean, "reason"?: "unsupported"|"notLoggedIn"|"planRestricted", "message"?: string }`。`message`は利用者向けの理由文（日本語。`planRestricted`ではプランの`restrictionMessage`、無ければ「現在のプラン（<label>）では利用できません」。`unsupported`は「このVPNプロバイダでは利用できません」、`notLoggedIn`は「ログインしてください」）。Web UIは文をそのまま表示する。

## ログイン状態・プランの判定（`account`アクション）

実装: `api/src/session/session-probe.ts`。

1. `account`が未定義なら判定しない（ログイン状態・プランとも不明）。
2. `account`を実行する。標準出力・標準エラーをANSI除去して連結した文字列に対して:
   - `notLoggedInPattern`に一致すれば**未ログイン**（終了コードは問わない。Proton VPNは未ログイン時に終了コード2で失敗する）。
   - 終了コードが0以外（上記に該当しない）なら**不明**（プロキシ未応答・タイムアウトも不明）。
   - 終了コードが0なら**ログイン済み**とし、`plans`を先頭から評価して最初に`pattern`に一致した要素をプランとする。どれにも一致しなければ`defaultPlan`。
3. 結果は**30秒間キャッシュ**する（プロセス内メモリ。同時要求は1回の実行にまとめる）。Web UIが5秒周期で取得してもCLIの起動は最大30秒に1回になる。失敗（不明）はキャッシュせず、次の要求で再判定する。ログイン・ログアウトの成功時、および学習した制限の変化時にキャッシュを破棄する。
4. `account`はプラン判定のために有料機能を実行してはならない（../design.md）。読み取り専用のコマンドを選ぶ。

**Proton VPN**: `protonvpn config list`。未ログインは`Error: Authentication required to view feature status.`（終了コード2）。ログイン済みの無料版は、有料機能の値が`Upgrade to enable`になり末尾に`To upgrade to VPN Plus visit: ...`が出る（公式CLI 1.0.3のソースで確認。実機での出力確認は`wbs/phase10.md`）。有料版にはどちらも現れない。**AdGuard VPN**: `license`。実機（CLI 1.7.12）で確認した出力: ログイン済み（PREMIUM）は`Logged in as <メール>`／`You are using the PREMIUM version`（終了コード0）、未ログインは`Please log in to view your license info`（終了コード11）。プロファイルは`premium`・`free`（`using the FREE version`）・既定`unknown`（プラン名「不明」）の3通りで判定し、AdGuard VPN無料版の制限は**実機で確認できていない**ため`restricts`は空（無料版の出力文言も推測。`wbs/phase9.md`「次フェーズへの申し送り」）。`logout`は`adguardvpn-cli logout`。

## 実行失敗からの学習（`restrictedPattern`）

`account`で判定できない制限（判定コマンドが無い、出力に現れない制限）への備え。`connect`・`connectAuto`・`listLocations`が非ゼロで終了し、その出力が当該アクションの`restrictedPattern`に一致した場合、通常の422ではなく**`403 { "error": "operation_restricted", "message", "exitCode", "stderr" }`**で応答し、対応するオペレーション（`connect`→`connectToLocation`、`connectAuto`→`connectAuto`、`listLocations`→`locationList`）を`planRestricted`として記憶する（`api/src/capabilities/restriction-learner.ts`。プロセス内メモリ。理由文は出力の要約）。記憶は、ログイン・ログアウトの成功、およびAPIの再起動で消える（プラン変更後の再ログインで自然に解除される。Proton VPNもプラン変更後の再サインインを案内している）。

**APIは実行前にプラン制限を理由として操作を拒否しない**（プロファイルにアクションが無い`unsupported`のみ`501`で事前に拒否する）。CLIが実行可否の最終判断者であり、キャッシュした判定（最大30秒古い）でアップグレード直後の操作を誤って塞がないため。capabilityはUIの利便のための表示である。

## 接続（`PUT /v1/connection`）の変更

- `connect=true`で`locationId`を指定した場合: `connectToLocation`が`unsupported`なら`501`。指定は従来どおり`listLocations`で解決する（`connectNameFrom`に従い`%LOCATION%`へ代入）。
- `connect=true`で`locationId`が無い場合: `connectAuto`が定義されていればそれを実行する。成功時は接続先IDを保存せず（接続状態の`locationId`・`country`なし。`location`はCLI出力から取れれば付与）、「最後に接続した接続先」も更新しない。`connectAuto`が無ければ従来どおり`400`。
- 失敗時のプラン制限の扱いは上記「実行失敗からの学習」。

## セッション（`/v1/session`）の変更

| メソッド | パス | 説明 |
|---|---|---|
| `GET` | `/v1/session` | ログイン方式・ログイン状態・プランを取得する。`{ "loginMethod": "deviceUrl"\|"credentials", "loggedIn"?: boolean, "plan"?: { "id", "label" } }`。`loggedIn`は不明（`account`なし・判定失敗）のとき省略。`plan`はログイン済みで判定できたときのみ。判定失敗でも`200`（不明として返す。CLIの障害は`GET /v1/connection`等が別途報告する） |
| `POST` | `/v1/session` | ログインする。`loginMethod=deviceUrl`は従来どおり（ボディなし。`{ loginUrl?, message }`）。`credentials`はボディ`{ "username", "password", "twoFactorCode"? }`が必須（無ければ`400`）で、成功時は`{ message }`。`login`が未定義なら`501` |
| `DELETE` | `/v1/session` | ログアウトする（`logout`アクション。成功時`{ message }`。`logout`が未定義なら`501`）。接続状態の保存内容（`connection-state`）を消去する |

`POST /v1/session`の`credentials`方式の入力検証と受け渡し:

- `username`はプレースホルダー`USERNAME`の`pattern`で検証し、argvへ代入する（メールアドレスは秘密ではない）。
- `password`は1〜512文字で、**改行（`\r`・`\n`）・NUL・制御文字を含まない**こと（含むと標準入力へ余分な行が混入し、2FA入力の偽装等になるため`400`）。`twoFactorCode`は`^[0-9A-Za-z]{4,32}$`。
- `password`（と`twoFactorCode`）は、プロファイルの`login.stdin`（行のテンプレート。下記「Phase 12におけるプロファイルの明示化」）に従って行を組み立て、プロキシの`POST /exec`の`stdin`フィールドへ渡す。値が空の行（未指定の2FAコード）は出さない。行の順序・2FAコードの形式は、ベンダーのCLIの入力仕様であり、プロファイルが持つ（コードは持たない。2FAが必要なアカウントでコードが無い場合はCLIが失敗し、422で利用者に再入力を促す）。
- **秘密情報を残さない**: 監査ログの`input`は`{ username }`のみ（パスワード・2FAコードは記録しない）。プロキシ側の監査ログもstdinの内容は記録せず、`stdinProvided: true`のみ記録する。失敗時の`stderr`（422）は、応答へ入れる前にパスワード・2FAコードの部分文字列を伏字にする（CLIが入力を出力へ反映した場合の保険）。Fastifyのリクエストログはボディを出力しない設定のまま維持する。
- 経路の秘匿: ブラウザ〜Webサーバ間はHTTP（TLSなし、LAN限定運用）のため、パスワードはLAN内で平文になる。**既知の制約**として受容する（認証・TLSはPhase 7の課題。`specs/requirements.md`「認証・認可」）。

## 接続先一覧の汎用化

`listLocations.table`・`connectNameFrom`により、`location-list-parser.ts`は列名（ヘッダ行）をプロファイルから受け取って固定幅の表を読む。追加の書式対応:

- ヘッダ直下の区切り行（`-`と空白のみ。Proton VPNの`tabulate`出力）は読み飛ばす。
- `city`列が無い表（Proton VPNの`countries list`は国のみ）では、`city`を持たない接続先とする。`id`は`<国コード小文字>-<slug(国名)>`（例: `us-united-states`）、`connectName`は`connectNameFrom`が`iso`なら国コード（例: `US`。Proton VPNの`--country`は大文字小文字を区別しない）。
- データ行の判定は、従来の「行頭がISO国コード」ではなく、ヘッダで特定したISO列が英字2文字であることとする。
- `LocationSchema.city`は省略可能にする（`city`列が無いプロバイダ用）。

## エンドポイント（Phase 9で追加）

| メソッド | パス | 説明 |
|---|---|---|
| `GET` | `/v1/providers` | 有効なベンダーの一覧（選択中・利用可否を含む）を取得する（Phase 11） |
| `PUT` | `/v1/providers/active` | 使うベンダーを切り替える。接続中なら現在のVPNを切断してから切り替える（Phase 11） |
| `GET` | `/v1/connection/capabilities` | オペレーションごとの実行可否を取得する。`{ "capabilities": { "login": {...}, "logout": {...}, "connectToLocation": {...}, "connectAuto": {...}, "changeLocation": {...}, "disconnect": {...}, "locationList": {...}, "locationFavorites": {...}, "pingMeasurement": {...} } }`。全キーを常に返す。ログイン状態・プランは`account`判定（30秒キャッシュ）を使う。判定不能でも`200`（制限しない） |
| `GET` | `/v1/session` | 上記 |
| `DELETE` | `/v1/session` | 上記 |

`locationList`が不可のときの`GET /v1/connection/locations`は、実行前拒否をしない方針（上記）に従い、`unsupported`のみ`501`、他はCLIの結果に従う。

## ファイル配置（AGENTS.mdの規約）

プロバイダ抽象化のドメイン知識は責務ごとのディレクトリに置く: `api/src/capabilities/`（オペレーションの語彙・実行可否の評価・失敗からの学習）、`api/src/session/`（`account`判定・キャッシュ・ログイン入力の検証）。ドメイン非依存の文字列処理（秘密の伏字化）は`lib/`（`lib/redact.ts`）に置く。プロファイルのスキーマ拡張は`profile/profile.schema.ts`。

## ベンダーの選択（Phase 11）

Web UI利用者が、管理者の有効化したベンダーの中から使うベンダーを選ぶ（`specs/requirements.md`「VPNベンダーの選択（Web UI）」、`specs/design.md`「ベンダーの選択と実行基盤」）。**Phase 9までの「ベンダーは1台につき1種類」を改め、APIは複数ベンダーのプロファイルを持ち、選択中の1つを操作の対象とする**。ベンダーロックインを防ぐ手段（実行コマンドを管理者向け設定として外だしする）は変えない。利用者が選べるのは管理者が有効化したベンダーの識別子だけで、コマンド内容には関与できない。

### 設定と読み込み

| 項目 | 内容 |
|---|---|
| `ENABLED_PROVIDERS`（環境変数） | 有効なベンダーIDのカンマ区切り。**必須（Phase 12で既定を廃止。未設定・空なら起動失敗）**。compose側は`.env`の`VPN_PROVIDERS`から渡す |
| `VENDORS_DIR`（環境変数） | ベンダーバンドルのディレクトリ（既定`/etc/vpngwgui/vendors`。`./vendors`を`:ro`でマウント）。`<ベンダーID>/profile.json`を読む。プロファイル内の`vendor`とディレクトリ名（＝ベンダーID）が一致しなければ起動失敗（Phase 12で旧`VPN_PROFILES_DIR`を置き換え） |
| `CTL_SOCKET_DIR`（環境変数） | UDSのディレクトリ（既定`/var/run/vpngw-ctl`）。ネットワークコンテナは`net.sock`、ランナーは`runner-<ベンダーID>.sock` |
| `STATE_DIR`（環境変数） | 永続化の基点（既定`/var/lib/vpngwgui`）。ベンダー別の状態は`$STATE_DIR/providers/<ベンダーID>/`以下 |
| プロファイルの`displayName`（新規・省略可） | 画面に出すベンダー名（例 `AdGuard VPN`）。省略時は`vendor` |

- 起動時に、有効な全ベンダーのプロファイルを読み込み検証する（1つでも不正なら起動失敗。従来の`VPN_PROFILE_PATH`は廃止）。IDは`^[a-z][a-z0-9]{0,31}$`。有効なベンダーが0個なら起動失敗。
- **選択中のベンダー**は`$STATE_DIR/active-provider.json`（`{ "id": "adguardvpn" }`）に永続化する。無い・壊れている・有効でないIDが入っている場合は、有効なベンダーの先頭を選択中とする（例外にしない）。
- **ベンダー別の状態**（`$STATE_DIR/providers/<ID>/`）: `connection-state.json`（接続先ID・国・都市名）、`last-location.json`、`favorite-locations.json`。ログイン状態・プランの判定キャッシュ、学習した制限は、プロセス内でベンダーIDをキーに別々に保持する。**ユーザ向け設定（`settings.json`）・監査ログはベンダーに依存しないため従来の場所のまま**。
- **旧形式からの移行は行わない**（Phase 12で廃止）。Phase 10より前の旧パス（`$STATE_DIR`直下の`connection-state.json`等）は読まない。未リリースで、実機はPhase 11の起動時に移行済みのため。

### エンドポイント

| メソッド | パス | 説明 |
|---|---|---|
| `GET` | `/v1/providers` | 有効なベンダーの一覧を取得する。`[ { "id", "displayName", "active": boolean, "available": boolean, "unavailableReason"?: string } ]`（有効化された順）。`available`はそのランナーが応答するか（下記）。応答に時間がかかるランナーで一覧が遅くならないよう、各ランナーへの問い合わせは並行・短いタイムアウト（2秒）で行う |
| `PUT` | `/v1/providers/active` | 使うベンダーを切り替える。ボディ`{ "providerId": string }`。成功時`{ "id", "displayName" }`。詳細は下記「切替の手順」 |

`GET /v1/connection`等の既存エンドポイントは、パス・スキーマを変えず、選択中のベンダーを対象にする（`GET /v1/connection`の応答に、選択中のベンダーIDは含めない。ベンダーは`GET /v1/providers`で取得する。ベンダーを識別するためにパスへベンダーを含めない方針は変えない: 操作の対象は「選択中のベンダー」という状態で表す）。

### ランナーの利用可否

`GET /health`（ランナーの内部エンドポイント。../runner/design.md）が`200`を返せば`available: true`。ソケットが無い・接続拒否・タイムアウトなら`available: false`（`unavailableReason`は「ランナーが起動していません」）。**`available: false`のベンダーへは切り替えられない**（`PUT /v1/providers/active`は`502`）。選択中のベンダーのランナーが後から止まった場合、既存のエンドポイントは従来どおり`502`/`504`を返す（自動で他のベンダーへ切り替えない。意図しないベンダーへの接続を避けるため）。

### 切替の手順（`PUT /v1/providers/active`）

1. `providerId`が有効なベンダーでなければ`400`。選択中と同じなら何もせず`200`。
2. 切替先のランナーが利用不可なら`502`（切替えない）。
3. 他の切替・接続操作と競合しないよう、API内で直列化する（切替中に来た他のベンダー操作系リクエスト（`PUT /v1/connection`・`/v1/session`）は`409 provider_switching`。読み取り（GET）は影響しない）。
4. 現在のベンダーのランナーが応答する場合、`status`を実行し、接続中なら`disconnect`を実行する。**切断に失敗したら切り替えず`422`**（VPNが繋がったまま別ベンダーを選ぶ状態を作らない）。現在のランナーが応答しない（`502`/`504`）場合は、切断できないが切替は許可する（止まったランナーに縛られて他のベンダーを使えなくならないため）。
5. 選択中のベンダーを`active-provider.json`へ保存し、監査ログに`{ action: "switch-provider", input: { from, to }, exitCode }`を記録する。
6. ネットワークコンテナへ接続状態の再確認を通知する（`POST /connection-checks`。Kill Switchの状態を即時に更新する）。失敗しても切替自体は成功とする（接続監視ループが追従する）。

切替では、ベンダー別の保存内容（お気に入り・最後の接続先等）は消さない。切替先のベンダーの接続状態は、切替後の`GET /v1/connection`（`status`の実行）で取得する（切替直後は切断中のはずだが、API外で接続されていれば接続中と出る）。

### ネットワークコンテナへの通知（`POST /connection-checks`）

従来は、ベンダーCLIを実行するproxyが、接続・切断のコマンド実行直後にゲートウェイルールを即時に再構成していた（../runner/design.md「ランナーの内部HTTP」）。ランナー分離により、実行するコンテナとルールを持つコンテナが別になったため、**接続・切断・ログアウトのコマンド実行後、および切替後に、APIがネットワークコンテナへ`POST /connection-checks`を送る**（ボディなし。応答`{ "checked": true }`）。失敗（`502`/`504`相当）は握りつぶす（ルールの反映は接続監視ループがいずれ追従するため、操作の成否には影響させない）。

### 監査ログ・エラー

- 監査ログの各エントリに、操作の対象だったベンダーIDを`provider`として付ける（`switch-provider`以外の従来の操作も。旧形式のエントリは`provider`なし）。
- `PUT /v1/providers/active`: `400`（未知・無効なID）、`409`（切替中）、`422`（現在のVPNの切断に失敗。`exitCode`・`stderr`を含む）、`502`（切替先のランナーが利用不可）。

### 内部プロトコルの変更

- `executeVendorCommand`は、ベンダーIDを受け取り、`$CTL_SOCKET_DIR/runner-<ID>.sock`へ送る（ベンダーごとに接続プールを持つ）。リクエストボディは従来（`vendor`・`binary`・`resolvedArgv`・`timeoutMs`・`completionPattern`・`stdin`）のまま。
- `notifySettings`・`fetchProxyStatus`（`POST /settings`・`GET /status`）・`POST /connection-checks`は`$CTL_SOCKET_DIR/net.sock`（旧`exec.sock`）へ送る。
- ランナーの`POST /exec`のレスポンスと、ネットワークコンテナの`/settings`・`/status`の形状は変えない。

### ファイル配置（AGENTS.mdの規約）

ベンダーの管理は`api/src/providers/`にまとめる（`provider-registry.ts`＝有効なプロファイルの読み込み・検証、`active-provider-store.ts`＝選択の永続化、`provider-switcher.ts`＝切替の手順、`provider-state-paths.ts`＝ベンダー別の状態ファイルのパス・旧形式からの移行）。従来のモジュール（`profile-loader`・`connection-state-store`・`last-location-store`・`favorite-locations-store`・`session-probe`・`restriction-learner`・`proxy-client`）は、ベンダーIDを受け取る（または選択中のベンダーを`provider-registry`から取得する）形へ改める。

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

ベンダー（VPNクライアント操作プロファイル）は、Phase 11以降、管理者が有効化した複数のベンダーからWeb UI利用者が選ぶ（下記「ベンダーの選択」）。ただし操作の対象は「選択中のベンダー」という**状態**で表し、既存のエンドポイントのパスにベンダーは含めない（操作ごとにベンダーを指定させると、クライアントが実行環境の違いを意識する必要が生じるため）。`connection` をリソースの単位とする。ベンダーの一覧・切替は専用のリソース（`/v1/providers`）で扱う。

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
| `POST` | `/v1/session` | VPNクライアントへのログインを代行する（`loginMethod=deviceUrl`は`cli login`実行時に払い出されるログインURL等を返却する。`credentials`はユーザー名・パスワード等を受け取りCLIの標準入力へ渡す。Phase 9で拡張） |
| `GET` | `/v1/session` | ログイン方式・ログイン状態・プランを取得する（Phase 9） |
| `DELETE` | `/v1/session` | VPNクライアントからログアウトする（Phase 9） |
| `GET` | `/v1/connection/capabilities` | オペレーションごとの実行可否（プロバイダ非対応・未ログイン・プラン制限）を取得する（Phase 9） |

# OpenAPI仕様の生成・公開方針

- Fastify + TypeBox でリクエスト/レスポンスのスキーマを定義し、`@fastify/swagger` によりOpenAPI仕様を自動生成する。
- 手書きのOpenAPI YAMLやサーバスタブの生成・同期は行わない（スキーマがそのまま実装かつ仕様書の唯一の情報源となる）。
- 生成されたOpenAPI仕様は `/openapi.json`（または同等のパス）で公開し、orvalがこれを読み込んでWeb側クライアントを生成する。
- 後述のプロキシとの内部通信経路（UDS）は、このOpenAPI仕様の対象に含めない。

# プロキシとの内部通信仕様

- 通信経路: APIコンテナと各コンテナが共有するDocker名前付きボリューム（例 `ctl-socket`）上の、**コンテナごとに1つ**のUnixドメインソケット。ベンダーCLIの実行はランナー（`/var/run/vpngw-ctl/runner-<ベンダーID>.sock`、Phase 11）、設定反映（`/settings`）・稼働状況（`/status`）・接続状態の再確認（`/connection-checks`）はネットワークコンテナ（`/var/run/vpngw-ctl/net.sock`。Phase 10まで`exec.sock`）。以下の`POST /exec`はランナー、`/settings`・`/status`はネットワークコンテナの仕様である。
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
- `stdin`（省略可、Phase 9で追加）: 指定された場合、プロキシ側は子プロセスの標準入力へこの文字列を書き込んで閉じる（ユーザー名・パスワード入力型のログイン用。最大4096バイト）。**秘密情報を含みうるため、プロキシ・APIのいずれもログへ内容を出力しない。**
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

- プロキシ側は`killSwitch`・`transparentGatewayEnabled`でnftablesルールセットを、`explicitProxyEnabled`・`explicitProxyAllowedCidrs`で3proxyを再構成する（`excludedDomains`はPhase 6で参照予定。proxyserver/design.md「透過ゲートウェイモードの実現方式」「Kill Switch」「明示的プロキシモードの実現方式」参照）。
- `explicitProxyAllowedCidrs`の各要素はIPv4 CIDR（`a.b.c.d/n`）でなければならず、違反は`PUT /v1/connection/config`が400で拒否し保存しない（3proxyの設定ファイルへ埋め込まれるため、設定行の注入による許可範囲の拡大を入口で防ぐ）。
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
- **`explicitProxy`（Phase 4で追加）**: `{ "state", "socksPort"?, "httpPort"?, "restartCount" }`。`state`は`"active"`（稼働中。`socksPort`・`httpPort`はこの状態のみ付く）／`"stopped"`（`explicitProxyEnabled=false`）／`"unconfigured"`（有効設定だが`explicitProxyAllowedCidrs`が空で起動しない）／`"crashLoop"`（3proxyが起動直後の異常終了を連続して繰り返している）／`"error"`（3proxy設定ファイルの生成・書き込みに失敗）。`restartCount`はプロキシ起動以降の異常終了による再起動回数。`crashLoop`等のproxy側の異常は本エンドポイントの中継で利用者へ届く（proxyserver/design.md「`GET /status`」参照）。
- proxyが`explicitProxy`を含まない旧形式で応答した場合は、形状不一致として例外（502相当）になる（api・proxyは同時にデプロイすること）。
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
- **【Phase 11】** ベンダー切替中の競合: `409 Conflict`（`error: "provider_switching"`）。
- **【Phase 9】** プラン制限によるコマンド失敗（`restrictedPattern`一致）: `403 Forbidden`（`error: "operation_restricted"`。`exitCode`・`stderr`要約を含む）。プロファイルがその操作に対応していない（アクション未定義）: `501 Not Implemented`（`error: "operation_unsupported"`）。

## プランで接続できる接続先の参考一覧（Phase 14）

要件は`requirements.md`「プランで接続できる接続先の参考一覧」。

### プロファイルの拡張（`account.plans[].availableLocations`、省略可）

```json
"availableLocations": {
  "file": "VPN/serverlist.json",
  "list": "LogicalServers",
  "country": "ExitCountry",
  "city": "City",
  "where": [ { "field": "Tier", "equals": 0 }, { "field": "Status", "equals": 1 } ],
  "countryAliases": { "UK": "GB" }
}
```

| 項目 | 内容 |
|---|---|
| `file` | サーバ一覧（JSON）のパス。`<PROVIDER_CACHE_DIR>/<ベンダーID>/`からの相対。この配下の外を指す指定（`..`・絶対パス）は無効（空の一覧になる）。 |
| `list` | サーバの配列を持つ最上位のキー。 |
| `country` / `city` | 各サーバの、国コード（文字列）・都市名（文字列。省略可・欠けたサーバは都市なしとして数える）の項目名。 |
| `where` | 当該プランで使えるサーバの条件（全て満たすもの）。`field`が`equals`と等しい（数値・文字列）。 |
| `countryAliases` | 国コードの読み替え（ISO 3166-1と異なる独自コードのため。省略可）。名称の解決にだけ使い、返す`code`は元の値。 |

- 読み込み時の検証: `list`・`country`・`file`が空でないこと。

### エンドポイント（`GET /v1/connection/available-locations`）

- 選択中のベンダーの現在のプラン（`account`の判定結果。30秒キャッシュ）の`availableLocations`を読む。プランが不明・未ログイン・`availableLocations`が無い場合は空。
- 応答: `{ "locations": [ { "code": "JP", "name": "日本", "cities": ["Osaka", "Tokyo"] } ] }`。`name`は`Intl.DisplayNames`（ja）で解決し、解決できなければ`code`。国名の日本語順に並べる。`cities`は重複を除き昇順。
- ファイルの読み取り失敗（無い・壊れている・置き場の外）は空の一覧（`200`）。サーバのドメイン・IP・IDは応答に含めない。
- ファイルはリクエストごとに読む（数MBのJSON。Web UIは、制限表示の間、ベンダー切替・プラン変更時にだけ取得するため頻度は低い）。

### 参照するキャッシュの置き場

- `PROVIDER_CACHE_DIR`（既定`/var/lib/vpngwgui-provider-cache`）配下に、ベンダーごとの読み取り専用のキャッシュを`<ベンダーID>/`として置く。ランナーがCLIのキャッシュに使うボリュームを、APIコンテナへ読み取り専用でマウントする（ランナーの実行部は変更しない。APIはCLIを起動せずファイルだけを読む）。マウントの記述はベンダー固有のため、Phase 12のベンダーバンドルへ移す対象（現状は`docker-compose.yml`）。
- APIは非rootで起動し、ランナーのキャッシュファイルと同じUID/GID（10001）で読む。

### ファイル配置（AGENTS.mdの規約）

- `api/src/locations/plan-locations.ts`（抽出。純粋関数＋ファイル読み取り）、`api/src/routes/connection-available-locations.ts`（ルート）、`api/src/profile/profile.schema.ts`（スキーマ）。
