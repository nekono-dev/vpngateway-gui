# システムの構成

システムは3つの実行単位（**ロール**）で構成する。**Webサーバ**（`web`）、**APIサーバ**（`api`）、**ゲートウェイ**（`gateway`。ホストに対するプロキシサーバ（透過ゲートウェイ・Kill Switch・明示的プロキシ）として動作する**ネットワークコンテナ（`proxy`）**と、VPNベンダーごとに用意しCLIを実行する**ランナーコンテナ（`runner-<ベンダー>`）**の組）である（Phase 8で、従来の「ベンダーごとに別のproxyコンテナ」から、ネットワーク制御とCLI実行の責務を分離した）。各ロールはdocker-composeによりサービス化する。

**ロールは、それぞれ独立したホストへ分離して配置できる（Phase 25。下記「デプロイメント構成の分離」）。** ゲートウェイ内の`proxy`・`runner-<ベンダー>`は、透過ゲートウェイ機能が`network_mode: host`を要するため常に同一ホストに同居し、分離の単位としては常に1つにまとまる。単一ホストへ全ロールをまとめて配置する構成（`--role all`。既定）を、最も簡単な導入経路として維持する。

APIサーバからゲートウェイへの制御は、SSHではなく、**ゲートウェイが公開する内部専用HTTPSサーバ**（ランナーは受け取ったテキスト＝解決済みコマンドをそのまま実行するのみ。OpenAPI等の仕様を持つ正式なAPIではない）を介して行う。この経路は、ホストのネットワーク制御（nftables）・VPNベンダーCLIの実行という強い権限を行使できるため、**相互TLS（mTLS。クライアント証明書必須）**で送受信者を認証する。Phase 24までは、同一ホスト内の共有Dockerボリューム上のUnixドメインソケット（UDS）を使い、コンテナ外部からの到達をネットワーク層で物理的に遮断することで安全性を担保していたが、Phase 25でホストを分離できるようにしたため、ネットワーク到達性ではなく暗号学的な認証を境界とする方式へ改めた（詳細は`specs/proxyserver/design.md`「ゲートウェイ制御チャネル」）。ゲートウェイ内部（`proxy`⇄`runner-<ベンダー>`）は、両者が同一ホストに常在する前提が変わらないため、従来どおり共有Dockerボリューム上のUDSを使う。

ネットワークコンテナは、透過ゲートウェイモードを実現するためホストのネットワーク名前空間を共有する必要があり（詳細はSPEC-PROXY.md）、`network_mode: host` を用いる。**ランナーコンテナも、ベンダーCLIが確立するトンネルインターフェースをホスト（ゲートウェイ）のネットワーク名前空間に作らせるため、`network_mode: host`・`NET_ADMIN`・`/dev/net/tun`を用いる**。docker-composeの仕様上 `network_mode: host` と `networks:`（ユーザー定義ブリッジ）は併用できないため、これらのコンテナは他コンテナと同一のDockerブリッジネットワークには参加できない。API⇄各コンテナ間の通信を前述のUDS方式に限定しているのはこの制約への対応でもある。

インストーラ（`curl`1コマンドで、クリーンなDebian系ベアメタルへ導入・起動する。下記「インストーラと頒布（Phase 11）」）が、ホスト（VPNゲートウェイ）に届く通信を、内部のプロキシコンテナを通して外部通信するように設定を行う。設定はコマンドではなく設定値ベースで行う。

プロキシコンテナは `restart: always` 等により永続稼働するデーモンとなるため、永続化が必要な設定（例: IPフォワーディングの有効化）はインストールスクリプトが一度だけ行い、ホスト上のファイルとして最小限の数に絞って残す。一方、VPN接続のたびに変わるトンネルインターフェース名に依存するNAT/FORWARDルールのように、静的ファイルとして表現できず実行時に変化する値は、プロキシコンテナ起動中のプロセスが動的に適用・撤去する。

## Webサーバの責務

WebサーバはGUIの表示、およびAPIのkick、実行結果のユーザ表示など、プレゼンテーション層以上の責務を持たない。

ブラウザからAPIサーバへ直接クロスオリジンでリクエストを送るのではなく、Webサーバがブラウザから見て同一オリジンで `/api/*` をAPIサーバへリバースプロキシする。これによりCORS設定が不要になるほか、Cookieベースの認証（Phase 25「認証・認可の設計方針」）をドメイン分離に起因する問題（レガシー構成での実例あり）を避けて追加できる。**Webサーバ⇄APIサーバ間がホストをまたぐ構成（Phase 25）でも、この同一オリジン構成は変えない。** Webサーバのリバースプロキシ先（`API_ORIGIN`）を任意ホストのHTTPS URLへ向けられるようにするだけで、ブラウザからは常にWebサーバの単一オリジンにのみアクセスする構成を維持する（`specs/webserver/design.md`「Web⇄API通信経路の実装」）。

## APIサーバの責務

APIサーバはWebサーバから送信されたAPI命令、および管理者向け設定（VPNクライアント操作プロファイル）とユーザ向け設定を元に、プレースホルダーに投入される値をallowlist・正規表現で検証した上でコマンド（argv配列）を解決し、**選択中のベンダー**のランナーへ、ゲートウェイの内部HTTPS（mTLS）サーバ経由でそのコマンドを送信することで、ベンダーCLIを制御することが責務である（ネットワーク設定の反映は、同じ経路でネットワークコンテナへ別途通知する）。Web UIで選択されたベンダーの保持・切替も責務とする（`specs/design.md`「ベンダーの選択と実行基盤」）。

この内部HTTPサーバとの通信経路は、テキスト（解決済みコマンド）をそのまま実行させるための内部チャネルであり、正式なAPIではないため、後述のOpenAPI定義の対象外とする。

## プロキシサーバ（ネットワークコンテナ）の責務

ネットワークコンテナ（`proxy`）は、以下2つのモードに両対応する。ベンダーCLIは実行しない（それはランナーの責務）。

- **透過ゲートウェイモード**: LAN機器がこのホストをデフォルトゲートウェイとして設定した場合に、そのフォワード通信をVPNトンネル経由でNAT/MASQUERADEし、実際にクライアントがホスト（ゲートウェイ）を介した通信にあたってVPNトンネル越しに通信できるようにする。
- **明示的プロキシモード**: ホストがSOCKS5/HTTPプロキシサーバとして利用できるようなポート解放を行い、クライアントが個別にプロキシ設定することでVPNトンネル越しに通信できるようにする。

