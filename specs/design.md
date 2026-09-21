# システムの構成

システムは、Webサーバ用のコンテナ、Webサーバの信号を受けてVPNクライアントのCLI命令へ変換するAPIコンテナ、ホストに対するプロキシサーバ（透過ゲートウェイ・Kill Switch・明示的プロキシ）として動作する**ネットワークコンテナ（`proxy`）**、およびVPNベンダーごとに用意しCLIを実行する**ランナーコンテナ（`runner-<ベンダー>`）**で構成する（Phase 11で、従来の「ベンダーごとに別のproxyコンテナ」から、ネットワーク制御とCLI実行の責務を分離した）。システムはdocker-composeによりサービス化する。

APIサーバから、ネットワークコンテナ・各ランナーコンテナへの制御は、SSHではなく、**各コンテナ内でのみlistenする内部専用HTTPサーバ**（ランナーは受け取ったテキスト＝解決済みコマンドをそのまま実行するのみ。OpenAPI等の仕様を持つ正式なAPIではない）を介して行う。この内部HTTPサーバは、コンテナ外部（LAN含む）から一切到達不能でなければならない。この制約を満たすため、TCP通信ではなく、APIコンテナと各コンテナ間で共有するDockerボリューム上に、コンテナごとに1つ配置したUnixドメインソケット（UDS）を通信経路とする（ネットワークコンテナ: `net.sock`、ランナー: `runner-<ベンダー>.sock`）。

ネットワークコンテナは、透過ゲートウェイモードを実現するためホストのネットワーク名前空間を共有する必要があり（詳細はSPEC-PROXY.md）、`network_mode: host` を用いる。**ランナーコンテナも、ベンダーCLIが確立するトンネルインターフェースをホスト（ゲートウェイ）のネットワーク名前空間に作らせるため、`network_mode: host`・`NET_ADMIN`・`/dev/net/tun`を用いる**。docker-composeの仕様上 `network_mode: host` と `networks:`（ユーザー定義ブリッジ）は併用できないため、これらのコンテナは他コンテナと同一のDockerブリッジネットワークには参加できない。API⇄各コンテナ間の通信を前述のUDS方式に限定しているのはこの制約への対応でもある。

インストーラ（`curl`1コマンドで、クリーンなDebian系ベアメタルへ導入・起動する。下記「インストーラと頒布（Phase 13）」）が、ホスト（VPNゲートウェイ）に届く通信を、内部のプロキシコンテナを通して外部通信するように設定を行う。設定はコマンドではなく設定値ベースで行う。

プロキシコンテナは `restart: always` 等により永続稼働するデーモンとなるため、永続化が必要な設定（例: IPフォワーディングの有効化）はインストールスクリプトが一度だけ行い、ホスト上のファイルとして最小限の数に絞って残す。一方、VPN接続のたびに変わるトンネルインターフェース名に依存するNAT/FORWARDルールのように、静的ファイルとして表現できず実行時に変化する値は、プロキシコンテナ起動中のプロセスが動的に適用・撤去する。

## Webサーバの責務

WebサーバはGUIの表示、およびAPIのkick、実行結果のユーザ表示など、プレゼンテーション層以上の責務を持たない。

ブラウザからAPIサーバへ直接クロスオリジンでリクエストを送るのではなく、Webサーバがブラウザから見て同一オリジンで `/api/*` をAPIサーバへリバースプロキシする。これによりCORS設定が不要になるほか、将来Cookieベースの認証を追加する際にドメイン分離に起因する問題（レガシー構成での実例あり）を避けられる。

## APIサーバの責務

APIサーバはWebサーバから送信されたAPI命令、および管理者向け設定（VPNクライアント操作プロファイル）とユーザ向け設定を元に、プレースホルダーに投入される値をallowlist・正規表現で検証した上でコマンド（argv配列）を解決し、**選択中のベンダー**のランナーの内部HTTPサーバへUDS経由でそのコマンドを送信することで、ベンダーCLIを制御することが責務である（ネットワーク設定の反映は、ネットワークコンテナの内部HTTPサーバへ別途通知する）。Web UIで選択されたベンダーの保持・切替も責務とする（`specs/design.md`「ベンダーの選択と実行基盤」）。

この内部HTTPサーバとの通信経路は、テキスト（解決済みコマンド）をそのまま実行させるための内部チャネルであり、正式なAPIではないため、後述のOpenAPI定義の対象外とする。

## プロキシサーバ（ネットワークコンテナ）の責務