VPNトンネルが切断された場合の挙動は、ユーザ向け設定「**Kill Switch**」で制御する。ONの場合はLAN機器の通信を遮断し（フェイルクローズ）、VPN非経由での通信を防ぐ。OFFの場合は直接インターネットに抜ける（フェイルオープン）。デフォルトはONを推奨する。

## ランナーコンテナの責務

ランナーコンテナ（`runner-<ベンダー>`。要件・設計・タスクは`runner/`）は、そのベンダーのCLIを実行する環境と、実行要求の受け口（許可リストで自ベンダーのバイナリのみ許可する内部HTTPサーバ）だけを持つ。CLIが確立するトンネルをホストのネットワーク名前空間に作るため`network_mode: host`で動くが、透過ゲートウェイ・Kill Switch・明示的プロキシには関与しない。

# プロバイダ抽象化アーキテクチャ（Phase 7・9）

プロバイダ（AdGuard VPN・Proton VPN等）ごとの機能差・プラン制限を、コードの分岐ではなく**管理者向け設定（プロファイル）のデータ**として表現する。APIサーバは「操作（オペレーション）」単位の実行可否（capability）を計算してWebサーバへ返し、Webサーバはそれに従ってUIを制限する。

```
プロファイル（管理者向け設定）        APIサーバ                         Webサーバ
 ├ actions（存在＝プロバイダ対応）──▶ ① 静的な可否（非対応）
 ├ account（読み取り専用の判定コマンド）─▶ ② ログイン状態・プランの自動判定（短時間キャッシュ）
 ├ plans[].restricts（プラン制限）─────▶ ③ プラン制限
 └ actions.*.restrictedPattern ────────▶ ④ 実行失敗からの学習（フォールバック）
                                        └▶ GET /v1/connection/capabilities ──▶ 操作ごとに有効/無効＋理由を表示
```

- **オペレーション（操作）**: Web UIの操作単位を表す固定の語彙。`login` `logout` `connectToLocation`（接続先を指定した接続）`connectAuto`（接続先を指定しない接続）`changeLocation`（接続中の接続先変更）`disconnect` `locationList`（接続先一覧の取得）`locationFavorites` `pingMeasurement`（ping値の計測・再計測）。プロバイダが増えても語彙は変えない（プロバイダごとの差は、各オペレーションが可能か否かのデータで表す）。
- **実行不可の原因**は`unsupported`（プロバイダ非対応）・`notLoggedIn`（未ログイン）・`planRestricted`（プラン制限）の3種で、Web UIは原因に応じた理由文を表示する。
- **判定は副作用のない情報のみ**から行う。プラン判定のために有料機能を実際に実行して確かめる（例: 無料版で失敗することを確かめるために接続コマンドを試す）ことはしない。有料版では実際に接続してしまうため。プロバイダごとに用意された読み取り専用コマンド（Proton VPN: `config list`。無料版では有料機能が`Upgrade to enable`と表示される）の出力で判定する。
- 判定に失敗・不能な場合は制限しない（fail-open）。実行時にCLIが失敗した場合の出力が`restrictedPattern`に一致すれば、以後その操作を制限として学習する（`403 operation_restricted`）。
- ログイン方式は`loginMethod`（`deviceUrl`: URL提示型 / `credentials`: ユーザー名・パスワード入力型）で宣言する。

## ベンダーの選択と実行基盤（Phase 8）

Web UI利用者が、管理者の有効化したベンダーの中から使うベンダーを選ぶ（`specs/requirements.md`「VPNベンダーの選択（Web UI）」）。接続は常に1ベンダーのみ（切替式）。

```
ブラウザ ─▶ web ─▶ api ─ mTLS TCP ─▶ proxy（ゲートウェイ制御チャネルの受信・ルーティング。ネットワーク: 透過GW・Kill Switch・3proxy・トンネル検出・接続監視）
                                       ├─ UDS net.sock（自分自身）
                                       ├─ UDS runner-adguardvpn.sock ─▶ runner-adguardvpn（AdGuard VPN CLI）
                                       └─ UDS runner-protonvpn.sock ──▶ runner-protonvpn（Proton VPN CLI＋NetworkManager・D-Bus・keyring）
   （proxy・runner-*はいずれも network_mode: host。ランナーのCLIはトンネルをホストのネットワーク名前空間に作る。
    APIからゲートウェイへは常にmTLS TCPの単一経路（`proxy`が窓口）で到達し、proxy⇄runner-*間は同一ホスト常在を前提に従来どおりUDSを使う。Phase 25「ゲートウェイ制御チャネル」参照）
```

- **責務の分離**: ネットワークコンテナ（`proxy`）は、透過ゲートウェイ・Kill Switch・明示的プロキシ・トンネル検出（`ip route get`。ベンダー非依存）・接続監視に加え、**ゲートウェイ制御チャネル（APIからのmTLS TCP接続の受信と、ランナーへのUDS転送。Phase 25）**を担い、ベンダーCLIそのものは実行しない。ランナー（`runner-<ベンダー>`。**別アプリケーションとして`runner/`に要件・設計・タスクを切り出している**）は、ベンダーCLIを実行する（許可リストの検証と`POST /exec`）だけを担い、ネットワーク制御をしない。これにより、nftables・3proxyの所有者が1つに保たれ（ベンダーごとにproxyを起動すると競合する）、ベンダーCLIごとの重い実行環境（Proton VPNのNetworkManager等）がランナーに閉じる。
- **APIサーバ**は、有効化された全ベンダーのプロファイルを読み込み、**選択中のベンダー**（永続化。既定は有効化された先頭のベンダー）のプロファイルで全ての操作を解決し、そのベンダーのランナーのUDSへ送る。ログイン状態・プランの判定キャッシュ・学習した制限・お気に入り・最後の接続先・保存した接続先は、ベンダーごとに独立に保持する。ベンダーの切替（`PUT /v1/providers/active`）は、接続中なら現在のベンダーを切断してから切り替える（確認はWeb UI）。
- **有効化**: 管理者は、インストーラの`--providers`（例 `--providers adguardvpn,protonvpn`。`install/install.sh`が`.env`の`VPN_PROVIDERS`・`COMPOSE_FILE`へ書く）で有効なベンダーを指定する。**省略時は、その時点で`vendors/`にある全ベンダー（all）を有効にする**（`specs/requirements.md`「インストール」）。APIは`VPN_PROVIDERS`を`ENABLED_PROVIDERS`として受け取り、有効なベンダーのバンドル（`vendors/<ベンダーID>/`。下記「ベンダー非依存の設計原則」）のcompose fragmentだけが`COMPOSE_FILE`に載り、そのランナーだけが起動する。ランナーが起動していない・応答しないベンダーは、選択肢には出るが「利用不可」と表示し、選択できない。
- **ランナーの許可リスト**: ランナーは、自分のベンダーのバイナリ1つだけを実行対象とする（イメージにビルド時に焼き込む`RUNNER_ALLOWED_BINARY`）。APIコンテナが侵害されても、別ベンダーのランナー経由で任意のバイナリを実行できず、許可リストによる「最後の防波堤」は従来どおり働く。
- **切替時のネットワーク**: 切断から新ベンダーへの接続までの間、トンネルは存在しない。Kill Switch ONならLAN機器の通信は遮断、OFFなら直接インターネットへ抜ける（従来の切断時と同じ。トンネル検出はベンダー非依存のため、新ベンダーに接続すればそのインターフェースへ自動的に追従する）。