ネットワークコンテナ（`proxy`）は、以下2つのモードに両対応する。ベンダーCLIは実行しない（それはランナーの責務）。

- **透過ゲートウェイモード**: LAN機器がこのホストをデフォルトゲートウェイとして設定した場合に、そのフォワード通信をVPNトンネル経由でNAT/MASQUERADEし、実際にクライアントがホスト（ゲートウェイ）を介した通信にあたってVPNトンネル越しに通信できるようにする。
- **明示的プロキシモード**: ホストがSOCKS5/HTTPプロキシサーバとして利用できるようなポート解放を行い、クライアントが個別にプロキシ設定することでVPNトンネル越しに通信できるようにする。

VPNトンネルが切断された場合の挙動は、ユーザ向け設定「**Kill Switch**」で制御する。ONの場合はLAN機器の通信を遮断し（フェイルクローズ）、VPN非経由での通信を防ぐ。OFFの場合は直接インターネットに抜ける（フェイルオープン）。デフォルトはONを推奨する。

## ランナーコンテナの責務

ランナーコンテナ（`runner-<ベンダー>`。要件・設計・タスクは`runner/`）は、そのベンダーのCLIを実行する環境と、実行要求の受け口（許可リストで自ベンダーのバイナリのみ許可する内部HTTPサーバ）だけを持つ。CLIが確立するトンネルをホストのネットワーク名前空間に作るため`network_mode: host`で動くが、透過ゲートウェイ・Kill Switch・明示的プロキシには関与しない。

# プロバイダ抽象化アーキテクチャ（Phase 9・10）

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

## ベンダーの選択と実行基盤（Phase 11）

Web UI利用者が、管理者の有効化したベンダーの中から使うベンダーを選ぶ（`specs/requirements.md`「VPNベンダーの選択（Web UI）」）。接続は常に1ベンダーのみ（切替式）。

```
ブラウザ ─▶ web ─▶ api ─┬─ UDS net.sock ────────▶ proxy（ネットワーク: 透過GW・Kill Switch・3proxy・トンネル検出・接続監視）
                          ├─ UDS runner-adguardvpn.sock ─▶ runner-adguardvpn（AdGuard VPN CLI）
                          └─ UDS runner-protonvpn.sock ──▶ runner-protonvpn（Proton VPN CLI＋NetworkManager・D-Bus・keyring）
   （proxy・runner-*はいずれも network_mode: host。ランナーのCLIはトンネルをホストのネットワーク名前空間に作る）
```

- **責務の分離**: ネットワークコンテナ（`proxy`）は、透過ゲートウェイ・Kill Switch・明示的プロキシ・トンネル検出（`ip route get`。ベンダー非依存）・接続監視だけを担い、ベンダーCLIを実行しない。ランナー（`runner-<ベンダー>`。**別アプリケーションとして`runner/`に要件・設計・タスクを切り出している**）は、ベンダーCLIを実行する（許可リストの検証と`POST /exec`）だけを担い、ネットワーク制御をしない。これにより、nftables・3proxyの所有者が1つに保たれ（ベンダーごとにproxyを起動すると競合する）、ベンダーCLIごとの重い実行環境（Proton VPNのNetworkManager等）がランナーに閉じる。
- **APIサーバ**は、有効化された全ベンダーのプロファイルを読み込み、**選択中のベンダー**（永続化。既定は有効化された先頭のベンダー）のプロファイルで全ての操作を解決し、そのベンダーのランナーのUDSへ送る。ログイン状態・プランの判定キャッシュ・学習した制限・お気に入り・最後の接続先・保存した接続先は、ベンダーごとに独立に保持する。ベンダーの切替（`PUT /v1/providers/active`）は、接続中なら現在のベンダーを切断してから切り替える（確認はWeb UI）。
- **有効化**: 管理者は、インストーラの`--providers`（例 `--providers adguardvpn,protonvpn`。`install/install.sh`が`.env`の`VPN_PROVIDERS`・`COMPOSE_FILE`へ書く）で有効なベンダーを指定する。APIは`VPN_PROVIDERS`を`ENABLED_PROVIDERS`として受け取り、有効なベンダーのバンドル（`vendors/<ベンダーID>/`。下記「ベンダー非依存の設計原則」）のcompose fragmentだけが`COMPOSE_FILE`に載り、そのランナーだけが起動する。**既定のベンダーは無い**（指定が無ければAPI・インストーラとも失敗する）。ランナーが起動していない・応答しないベンダーは、選択肢には出るが「利用不可」と表示し、選択できない。
- **ランナーの許可リスト**: ランナーは、自分のベンダーのバイナリ1つだけを実行対象とする（イメージにビルド時に焼き込む`RUNNER_ALLOWED_BINARY`）。APIコンテナが侵害されても、別ベンダーのランナー経由で任意のバイナリを実行できず、許可リストによる「最後の防波堤」は従来どおり働く。
- **切替時のネットワーク**: 切断から新ベンダーへの接続までの間、トンネルは存在しない。Kill Switch ONならLAN機器の通信は遮断、OFFなら直接インターネットへ抜ける（従来の切断時と同じ。トンネル検出はベンダー非依存のため、新ベンダーに接続すればそのインターフェースへ自動的に追従する）。