| 項目 | AdGuard VPN | Proton VPN |
|---|---|---|
| バンドル | `vendors/adguardvpn/` | `vendors/protonvpn/` |
| プロファイル | `vendors/adguardvpn/profile.json` | `vendors/protonvpn/profile.json` |
| ランナーイメージ | `vendors/adguardvpn/Dockerfile`（Alpine。単体バイナリ同梱） | `vendors/protonvpn/Dockerfile`（Ubuntu。CLI・NetworkManager・D-Bus・keyringを同梱） |
| composeのサービス | `runner-adguardvpn`（`vendors/adguardvpn/compose.yml`） | `runner-protonvpn`（`vendors/protonvpn/compose.yml`） |

Proton VPN公式CLIはNetworkManager・gnome-keyring（Secret Service）に依存し、公式にはheadless非対応とされている。Phase 9の最初にランナーコンテナ内で成立するかをPoCで確認し、成立しない場合の代替（ホストへの導入＋D-Bus共有）へ切り替える前提で設計する（詳細は`runner/design.md`「Proton VPN用ランナー」、`wbs/phase9.md`）。

# ベンダー非依存の設計原則（Phase 10）

要件は`requirements.md`「ベンダー非依存性」。本番のソースコード（`api/src`・`proxy/src`・`web/src`・`web/server`・`install/`・composeの本体・共通のDockerfile）は、ベンダーのID・名称・CLIの書式を持たず、ベンダーに対する分岐をしない。差はプロファイルとベンダーバンドルだけに置く。

## 抽象化の対応表（Phase 8までのベンダー固有の埋め込みの置き場所）

| 従来のベンダー固有の埋め込み | 抽象化後 |
|---|---|
| 有効なベンダーの既定値（API・composeとも`adguardvpn`） | 特定のベンダーへの既定は持たない。`VPN_PROVIDERS`（`--providers`）が無ければ、その時点の全ベンダー（all）を既定とする（Phase 17） |
| 旧形式の状態ファイルの移行先（`adguardvpn`固定） | 移行処理を廃止する（未リリースで、実機はPhase 8で移行済み） |
| 接続先の表の列名の既定（`ISO/COUNTRY/CITY/PING`） | `listLocations.table`を必須にする |
| 接続時の指定名の加工（`(Virtual)`の除去） | `listLocations.connectName`（`{ from: "city"\|"iso", stripPattern? }`）。加工はプロファイルの`stripPattern`で表す |
| 接続状態の判定語（`connected`）と接続先の既定の書式 | `output.connectedPattern`・`output.locationPattern`を、text形式で必須にする |
| ログイン方式の既定（`deviceUrl`） | `loginMethod`を必須にする |
| ログインの標準入力の書式（パスワード→2FAの順、2FAの形式） | `login.stdin`（行のテンプレート。空の行は出さない）と、プレースホルダーの`source: "secret"` |
| 静的な列挙値（`enumFrom`。`<ベンダー名>.<項目>`形式） | 廃止（Phase 5以降、どのプロファイルも使わない） |
| composeへのランナー・ボリュームの直書き、`profiles`・AdGuardだけの特例 | ベンダーバンドルのcompose fragment。全ベンダーを同じに扱う |
| `proxy/`直下のベンダー別ファイル（Dockerfile・エントリポイント・NM設定） | ベンダーバンドルへ移す |

例外的に、`loginMethod`の2方式（`deviceUrl`・`credentials`）による処理の分岐は残す。これはベンダーに対する分岐ではなく、プロファイルが宣言する機構に対する分岐である。

## ベンダーバンドル

ベンダー1つを、ディレクトリ1つ`vendors/<ベンダーID>/`で表す。IDは`^[a-z][a-z0-9]{0,31}$`。

| ファイル | 必須 | 内容 |
|---|---|---|
| `profile.json` | ○ | VPNクライアント操作プロファイル（`apiserver/design.md`）。ファイル内の`vendor`とディレクトリ名は一致させる |
| `compose.yml` | ○ | ランナーのcompose fragment。サービス名は`runner-<ベンダーID>`、ソケットは`CTL_SOCKET_PATH: /var/run/vpngw-ctl/runner-<ベンダーID>.sock`、ボリュームは、他のバンドルと重複しない名前にする（既存のログイン情報のボリュームを引き継ぐため、名前は変えない）。`profiles`は使わない。ビルドは`context: .`・`dockerfile: vendors/<ベンダーID>/Dockerfile`のようにリポジトリルート基準で書く（複数のcomposeファイルを併用したとき、相対パスは最初のファイルの位置が基準になるため） |
| `Dockerfile` | ○ | ランナーのイメージ（ベンダーCLIの導入、`RUNNER_ALLOWED_BINARY`の焼き込み。`specs/runner/design.md`） |
| `entrypoint.sh` | 任意 | ランナーのエントリポイント（machine-idの復元、NetworkManagerの起動など、そのベンダー固有の起動処理）と付属の設定ファイル |
| `install-host.sh` | 任意 | ベンダーのCLIがホスト（ベアメタル）へのアプリケーションの導入を要するときだけ置く、ホスト側の追加手順。契約は「インストーラと頒布」 |
| `samples.json` | 推奨 | 実CLIの出力サンプルと期待値（`status`・`listLocations`・`account`）。全ベンダーに同じテストで流す |

- **composeの合成**: composeの本体（`docker-compose.yml`）は`web`・`api`・`proxy`のみを持つ。有効にしたベンダーのfragmentだけを`.env`の`COMPOSE_FILE`（`docker-compose.yml:vendors/<A>/compose.yml:vendors/<B>/compose.yml`）へ並べる。無効なベンダーのランナーは定義自体がロードされないため、起動もビルドもされない。
- **APIのプロファイル読み込み**: `./vendors`を`/etc/vpngwgui/vendors:ro`へマウントし、環境変数`VENDORS_DIR`（既定`/etc/vpngwgui/vendors`）配下の`<ベンダーID>/profile.json`を読む（旧`VPN_PROFILES_DIR`は廃止）。
- **E2E用のモックベンダー**も同じ形のバンドル（`e2e/vendors/mockproton/`）にする。E2Eは、実運用のバンドルとモックのバンドルを同じ方式で合成する。
- **ネットワークコンテナ・ランナーの共通コード**（`proxy/src`）は、ベンダーの名前を持たない。ランナーは`RUNNER_ALLOWED_BINARY`だけを知る。

## 再発防止（機械的な検査）

- **中立性の検査**（`scripts/check-vendor-neutrality.mjs`。ルートの`npm test`から実行する）: 対象は、`api/src`・`proxy/src`・`web/src`・`web/server`・`api/scripts`・`install/`・`docker-compose.yml`・共通のDockerfile・共通のエントリポイントのうち、テストファイル（`*.test.*`）・生成物・依存物を除いたファイル。**コメントも検査する。** 禁止語は、`vendors/*/profile.json`の`vendor`・`displayName`・`binary`のファイル名から動的に作り、加えて`scripts/vendor-neutrality.words`（まだバンドルが無い既知のベンダー名。要件書に登場するもの）を足す。大文字小文字は区別しない。1件でも見つかれば失敗する。
- **バンドルの適合テスト**（`api/src/profile/vendor-samples.test.ts`）: `vendors/*/profile.json`をすべて読み込み検証し、`samples.json`の各ケースを、共通のパーサー・判定処理へ流して期待値と照合する。ベンダーごとの出力の知識がバンドルに閉じる。

# デプロイメント構成の分離とロール別インストール（Phase 25）

`specs/requirements.md`「デプロイメント構成の分離」「通信路の保護」を実現するための設計。

## ロールとcomposeの分割

- `web`・`api`・`gateway`（`proxy`＋有効化した`runner-<ベンダー>`）の3ロールへ、composeファイルを分割する。
  - `compose/web.yml`・`compose/api.yml`・`compose/gateway.yml`（`gateway.yml`はベンダーバンドルの`compose.yml`と従来どおり合成する）。
  - ルートの`docker-compose.yml`は、`--role all`（既定）向けに3ファイルをまとめて含む薄いラッパーとする。
- `install/install.sh`は新規引数`--role <all|web|api|gateway>`（既定`all`）で、そのホストに配置するロールを選ぶ。`.env`の`COMPOSE_FILE`は選んだロールのcomposeファイルだけを並べる（ベンダーの有効化と同じ、追加ファイルの合成方式）。
- 1ホストに複数ロールを配置する構成（例: web＋apiは同居、gatewayだけ別ホスト）も、`--role`を組み合わせて実行することで可能（各ロールのインストールは独立して冪等）。

## ゲートウェイ制御チャネル

APIサーバからゲートウェイへの制御を、Phase 24までのUDS（コンテナごとに1つ、同一ホストの共有Dockerボリューム）から、**`proxy`が単一の窓口となるmTLS TCP**へ置き換える。

- **単一の受信口**: `proxy`（ネットワークコンテナ）だけが、ゲートウェイのLAN側インターフェースでTCPポート（既定`8443`。環境変数`GATEWAY_PORT`）をlistenする。ランナー（`runner-<ベンダー>`）は従来どおり自分のUDS（`runner-<ベンダー>.sock`）だけをlistenし、ゲートウェイホストの外から直接到達可能にはしない。理由: ランナーは有効化したベンダーの数だけ動的に増減し、各ランナーへ個別にTCPポート・証明書を割り当てるとポート管理・証明書発行の手間がベンダー数に比例して増える。`proxy`は常に1つだけ起動する既存の前提（`specs/proxyserver/design.md`「コンテナ構成」）を活かし、単一の証明書・単一のポートに集約する。
- **ルーティング**: `proxy`はTLSを終端した後、パスで振り分ける。
  - `/net/*`: 自分自身の処理（`/net/settings`→`/settings`、`/net/status`→`/status`、`/net/connection-checks`→`/connection-checks`。Phase 24までの処理をそのまま呼ぶ）。
  - `/runners/<ベンダーID>/*`: 対応する`runner-<ベンダーID>.sock`へUDS経由でHTTPリクエストとして転送する（`/runners/<ベンダーID>/exec`→`POST /exec`、`/runners/<ベンダーID>/health`→`GET /health`）。`<ベンダーID>`に対応するソケットが無ければ`502`。
  - `proxy`はリクエストボディを検証・改変せず素通しする（`api/src`が組み立てたリクエストボディの形状は変わらない）。ランナー側の許可リスト（`RUNNER_ALLOWED_BINARY`）による「最後の防波堤」は、転送経路が変わっても従来どおり独立して働く。
- **TLS**: TLS 1.3以上。Node.js組み込みの`tls`/`https`モジュールを使う（外部フレームワーク不要という既存方針を踏襲）。サーバは`requestCert: true`・`rejectUnauthorized: true`とし、APIサーバのクライアント証明書がゲートウェイのCA（下記「証明書のペアリング」）で発行されたものでなければ接続を拒否する。
- **既存の`/settings`・`/status`・`/connection-checks`・`/exec`・`/health`のリクエスト/レスポンス形状は変えない**（`specs/apiserver/design.md`「プロキシとの内部通信仕様」、`specs/runner/design.md`「`POST /exec`の仕様」）。変わるのは、APIサーバがこれらを呼び出す際の経路（UDSのソケットパス→mTLS TCPのURL＋パスプレフィックス）だけである。
- **ファイアウォール（推奨・必須ではない）**: mTLSが主たる境界になるが、多層防御として、ゲートウェイ機のファイアウォールで`GATEWAY_PORT`への到達元をAPIサーバのIPアドレスへ制限することをREADMEで推奨する（本システムが自動設定するものではない）。