| 項目 | AdGuard VPN | Proton VPN |
|---|---|---|
| バンドル | `vendors/adguardvpn/` | `vendors/protonvpn/` |
| プロファイル | `vendors/adguardvpn/profile.json` | `vendors/protonvpn/profile.json` |
| ランナーイメージ | `vendors/adguardvpn/Dockerfile`（Alpine。単体バイナリ同梱） | `vendors/protonvpn/Dockerfile`（Ubuntu。CLI・NetworkManager・D-Bus・keyringを同梱） |
| composeのサービス | `runner-adguardvpn`（`vendors/adguardvpn/compose.yml`） | `runner-protonvpn`（`vendors/protonvpn/compose.yml`） |

Proton VPN公式CLIはNetworkManager・gnome-keyring（Secret Service）に依存し、公式にはheadless非対応とされている。Phase 10の最初にランナーコンテナ内で成立するかをPoCで確認し、成立しない場合の代替（ホストへの導入＋D-Bus共有）へ切り替える前提で設計する（詳細は`runner/design.md`「Proton VPN用ランナー」、`wbs/phase10.md`）。

# ベンダー非依存の設計原則（Phase 12）

要件は`requirements.md`「ベンダー非依存性」。本番のソースコード（`api/src`・`proxy/src`・`web/src`・`web/server`・`install/`・composeの本体・共通のDockerfile）は、ベンダーのID・名称・CLIの書式を持たず、ベンダーに対する分岐をしない。差はプロファイルとベンダーバンドルだけに置く。

## 抽象化の対応表（Phase 11までのベンダー固有の埋め込みの置き場所）

| 従来のベンダー固有の埋め込み | 抽象化後 |
|---|---|
| 有効なベンダーの既定値（API・composeとも`adguardvpn`） | 既定を持たない。`VPN_PROVIDERS`が無ければ失敗する |
| 旧形式の状態ファイルの移行先（`adguardvpn`固定） | 移行処理を廃止する（未リリースで、実機はPhase 11で移行済み） |
| 接続先の表の列名の既定（`ISO/COUNTRY/CITY/PING`） | `listLocations.table`を必須にする |
| 接続時の指定名の加工（`(Virtual)`の除去） | `listLocations.connectName`（`{ from: "city"\|"iso", stripPattern? }`）。加工はプロファイルの`stripPattern`で表す |
| 接続状態の判定語（`connected`）と接続先の既定の書式 | `output.connectedPattern`・`output.locationPattern`を、text形式で必須にする |
| ログイン方式の既定（`deviceUrl`） | `loginMethod`を必須にする |
| ログインの標準入力の書式（パスワード→2FAの順、2FAの形式） | `login.stdin`（行のテンプレート。空の行は出さない）と、プレースホルダーの`source: "secret"` |
| 静的な列挙値（`enumFrom`。`<ベンダー名>.<項目>`形式） | 廃止（Phase 8以降、どのプロファイルも使わない） |
| composeへのランナー・ボリュームの直書き、`profiles`・AdGuardだけの特例 | ベンダーバンドルのcompose fragment。全ベンダーを同じに扱う |
| `proxy/`直下のベンダー別ファイル（Dockerfile・エントリポイント・NM設定） | ベンダーバンドルへ移す |

例外的に、`loginMethod`の2方式（`deviceUrl`・`credentials`）による処理の分岐は残す。これはベンダーに対する分岐ではなく、プロファイルが宣言する機構に対する分岐である。

## ベンダーバンドル

ベンダー1つを、ディレクトリ1つ`vendors/<ベンダーID>/`で表す。IDは`^[a-z][a-z0-9]{0,31}$`。