## 証明書のペアリング

ロール間の信頼関係（Webサーバ⇄APIサーバ、APIサーバ⇄ゲートウェイ）は、いずれも**「サーバ役がローカルに認証局（CA）と自分のサーバ証明書を生成し、クライアント役がその公開証明書（CA証明書。APIサーバ⇄ゲートウェイ間はさらにクライアント証明書）を、インストーラがSSH経由で取得して配置する」**という共通の仕組みで確立する。個別のペアリングプロトコル（独自のエンドポイント・ペアリングコード等）は作らず、運用者が既に持つSSHアクセス（各ホストへインストーラを実行するために必要な資格情報と同じもの）を再利用する。

| 経路 | 認証方式 | サーバ役 | クライアント役 |
|---|---|---|---|
| ブラウザ⇄web | 片方向TLS | web | ブラウザ（証明書検証はブラウザの自己署名警告に委ねる） |
| web⇄api | 片方向TLS（CA証明書のみ配布） | api | web |
| api⇄gateway | 相互TLS（クライアント証明書も発行） | gateway（`proxy`） | api |

- **単一ホスト構成（`--role all`。既定）**: SSHを使わず、同一ファイルシステム上でCA生成・証明書発行・配置をすべてインストーラが直接行う（追加の引数は不要。従来どおり1コマンドで完結する）。
- **分離構成**: `--role gateway`・`--role api`・`--role web`のうち、**信頼する側（クライアント役）のインストーラが、信頼される側（サーバ役）のホストへSSH接続してペアリングを行う**（サーバ役はSSH接続を待つだけで、能動的な操作をしない）。
  - `install.sh --role gateway [--advertise-host <ゲートウェイのapiから見えるホスト名/IP>]`: 初回実行時、自己署名CA（`gateway-ca`）と、それで署名した`proxy`のサーバ証明書（SAN=`--advertise-host`。省略時は検出したLAN側アドレス）を生成する（`/etc/vpngwgui/pki/gateway/`）。加えて、クライアント証明書の署名要求（CSR）に署名するための補助スクリプト（`install/gateway-issue-client-cert.sh`。CA秘密鍵はゲートウェイ機から出さない）を配置する。
  - `install.sh --role api --gateway-ssh <ユーザー>@<ゲートウェイのSSH先>[:ポート] [--gateway-ssh-key <秘密鍵のパス>] [--gateway-host <apiが接続するゲートウェイのホスト名/IP。省略時は`--gateway-ssh`のホスト部>] [--gateway-port <既定8443>]`: APIサーバ用の鍵ペアとCSRをローカルで生成し、`ssh`で`--gateway-ssh`先へCSRを送って`gateway-issue-client-cert.sh`を実行させ、署名済みのクライアント証明書とゲートウェイのCA証明書を標準出力経由で受け取り配置する（秘密鍵はAPIサーバのホストから外へ出ない）。あわせて、Webサーバ用に自分自身のCA（`api-ca`）とサーバ証明書も生成する。
  - `install.sh --role web --api-ssh <ユーザー>@<APIのSSH先>[:ポート] [--api-ssh-key <秘密鍵のパス>] [--api-host <webが接続するAPIのホスト名/IP>] [--api-port <既定3443>]`: `ssh`で`--api-ssh`先の補助スクリプト（`install/api-export-ca.sh`）を呼び、`api-ca`のCA証明書だけを受け取り配置する（片方向TLSのためクライアント証明書は不要）。`.env`の`API_ORIGIN`を`https://<--api-host>:<--api-port>`へ設定する。
- **再実行（冪等）**: 既にCA・証明書が存在する場合は再生成しない（`install/install.sh`の既存の冪等方針に合わせる）。ペアリングのやり直し（相手ホストの再構築等）が必要な場合は、明示的な`--rotate-pairing`（新設）で再発行する。
- **既知の制約（将来課題）**: 証明書の失効・ローテーションの自動化、外部認証局（Let's Encrypt等）との連携、SSHが使えない環境（踏み台経由等）への対応は、初版のスコープ外とする。

# インストーラと頒布（Phase 11）

要件は`requirements.md`「インストール」。クリーンなDebian系ベアメタルへ、1コマンドで導入・起動する。**インストーラは2層**で、利用者が実行するのは頒布される1本のブートストラップだけである。

```
GitHub Release（タグ）／CIのartifact（ブランチ）
  install.sh  ← ブートストラップ。REF・COMMIT・REPO_URLがCIで埋め込まれている
     │  curl -fsSL <URL> | sudo sh -s -- --providers adguardvpn,protonvpn
     ▼
  ① git・curl等を導入 → ② COMMITを/opt/vpngwguiへ取得（取得後にHEADがCOMMITと一致することを確認）
     ▼
  install/install.sh  ← 本体。リポジトリ内にあり、手動でcloneした場合はこれを直接実行してもよい
     ▼
  Docker（公式リポジトリ）導入 → ホストの最小限の設定 → .env → ベンダーのホスト側手順 → docker compose up
```

## ブートストラップ（`install/bootstrap.sh`。頒布物`install.sh`の雛形）

- 雛形には`@@REF@@`（タグ名またはブランチ名。表示用）・`@@COMMIT@@`（取得するコミットの完全なSHA）・`@@REPO_URL@@`が入る。CIが`install/build-bootstrap.sh <REF> <COMMIT> <REPO_URL>`で置換して`install.sh`を作る（置換漏れがあれば失敗する）。
- 動作: root確認 → `git`・`ca-certificates`が無ければ`apt-get`で導入 → 取得先（既定`/opt/vpngwgui`。環境変数`VPNGW_DIR`で変更可）へ`COMMIT`を取得（`git init`・`git fetch --depth 1 origin <COMMIT>`・`git checkout --detach`。既にある場合は同じ手順で更新する。作業ツリーに未コミットの変更があれば中止する）→ `HEAD`が`COMMIT`と一致することを確認 → `install/install.sh`へ引数をそのまま渡して実行する。
- **ブランチ・タグへの紐付け**: 頒布物は、そのCI実行時のコミットに固定される。ブランチのブートストラップは、そのブランチの最新（CI実行時点）を取得する。

## 本体インストーラ（`install/install.sh`）

既存の`install/`の4本（`setup-sysctl.sh`・`detect-lan-interface.sh`・`setup-boot-guard.sh`・`select-providers.sh`）を、この1本へ統合する（従来の各スクリプトは削除する）。POSIX `sh`で書く。**冪等**で、再実行は更新・ベンダーの変更・修復を兼ねる。

| 引数 | 意味 |
|---|---|
| `--providers <ID>[,<ID>...]` | 有効にするベンダー。`vendors/<ID>/`が無ければ失敗する。省略時は、その時点の全ベンダー（all）を有効にする（Phase 17）。`--role web`では無視する |
| `--lan-iface <名前>` | LAN側インターフェース名を手動で指定する（検出できない・複数NICの場合）。`--role gateway`・`all`のみ |
| `--redetect-lan-iface` | 保存済みのLAN側インターフェース名を捨てて再検出する |
| `--no-start` | 起動（`docker compose up`）をしない |
| `--role <all\|web\|api\|gateway>`（Phase 25） | このホストに配置するロール。既定`all`（従来どおり単一ホストに全ロール）。`specs/design.md`「デプロイメント構成の分離とロール別インストール」参照 |
| `--gateway-ssh <ユーザー>@<ホスト>[:ポート]`、`--gateway-ssh-key <パス>`、`--gateway-host <ホスト名/IP>`、`--gateway-port <既定8443>`（Phase 25） | `--role api`のみ。ゲートウェイとのmTLSペアリングに使う接続情報 |
| `--api-ssh <ユーザー>@<ホスト>[:ポート]`、`--api-ssh-key <パス>`、`--api-host <ホスト名/IP>`、`--api-port <既定3443>`（Phase 25） | `--role web`のみ。APIサーバとのTLSペアリング・`API_ORIGIN`設定に使う接続情報 |
| `--rotate-pairing`（Phase 25） | 既存の証明書・ペアリングを破棄し、再ペアリングする |

処理の順序（`--role`ごとに実施する項目が変わる。詳細は`specs/design.md`「デプロイメント構成の分離とロール別インストール」）:

1. **事前検査**: root、Debian系（`/etc/os-release`の`ID`・`ID_LIKE`）、systemd、CPU（Dockerの公式リポジトリが対応するamd64・arm64・armhfのうち、Debian系の対応するもの）。満たさなければ理由を示して失敗する。
2. **共通の依存**: `ca-certificates curl gnupg git iproute2 nftables`（`apt-get`。導入済みは何もしない）。**Docker**: `docker compose version`が動けば何もしない。動かなければ、Dockerの公式リポジトリ（`/etc/apt/keyrings/docker.asc`と`/etc/apt/sources.list.d/docker.list`）を追加し、`docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin`を導入する（`ID`が`ubuntu`はubuntu、`debian`・`raspbian`はdebianのリポジトリ）。
3. **ホストの設定**: `--role gateway`・`all`のみ、`/etc/sysctl.d/99-vpngwgui.conf`（IPフォワーディング。**このファイルだけを`sysctl -p`で反映**する。`sysctl --system`は、無関係な他のファイルの権限エラー（コンテナ等）で失敗しうるため使わない）と、起動時のKill Switchガード（`vpngwgui-boot-guard.service`。内容は従来の`setup-boot-guard.sh`と同じ）。
4. **証明書のペアリング（Phase 25新設）**: `--role`に応じて「ゲートウェイ制御チャネル」「証明書のペアリング」（`specs/design.md`）の手順を実施する。
5. **`.env`の作成・更新**（他の行は保持）: `LAN_IFACE`（`--role gateway`・`all`のみ。`.env`に無いときだけ、デフォルトゲートウェイの逆引きで検出する。`--lan-iface`・`--redetect-lan-iface`で上書き）、`WEB_PORT`（Web UIを配信するホスト側のポート。優先順は`--web-port` ＞ `.env`の既存値 ＞ 既定80。`docker-compose.yml`の`services.web.ports`が`"${WEB_PORT:-80}:8080"`で参照する。コンテナ内は常に8080固定）、`VPN_PROVIDERS`、`API_ORIGIN`（`--role web`のみ）、`GATEWAY_HOST`・`GATEWAY_PORT`（`--role api`のみ）、`COMPOSE_FILE`（選んだロールのcomposeファイルを並べる）。
6. **ベンダーの決定（Phase 17改訂）**: `--role gateway`・`all`のみ。`--providers`があればそれを使う。無ければ、その時点で`vendors/`にある全ベンダー（all）を使う。対話選択は行わない（`.env`の既存の`VPN_PROVIDERS`は、引数なしの実行では参照しない。initial installでもupdateでも常に「指定 ＞ 全ベンダー」の2択に統一し、新しく`vendors/`へ追加されたベンダーが次回の`--providers`省略時の再実行で自動的に有効化されるようにする）。
7. **ベンダーのホスト側手順**: `--role gateway`・`all`のみ。有効なベンダーの`install-host.sh`があれば実行する（下記の契約）。1つでも失敗したら、起動の前に中止する。
8. **起動**: `docker compose up -d --build --remove-orphans`（無効にしたベンダーのランナーは、`--remove-orphans`で停止・削除される。ログイン情報のボリュームは残す）。`--role web`・`all`は、Web UIが応答するまで待つ（最大約3分）。
9. **完了の表示**: ロールに応じて、Web UIのURL（`--role web`・`all`。`https://<LAN側アドレス>:<WEB_PORT>`）・有効なベンダー（`--role gateway`・`all`）・次の操作（`--role web`・`all`はまずWeb UIへアクセスして管理者アカウント（ユーザー名・パスワード）を設定すること、その後各ベンダーへログインすること。LAN機器のデフォルトゲートウェイの向け先）を表示する。