| ファイル | 必須 | 内容 |
|---|---|---|
| `profile.json` | ○ | VPNクライアント操作プロファイル（`apiserver/design.md`）。ファイル内の`vendor`とディレクトリ名は一致させる |
| `compose.yml` | ○ | ランナーのcompose fragment。サービス名は`runner-<ベンダーID>`、ソケットは`CTL_SOCKET_PATH: /var/run/vpngw-ctl/runner-<ベンダーID>.sock`、ボリュームは`<ベンダーID>-`で始まる名前にする。`profiles`は使わない。ビルドは`context: .`・`dockerfile: vendors/<ベンダーID>/Dockerfile`のようにリポジトリルート基準で書く（複数のcomposeファイルを併用したとき、相対パスは最初のファイルの位置が基準になるため） |
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

# インストーラと頒布（Phase 13）

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
| `--providers <ID>[,<ID>...]` | 有効にするベンダー。`vendors/<ID>/`が無ければ失敗する |
| `--lan-iface <名前>` | LAN側インターフェース名を手動で指定する（検出できない・複数NICの場合） |
| `--redetect-lan-iface` | 保存済みのLAN側インターフェース名を捨てて再検出する |
| `--no-start` | 起動（`docker compose up`）をしない |

処理の順序:

1. **事前検査**: root、Debian系（`/etc/os-release`の`ID`・`ID_LIKE`）、systemd、CPU（Dockerの公式リポジトリが対応するamd64・arm64・armhfのうち、Debian系の対応するもの）。満たさなければ理由を示して失敗する。
2. **共通の依存**: `ca-certificates curl gnupg git iproute2 nftables`（`apt-get`。導入済みは何もしない）。**Docker**: `docker compose version`が動けば何もしない。動かなければ、Dockerの公式リポジトリ（`/etc/apt/keyrings/docker.asc`と`/etc/apt/sources.list.d/docker.list`）を追加し、`docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin`を導入する（`ID`が`ubuntu`はubuntu、`debian`・`raspbian`はdebianのリポジトリ）。
3. **ホストの設定**: `/etc/sysctl.d/99-vpngwgui.conf`（IPフォワーディング）と、起動時のKill Switchガード（`vpngwgui-boot-guard.service`。内容は従来の`setup-boot-guard.sh`と同じ）。
4. **`.env`の作成・更新**（他の行は保持）: `LAN_IFACE`（`.env`に無いときだけ、デフォルトゲートウェイの逆引きで検出する。`--lan-iface`・`--redetect-lan-iface`で上書き）、`VPN_PROVIDERS`、`COMPOSE_FILE`。
5. **ベンダーの決定**: 優先順は`--providers` ＞ `.env`の既存の`VPN_PROVIDERS`（引数なしの再実行は、変更せず更新だけをする）＞ 端末（`/dev/tty`。`curl | sh`では標準入力がパイプのため`/dev/tty`から読む）での対話選択 ＞ 失敗。対話の選択肢は`vendors/*/profile.json`の`displayName`（無ければID）。
6. **ベンダーのホスト側手順**: 有効なベンダーの`install-host.sh`があれば実行する（下記の契約）。1つでも失敗したら、起動の前に中止する。
7. **起動**: `docker compose up -d --build --remove-orphans`（無効にしたベンダーのランナーは、`--remove-orphans`で停止・削除される。ログイン情報のボリュームは残す）。Web UIが応答するまで待つ（最大約3分）。
8. **完了の表示**: Web UIのURL（`http://<LAN側アドレス>:8080`）、有効なベンダー、次の操作（Web UIで各ベンダーへログイン。LAN機器のデフォルトゲートウェイの向け先）。

**`install-host.sh`の契約**（ベンダーバンドルの任意ファイル）: rootで`sh`により実行される。冪等で、非対話であること。実行時の環境変数`VPNGW_ROOT`（取得先）・`VPNGW_VENDOR_ID`が与えられ、カレントディレクトリはバンドルのディレクトリ。ホスト（ベアメタル）へ導入・設定するのはこのファイルだけで、共通インストーラはその内容を知らない。非ゼロ終了はインストールの中止を意味する。現在のバンドル（AdGuard VPN・Proton VPN）は、ホストの追加導入が不要なため、このファイルを持たない（実行環境は全てランナーのコンテナに閉じている）。