**`install-host.sh`の契約**（ベンダーバンドルの任意ファイル）: rootで`sh`により実行される。冪等で、非対話であること。実行時の環境変数`VPNGW_ROOT`（取得先）・`VPNGW_VENDOR_ID`が与えられ、カレントディレクトリはバンドルのディレクトリ。ホスト（ベアメタル）へ導入・設定するのはこのファイルだけで、共通インストーラはその内容を知らない。非ゼロ終了はインストールの中止を意味する。現在のバンドル（AdGuard VPN・Proton VPN）は、ホストの追加導入が不要なため、このファイルを持たない（実行環境は全てランナーのコンテナに閉じている）。

**アンインストール（`install/install.sh --uninstall [--keep-data]`。Phase 18・Phase 20）**: 通常のインストール処理は行わず、代わりにこのインストーラ自身が作成したホスト設定を後始末する。処理の順序: (1) `docker compose down --remove-orphans`（コンテナ・ネットワークの削除。既定では`--volumes`も付け、ベンダーのログイン情報も削除する。再導入時にログインを維持したい場合は`--keep-data`を指定し、ボリュームを保持する）。`docker-compose.yml`が無い、またはDockerが使えないホストでは何もしない（未導入・再実行でも安全）。 (2) 起動時のKill Switchガード（`vpngwgui-boot-guard.service`）を`disable --now`してユニットファイルを削除する。 (3) `/etc/sysctl.d/99-vpngwgui.conf`を削除し、稼働中の`net.ipv4.ip_forward`も0へ戻す。 (4) `vendors/`配下の全バンドル（有効・無効を問わない。アンインストール時点で`.env`が古い・無い場合があるため）の`uninstall-host.sh`（あるベンダーだけ）を実行する。**`uninstall-host.sh`の契約**は`install-host.sh`と同じ（環境変数・カレントディレクトリ）だが、非ゼロ終了で全体を中止せず、後始末を最後まで続ける（可能な範囲で後始末する方を優先する）。 (5) **ソース一式の取得先ディレクトリ（`REPO_ROOT`。既定`/opt/vpngwgui`）自体を`rm -rf`で削除する（Phase 20）**。実行中のスクリプト自身を含むディレクトリを削除する形になるが、Linuxでは既に開いているファイル記述子はunlink後も有効なままであるため、`sh`が最後まで読み進めて完走できる（`install/tests/run.sh`のセルフデリートの実機検証で確認）。誤って無関係なディレクトリを削除しないよう、`REPO_ROOT`が空・`/`・`install/install.sh`を含まない場合は中止する安全対策を設ける。削除の直前にカレントディレクトリを`REPO_ROOT`の外（`/tmp`）へ移す。**これにより、頒布されたブートストラップ（`curl -fsSL <頒布URL>/install.sh | sudo sh -s -- --uninstall`）だけでアンインストールが完結する**（ブートストラップが一時的にソースを取得先へ`git clone`してから本体インストーラを呼ぶため、事前にソースを取得しておく必要が無い。未導入のホストで実行した場合は、取得したソースに対して手順(1)〜(4)が実質的に何もせず、(5)で取得したソースを削除するだけになる）。**対象外（意図的に自動化しない。手動で削除する。理由: 他の用途と共有されうる）**: Docker本体・依存パッケージ、Dockerの公式リポジトリ設定（`/etc/apt/keyrings/docker.asc`・`/etc/apt/sources.list.d/docker.list`）。

**ホストへの変更（全て）**: 取得先ディレクトリ（既定`/opt/vpngwgui`）、`/etc/sysctl.d/99-vpngwgui.conf`、`/etc/systemd/system/vpngwgui-boot-guard.service`、Dockerの公式リポジトリ設定（上記2ファイル）とDocker・依存パッケージ、有効なベンダーの`install-host.sh`が行うもの。

**nftables.serviceとの順序**: `nftables.service`（`/etc/nftables.conf`を読み込み`flush ruleset`する）は、Debian 12では`nftables`パッケージを導入しても既定で無効だが、**Raspberry Pi OS（trixie）では既定で有効**である。有効な環境では起動時のルールが消去されうるため、起動ガードのユニットに`After=nftables.service`を付けて、その後に適用する（順序だけで、`nftables.service`が無い・無効な環境でも害はない）。利用者の設定は書き換えない。**既知の制約**: ホストの再起動後にガードが実際にproxyの適用まで維持されるかのKill Switchの実通信での確認、Raspberry Pi OSの32bit（armhf・`ID=raspbian`）、実際のRaspberry Pi機（GPIO・Pi用カーネル等）は未検証。IPv6は対象外。

## 頒布（CI）

- ワークフロー`.github/workflows/installer.yml`。**トリガー**: ブランチへのpush、`v*`タグのpush。**検査**: `sh -n`・`shellcheck`（`install/`）、`npm ci`と`npm test`（中立性の検査を含む）、ブートストラップの生成テスト（置換漏れが無いこと）。
- **ブランチ**: `install.sh`と`install.sh.sha256`を、ワークフローのartifact`installer-<ブランチ名>`（`/`は`-`にする）として保存する（Releaseは作らない）。
- **タグ**: `install.sh`と`install.sh.sha256`をGitHub Releaseへ添付する。利用者が使うURLは、最新: `https://github.com/nekono-dev/vpngateway-gui/releases/latest/download/install.sh`、版の固定: `https://github.com/nekono-dev/vpngateway-gui/releases/download/<タグ>/install.sh`。
- **信頼の範囲**: `curl | sh`はスクリプトの取得元（GitHub ReleaseのHTTPS）を信頼する方式である。ブートストラップは取得するコミットを固定し、取得後にSHAを照合するため、スクリプトとソースの食い違い（タグの付け替え等）は検出できる。`install.sh.sha256`で、ダウンロードして検証してから実行することもできる。

# 認証・認可の設計方針（Phase 25で改訂）

分離配置によりLAN外からの到達性が生じうるため、Web UI利用者の認証を導入する（`specs/requirements.md`「認証・認可」）。Web⇄API間は前述の通り同一オリジン構成のため、ドメイン分離に起因する問題を避けてセッションCookie認証を追加できる（この設計判断はPhase 1〜24から変えていない）。

利用者アカウント（ユーザー名・パスワード）は単一の管理者アカウントとし、**インストーラではなくWeb UIの初回アクセス時に利用者自身が設定する**。以後は設定画面から自由に変更できる（インストーラは`--web-password`のような引数を持たない。2026-09-22改訂: 当初案の「インストーラの引数で指定」から変更）。