**ホストへの変更（全て）**: 取得先ディレクトリ（既定`/opt/vpngwgui`）、`/etc/sysctl.d/99-vpngwgui.conf`、`/etc/systemd/system/vpngwgui-boot-guard.service`、Dockerの公式リポジトリ設定（上記2ファイル）とDocker・依存パッケージ、有効なベンダーの`install-host.sh`が行うもの。

**既知の制約**: Debian・Raspberry Pi OSでは、`nftables`パッケージの`nftables.service`（`/etc/nftables.conf`を読み込み`flush ruleset`する）が有効な場合、起動時のルールが消されうる。**未検証**（検証環境はUbuntu 24.04のみ）。インストーラは、`nftables.service`が有効なら警告を表示するに留め、利用者の設定を書き換えない。アンインストール・IPv6は対象外。

## 頒布（CI）

- ワークフロー`.github/workflows/installer.yml`。**トリガー**: ブランチへのpush、`v*`タグのpush。**検査**: `sh -n`・`shellcheck`（`install/`）、`npm ci`と`npm test`（中立性の検査を含む）、ブートストラップの生成テスト（置換漏れが無いこと）。
- **ブランチ**: `install-<ブランチ名>.sh`をワークフローのartifactとして保存する（Releaseは作らない）。
- **タグ**: `install.sh`と`install.sh.sha256`をGitHub Releaseへ添付する。利用者が使うURLは、最新: `https://github.com/nekono-dev/vpngateway-gui/releases/latest/download/install.sh`、版の固定: `https://github.com/nekono-dev/vpngateway-gui/releases/download/<タグ>/install.sh`。
- **信頼の範囲**: `curl | sh`はスクリプトの取得元（GitHub ReleaseのHTTPS）を信頼する方式である。ブートストラップは取得するコミットを固定し、取得後にSHAを照合するため、スクリプトとソースの食い違い（タグの付け替え等）は検出できる。`install.sh.sha256`で、ダウンロードして検証してから実行することもできる。

# 認証・認可の設計方針

将来的にセッション認証（Cookieベース等）を追加する可能性があるため、Web⇄API間は前述の通り同一オリジン構成とし、将来の認証導入時の設計変更コストを抑える。

# コーディングルール

Webサーバ用のAPIクライアントは、orvalのようなOpenAPIのクライアント生成ソフトウェアを用いて生成する。Webサーバは必ず生成されたクライアントを用いてAPIサーバにリクエストを送るとする。

APIサーバは Fastify + TypeBox + `@fastify/swagger` を用い、TypeBoxで定義したスキーマからリクエスト/レスポンスの検証とOpenAPI仕様を自動生成する構成とする。生成されたOpenAPI仕様をorvalがそのままWeb側のクライアント生成に利用する。

ただし、APIサーバ⇄プロキシサーバ間の内部コマンド実行チャネル（UDS経由の内部専用HTTPサーバ）はこの限りではなく、OpenAPI仕様の対象外とする。

# 実装フェーズ

実装は`wbs/`配下のフェーズ計画（`wbs/phase1.md`〜`wbs/phase13.md`）に従い段階的に行う。各フェーズの詳細は当該ファイルを参照。フェーズ番号は識別子であり実施順ではない（2026-09-21以降の実施順は `1 → 2 → 3 → 5 → 8 → 4 → 9 → 11 → 10 → 12 → 13 → 6 → 7`。簡易機能版プロトタイプを早期に利用可能にするため、Web UI完成のPhase 5をPhase 4より前に前倒し。`wbs/README.md`参照）。

| 項目 | 最終形（本ファイル） | Phase 1（wbs/phase1.md） |
|---|---|---|
| proxyのネットワーク | `network_mode: host` | 通常のDockerブリッジネットワーク（api/webと同一） |
| proxyの権限 | `cap_add:[NET_ADMIN]`, `devices:[/dev/net/tun]` | 付与しない |
| VPNベンダーCLI | 実CLI（adguardvpn-cli等） | モックCLIスクリプト |
| 透過ゲートウェイ／明示的プロキシ／Kill Switch | 実装する | 実装しない（ユーザ向け設定APIは受理・永続化のみ行う） |
| インストールスクリプト | 実装する | 実装しない |
| Web UI | ダッシュボード＋接続操作＋設定ダイアログ＋接続ログ | ダッシュボード＋接続操作のみ |

Phase 2以降で、本ファイルおよび各サービスdesign.mdに記載の最終形（host networking、nftables、3proxy、Kill Switch実処理、インストールスクリプト、実VPNベンダーCLI、Web設定ダイアログ・接続ログ画面）を段階的に実装する。