- **リソース設計**: 「利用者アカウントそのもの」と「ブラウザのログイン状態（セッション）」を別リソースとして分ける。
  - `/v1/operator`: 単一の管理者アカウント（ユーザー名・パスワード）を表す。未作成（初回アクセス前）／作成済みの状態を持つ。
  - `/v1/operator-session`: ブラウザのログイン状態を表す。既存の`/v1/session`（VPNベンダーへのログイン状態。`specs/apiserver/design.md`）とは別のリソースであり、混同を避けるため命名を分ける（前者はWeb UIの利用者、後者はVPNベンダーアカウントの認証状態を表す）。
- **アカウントの状態確認**: `GET /v1/operator`（認証不要）は`{ "configured": boolean }`を返す（認証済みのリクエストには`username`も含める）。Web UIはこれで「初期設定画面」と「ログイン画面」のどちらを表示するか判断する。
- **初回設定**: `POST /v1/operator`（認証不要。`configured=false`の間のみ許可し、作成済みなら`409`）。ボディ`{ "username": string, "password": string }`。作成に成功したら、そのままログイン済み状態にする（`POST /v1/operator-session`と同様にセッションcookieを発行する）。
- **変更**: `PUT /v1/operator`（要セッションcookie）。ボディ`{ "currentPassword": string, "username"?: string, "newPassword"?: string }`。現在のパスワードと一致しなければ`401`。`username`・`newPassword`のいずれも指定しない場合は`400`。
- **ログイン・ログアウト**:
  - `POST /v1/operator-session`: ボディ`{ "username": string, "password": string }`。一致すれば`Set-Cookie`でhttpOnly・Secure・SameSite=Laxのセッションcookieを発行し`200`。不一致は`401`（アカウント未作成の場合も`401`とし、未作成であること自体は`GET /v1/operator`で判断させる）。
  - `GET /v1/operator-session`: 現在のcookieが有効なら`200`、無効・無ければ`401`。
  - `DELETE /v1/operator-session`: cookieを失効させ`200`。
- **認可の適用範囲**: `GET /v1/operator`・`POST /v1/operator`（未作成時のみ）・`POST /v1/operator-session`を除く、すべての`/v1/*`エンドポイントは有効なセッションcookieを要求する（Fastifyの`preHandler`フック）。`PUT /v1/operator`も認証必須（cookie無し・無効は`401`）。
- **パスワードの保管**: `$STATE_DIR`配下（`api-data`ボリューム）に、ユーザー名とパスワードのハッシュ（Node.js組み込み`crypto.scrypt`）を保存する。APIサーバのコード・環境変数・ログに平文を残さない。
- **セッションの保持**: APIサーバはステートフル（既存の`settings.json`等と同様）なため、セッションはプロセスメモリ上のマップで保持する（軽量なファイル永続化の要否は実装時に判断。複数APIプロセスへのスケールアウトは対象外）。
- **レート制限**: `POST /v1/operator-session`・`PUT /v1/operator`（`currentPassword`の総当たり対策）への総当たり対策として、連続失敗時の一時的な受付制限を設ける（具体的な閾値は実装時に決定）。
- **既知の制約**: 初回設定（`POST /v1/operator`）は、インストール直後にLAN上の誰が先にアクセスしてアカウントを作成するかで決まる（同種の自己ホスト型アプリに共通する制約）。取り合いを避けたい場合は、インストール直後に運用者自身が先にWeb UIへアクセスして設定することを運用でカバーする（READMEに明記する）。
- **Webサーバ側**: 未認証（`GET /v1/operator-session`が`401`）を検知した場合、Web UIは`GET /v1/operator`の`configured`に応じて初期設定画面またはログイン画面へ誘導する（`specs/webserver/design.md`「利用者認証の実装方針」）。Webサーバ自体はcookieの中身を解釈せず、ブラウザ⇄API間で透過的に転送するだけである。

# コーディングルール

Webサーバ用のAPIクライアントは、orvalのようなOpenAPIのクライアント生成ソフトウェアを用いて生成する。Webサーバは必ず生成されたクライアントを用いてAPIサーバにリクエストを送るとする。

APIサーバは Fastify + TypeBox + `@fastify/swagger` を用い、TypeBoxで定義したスキーマからリクエスト/レスポンスの検証とOpenAPI仕様を自動生成する構成とする。生成されたOpenAPI仕様をorvalがそのままWeb側のクライアント生成に利用する。

ただし、APIサーバ⇄プロキシサーバ間の内部コマンド実行チャネル（UDS経由の内部専用HTTPサーバ）はこの限りではなく、OpenAPI仕様の対象外とする。

# 実装フェーズ

実装は`wbs/`配下のフェーズ計画（`wbs/phase1.md`〜`wbs/phase11.md`）に従い段階的に行う。各フェーズの詳細は当該ファイルを参照。フェーズ番号は識別子であり実施順ではない（2026-09-21以降の実施順は `1 → 2 → 3 → 5 → 8 → 4 → 9 → 11 → 10 → 12 → 13 → 6 → 7`。簡易機能版プロトタイプを早期に利用可能にするため、Web UI完成のPhase 4をPhase 6より前に前倒し。`wbs/README.md`参照）。

| 項目 | 最終形（本ファイル） | Phase 1（wbs/phase1.md） |
|---|---|---|
| proxyのネットワーク | `network_mode: host` | 通常のDockerブリッジネットワーク（api/webと同一） |
| proxyの権限 | `cap_add:[NET_ADMIN]`, `devices:[/dev/net/tun]` | 付与しない |
| VPNベンダーCLI | 実CLI（adguardvpn-cli等） | モックCLIスクリプト |
| 透過ゲートウェイ／明示的プロキシ／Kill Switch | 実装する | 実装しない（ユーザ向け設定APIは受理・永続化のみ行う） |
| インストールスクリプト | 実装する | 実装しない |
| Web UI | ダッシュボード＋接続操作＋設定ダイアログ＋接続ログ | ダッシュボード＋接続操作のみ |

Phase 2以降で、本ファイルおよび各サービスdesign.mdに記載の最終形（host networking、nftables、3proxy、Kill Switch実処理、インストールスクリプト、実VPNベンダーCLI、Web設定ダイアログ・接続ログ画面）を段階的に実装する。
