# SPEC-RUNNER: ランナーコンテナ基本設計

サービス全体設計（../design.md）で定義されたランナーコンテナ（`runner-<ベンダー>`）の詳細設計を示す。ランナーは、VPNベンダーごとに1つ用意し、そのベンダーのCLIの実行環境と実行要求の受け口だけを持つ。透過ゲートウェイ・Kill Switch・明示的プロキシ・接続監視はネットワークコンテナ（`proxy`。../proxyserver/design.md）の責務であり、ランナーは関与しない。

実装は`proxy/`パッケージ内（`src/runner.ts`・`src/exec/`・`src/allowlist.ts`）、イメージは`proxy/Dockerfile.runner-<ベンダー>`。ネットワークコンテナと同じnpmパッケージから別のエントリポイント（`dist/runner.js`）としてビルドするが、責務・イメージ・コンテナは別である。

# コンテナ構成

| ランナー（compose service） | 実行するCLI | イメージ | 内部HTTP（UDS。`ctl-socket`ボリューム） |
|---|---|---|---|
| `runner-adguardvpn` | AdGuard VPN CLI | `proxy/Dockerfile.runner-adguardvpn`（Alpine＋CLI＋sudo。従来のAdGuard用proxyから、ネットワーク制御を除いたもの） | `runner-adguardvpn.sock`: `POST /exec`・`GET /health` |
| `runner-protonvpn` | Proton VPN CLI（NetworkManager等を同梱） | `proxy/Dockerfile.runner-protonvpn`（Ubuntu。下記「Proton VPN用ランナー」） | `runner-protonvpn.sock`: `POST /exec`・`GET /health` |
| `runner-mock`（E2E専用） | モックプロバイダCLI | `proxy/Dockerfile.runner-mock`（Alpine。CLIなし。モックをマウント） | `runner-mockproton.sock` |

- **`network_mode: host`・`cap_add: [NET_ADMIN]`・`/dev/net/tun`**: CLIが確立するトンネル（AdGuard: TUN、Proton: NMのWireGuard）を、ゲートウェイ（ホスト）のネットワーク名前空間に作らせるため。`privileged: true`は使わない。
- **UDS**: 各ランナーは自分のソケットファイル（環境変数`CTL_SOCKET_PATH`。`/var/run/vpngw-ctl/runner-<ベンダーID>.sock`）だけを作る。起動時に残存ソケットを`unlink`してから`listen`し、`chmodSync(0o770)`で制限する。所有者は`vpngwgui`（UID 10001。APIコンテナも同UID）。ネットワーク的にコンテナ外部から到達不能である理由・方式はネットワークコンテナと同じ（../proxyserver/design.md「内部コマンド受信サーバ（UDS制御チャネル）」）。
- **起動しないランナー**: 有効化されていないベンダーのランナーは起動しない（composeの`profiles`）。起動していない・応答しないランナーのベンダーは、APIが「利用不可」として扱い、選択できない（../apiserver/design.md「ランナーの利用可否」）。
- **ボリューム**: ベンダーごとにログイン情報を別々に永続化する（`adguard-data`、`proton-config`・`proton-keyrings`・`proton-cache`）。ベンダーを切り替えても各ベンダーのログイン情報は失われない。

# ランナーの内部HTTP（`dist/runner.js`）

- **`POST /exec`**: 解決済みコマンドの実行（下記「`POST /exec`の仕様」）。**許可されるのは自分のベンダーのバイナリ1つだけ**（下記「許可バイナリ」）。他のバイナリは`403 binary_not_allowed`。
- **`GET /health`**: `200 { "ok": true, "binary": "<許可バイナリ>" }`。副作用なし。APIの`GET /v1/providers`が利用可否の判定に使う（ランナー内でCLIは起動しない）。実行環境の準備（例: Proton VPN用ランナーのNM・keyring）が整ってからソケットを作る（ソケットが無い間はAPIが「利用不可」とみなす）。
- **ネットワークの再構成はしない**: 接続・切断コマンドの実行直後に、ゲートウェイのルールを即時に再構成する処理（Phase 10までは同一コンテナ内の`checkConnectionOnce`）は、ネットワークの状態を持たないランナーでは行えない。代わりに、APIが実行後にネットワークコンテナの`POST /connection-checks`（../proxyserver/design.md）を呼ぶ。

# `POST /exec`の仕様（内部コマンド受信サーバ）

- リクエスト（APIサーバから、../apiserver/design.md「プロキシとの内部通信仕様」参照）: `{ vendor, binary, resolvedArgv, timeoutMs, completionPattern?, stdin? }`
- **実行可能バイナリの許可リストによる内部防御**: 受信した `binary` を、このランナーの許可バイナリ（環境変数`RUNNER_ALLOWED_BINARY`の1つの絶対パス。下記「許可バイナリ」）と照合し、一致しない場合は実行を拒否する（`403`）。この許可リストは、../requirements.mdで定義した「管理者向け設定」「ユーザ向け設定」とは別の、ランナー実装内部の（イメージに焼き込まれた）セキュリティ機構であり、両設定カテゴリとは独立して扱う。APIコンテナが将来何らかの理由で侵害・バグ混入した場合でも、ランナーが任意コマンド実行の踏み台にならないようにする最後の防波堤である。ベンダーごとにランナーが別のため、あるランナーを経由して別ベンダーのバイナリを実行することもできない。
- 実行:
  - `completionPattern`省略時（`connect`/`disconnect`/`status`）: `child_process.spawn(binary, resolvedArgv)`でプロセスを起動し、子プロセス自身の`'exit'`イベント（`timeoutMs`超過時はkillの上`exitCode: -1`）で完了と判定する。シェル（`exec()`）は使用しない。**`child_process.execFile`は使用しない**: execFileの完了判定は子プロセスの`'close'`イベント（stdout/stderrパイプが完全に閉じるまで）に依存するが、`connect`はバックグラウンドにVPNデーモン（孫プロセス）をforkして自身は先に終了するため、forkされたデーモンが標準出力/エラーのパイプを引き継いだまま存在し続け、`'close'`が永久に発火せずハングする不具合が実機検証で発覚した（`proxy/src/exec/command-runner.ts`の`runCommand`）。
  - `completionPattern`指定時（`login`、Phase 2で追加）: `child_process.spawn(binary, resolvedArgv)`でプロセスを起動し、stdoutを蓄積しながら`completionPattern`（正規表現）との一致を都度判定する。一致した時点でプロセスをkillせず（`child.unref()`）、その時点までのstdout/stderrを添えて`exitCode: null`で応答する。一致せずプロセスが自然終了した場合は実際のexitCodeで応答し、一致せず`timeoutMs`を超過した場合はプロセスをkillし`exitCode: -1`（タイムアウトの既存表現）で応答する。ログイン代行のようにブラウザでの認証完了まで数分かかる長時間プロセスに、応答不要な待機区間だけ非同期に対応するための拡張点である（実装: `proxy/src/exec/command-runner.ts`の`runDetachableCommand`）。
- レスポンス: `{ exitCode, stdout, stderr }`。`exitCode`は`completionPattern`一致時のみ`null`になりうる。
- すべての実行要求と結果を構造化ログとして記録する（監査ログ、apiserver/design.md参照）。


## `stdin`の受け渡し（Phase 9で追加）

`POST /exec`のリクエストは任意で`stdin`（文字列、最大4096バイト。apiserver/design.md「プロキシとの内部通信仕様」）を受け取る。指定された場合、`runCommand`は子プロセスの標準入力を`"pipe"`にし、`stdin`を書き込んで閉じる（未指定なら従来どおり`"ignore"`）。パスワード入力型のログイン（Proton VPN CLIの`signin`）で、パスワードをコマンド引数（`ps`で他プロセスから見える）へ載せずに渡すための手段である。

- **内容をログへ出さない**: 監査ログ（`exec_completed`等）は`argv`と`exitCode`のみを記録し、`stdin`は`stdinProvided: true`（有無）だけを記録する。標準出力・標準エラーの内容も従来どおりログしない（レスポンスにのみ含める）。
- 4096バイトを超える`stdin`は`400`（不正な形状）で拒否する（想定外の巨大な入力でプロセス・メモリを消費させないため）。
- 書き込み中の`EPIPE`（CLIが入力を読まずに終了）は無視する（プロセスの終了コードと出力で結果が分かるため）。


## 許可バイナリ（`RUNNER_ALLOWED_BINARY`。Phase 9の`EXTRA_ALLOWED_BINARIES`を置換）

- ランナーが実行してよいのは、環境変数`RUNNER_ALLOWED_BINARY`（絶対パス）に一致するバイナリ1つだけ（`src/allowlist.ts`）。未設定・相対パスなら何も許可しない（許可バイナリが決まらない構成では実行させない）。
- **実運用のランナー**（`runner-adguardvpn`・`runner-protonvpn`）は、Dockerイメージにビルド時に`ENV`で焼き込み、composeでは上書きしない。**E2Eのモックランナー**（`runner-mock`。`docker-compose.e2e-mock.yml`）のみ、composeでモックCLIのパスを与える（専用のサービス・イメージで、実運用のランナーとは分かれている。実運用の`docker-compose.yml`には含まれない）。
- Phase 9の`EXTRA_ALLOWED_BINARIES`（単一のproxyコンテナの許可リストへE2E用に追加許可する環境変数）は、ベンダーごとにランナーが分かれたため廃止した。設定できるのはコンテナを起動する管理者のみで、APIコンテナからは変更できないため、「APIコンテナ侵害時に任意コマンド実行の踏み台にならない」という許可リストの目的は損なわれない。

## AdGuard VPN用ランナー

- **イメージ**: `proxy/Dockerfile.runner-adguardvpn`。ビルドステージでAdGuard VPN CLI（GitHub Releases、動作確認済みバージョン固定）を取得し、実行ステージ（Alpine＋Node.js）へバイナリ1つを渡す。CLIは非root実行時にTUN設定（`ip link`等）を`sudo`経由で行うため、`vpngwgui`にパスワードなしsudoを付与する（`cap_add: NET_ADMIN`があってもCLI内部の実装上必須）。`RUNNER_ALLOWED_BINARY=/usr/local/bin/adguardvpn-cli`を`ENV`で焼き込む。
- **ログイン情報の永続化**: CLIは認証情報を`$HOME/.local/share/adguardvpn-cli`へ保存する。`adguard-data`ボリュームでマウントし、コンテナ再作成のたびに再ログインが必要にならないようにする。加えて、CLIがログインセッションの妥当性検証に用いる`/etc/machine-id`・`/var/lib/dbus/machine-id`を、エントリポイント（`proxy/docker-entrypoint.sh`）が同ボリューム上に保存した値から復元する（コンテナ再作成のたびに失われるとログインが失効するため。`wbs/phase2.md`「次フェーズへの申し送り」）。
- **`network_mode: host`が必須**: Dockerブリッジネットワークはコンテナ再作成のたびに実CLIのログインセッションが失効する不具合があった（IPv6を透過しない。`wbs/phase2.md`）。

## Proton VPN用ランナー（Phase 10。Phase 11でproxyイメージからランナーイメージへ位置づけを変更）

Proton VPN公式CLI（`proton-vpn-cli` 1.0.3）はPythonアプリケーションで、以下に依存する（公式リポジトリのパッケージ定義・ソースで確認）。

| 依存 | 用途 | コンテナ内での用意 |
|---|---|---|
| NetworkManager（`network-manager`、`python3-proton-vpn-network-manager`系） | WireGuardトンネルの確立（NMの接続として作成・有効化） | コンテナ内でNMをシステムD-Bus上に起動する。ホストの他のインターフェースを管理させない設定にする（下記） |
| `proton-vpn-daemon` | 分割トンネリング用のD-Bus活性化サービス（公式CLIはaptの依存で要求するが、接続・ログインには不要。PoCで確認） | **起動しない**（導入のみ。postinstがsystemd無しで失敗するため、導入時の回避が必要。`wbs/phase10.md`「PoC途中の知見」） |
| gnome-keyring（Secret Service。`python3-proton-keyring-linux`） | ログインセッション（トークン）の保管 | コンテナ内のセッションバスで`gnome-keyring-daemon`を起動し、空パスワードで解錠する。保管先を永続化ボリュームにする |
| セッションD-Bus | keyring・GUI二重起動検知（CLIは起動時にセッションバスを見て、GUIアプリが動作中なら実行を拒否する） | コンテナ内でセッションバスを起動する（GUIは存在しないため二重起動検知は素通しになる） |

- **イメージ**: `proxy/Dockerfile.runner-protonvpn`（Phase 10の当初案の`Dockerfile.protonvpn`から、ランナーとして改名・縮小した。3proxy・nftablesは不要）。Ubuntu 24.04ベース（検証環境と同一で、依存解決が確認済み）。Node.jsは公式イメージからバイナリをコピーする。3proxyはネットワークコンテナ（Alpine）にのみ含めるため、このイメージには不要。Protonの公式リポジトリ（`protonvpn-stable-release`）を追加し、`proton-vpn-cli`を導入する。イメージは大きくなる（GTK等の依存を含む）が、ランナーが分離されているためAdGuard用ランナー・ネットワークコンテナには影響しない。**Proton用ランナーは、Proton VPNを有効化した場合のみ起動する**（`COMPOSE_PROFILES`）。
- **起動構成**: PID 1は`init: true`のtiniの下でエントリポイントのスクリプトが動き、root権限でシステムD-Bus→NetworkManagerを起動し、`vpngwgui`ユーザーでセッションバス・keyringを起動してから、`vpngwgui`権限でランナー本体（Node.js）を`exec`する。バックグラウンドのいずれかが終了したらエントリポイントも終了し、`restart: always`でコンテナごと再起動する（片方だけ死んだ半端な状態で稼働し続けない）。
- **NetworkManagerの制限**: `network_mode: host`のため、NMはホストのインターフェースを見る。ホストのネットワーク（DHCP・静的設定・Docker・LXC）を奪わないよう、NMの設定で**WireGuardデバイス以外を全て`unmanaged`にする**（`[keyfile] unmanaged-devices=*,except:type:wireguard`相当。書式はPoCで確認）。Proton VPNのトンネルは、NMが作るWireGuardインターフェース（`proton0`等）で、本システムのトンネル検出（`ip route get`の出力先。`tunnel-interface.ts`）はインターフェース名に依存しないためそのまま使える。
- **keyringの解錠（PoCで判明）**: 空のパスワードでは、初回のログインkeyringの作成がGUIのプロンプト（`org.gnome.keyring.SystemPrompter`）を要求して失敗する。エントリポイントは、ランダムなパスワードを`~/.config/Proton/.keyring-pass`（0600、永続化ボリューム）へ保存し、`gnome-keyring-daemon --daemonize --login`へ標準入力で渡してログインkeyringを作成・解錠し、続けて`--start --components=secrets`でSecret Serviceを開始する。keyringの実体は`~/.local/share/keyrings`（別のボリューム）。同じコンテナから読めるため暗号化としての強度は無い（トークンを保管するSecret Serviceを成立させるための措置）。コンテナ再作成後も、保存した値が取り出せることを確認した。
- **導入時のsystemctl（PoCで判明）**: `proton-vpn-daemon`のpostinstがsystemd無しでも`systemctl`を実行して失敗するため、`dpkg-divert`で`/usr/bin/systemctl`を退避して導入中だけスタブへ差し替え、導入後に戻す（`/usr/local/bin`へ置く方法はdpkgのPATHの都合で効かない）。
- **Kill Switch**: Proton VPN CLIのKill Switch（`config set kill-switch`）は使わず、既定（無効）のままとして、本システムのnftablesのKill Switchに一本化する（二重の遮断規則による競合・切断後の通信不能を避ける）。PoCで既定値と、有効化されていた場合の切り戻しを確認する。
- **権限**: `cap_add: [NET_ADMIN]`、`/dev/net/tun`（従来と同じ）に加え、NMの起動のためにrootで動く。`privileged: true`は使わず、追加の権限が必要と判明した場合のみPoCの結果として個別に追加する。ノード本体・CLIの実行は`vpngwgui`（非root）とする。
- **永続化**: `~/.config/Proton/VPN`（設定）・`~/.local/share/keyrings`（keyring）・`~/.cache/Proton/VPN`（サーバー一覧のキャッシュ）と、`/etc/machine-id`（コンテナ再作成でログインが失効しないよう、AdGuard用の`docker-entrypoint.sh`と同じ方針でボリュームから復元）を永続化する。
- **PoCの合否基準**（`wbs/phase10.md`で先に実施する。不合格の場合は、ホストへ`proton-vpn-cli`・NM・daemonを導入しD-Bus・keyringのソケットをコンテナへ共有する代替へ切り替え、本節と`wbs/phase10.md`を改訂する）:
  1. コンテナ内でNM・keyringが起動し、`protonvpn status`が終了コード0で応答する。
  2. `protonvpn signin`が、TTYの無いコンテナで標準入力からパスワードを受け取れ（`getpass`が標準入力へフォールバックする。**確認済み**）、ログイン情報がコンテナ再作成後も保持される（keyringの永続化。**keyringの保持は確認済み、実アカウントでのログインは検証待ち**）。
  3. `protonvpn connect`でWireGuardのインターフェースが作られ、`ip route get 1.1.1.1`がそのインターフェースを指す。切断で元に戻る。
  4. NMがホストの既存インターフェース（物理NIC・Docker・LXC）の設定を変更しない。
  5. 本システムの透過ゲートウェイ（nftablesのNAT/FORWARD）が、そのインターフェースを経由してLAN端末の通信をVPNへ通す。


## モックプロバイダ用ランナー（E2E専用）

Phase 9のモックCLI（`proxy/mock-cli/protonvpn-mock.mjs`。Proton VPN公式CLI 1.0.3のソースに基づく出力・終了コードで、無料/有料・ログイン状態を模擬）を、専用のランナー（`runner-mock`。`docker-compose.e2e-mock.yml`）で実行する。許可バイナリ・ソケット名はcomposeで与える（実運用のランナーとはサービス・イメージが別で、実運用の`docker-compose.yml`には含まれない）。

## （履歴）Phase 1のモックVPN CLI仕様

実VPNベンダーCLIの代わりに、Node.jsスクリプト（shebang付き、`proxy/mock-cli/adguardvpn-cli-mock.mjs`）で代用する。状態は`/tmp/vpngwgui-mock-state.json`（環境変数`MOCK_STATE_FILE`で上書き可）に保存する。

| argv | 動作 | stdout | exit |
|---|---|---|---|
| `connection -l <COUNTRY>` | 状態を`{"status":"connected","country":"<COUNTRY>"}`に更新 | 同JSON | 0 |
| `connection -d` | 状態を`{"status":"disconnected"}`に更新 | 同JSON | 0 |
| `connection -s` | 状態ファイルを読み取り出力（無ければdisconnected） | 状態JSON | 0 |
| `connection -l zz`（エラー注入用の特殊国コード） | 変更なし | stderrに`ERROR: no server available for zz` | 1 |

`connection -l zz`のエラー注入により、実CLIなしでAPI側の422ハンドリングを検証できる。stdoutはJSON固定とし、Phase 2で実CLI統合する際はベンダー別テキストパーサーに置換する（apiserver/design.md「Phase 1における具体プロファイル」の`outputFormat`参照）。

**実装時に判明した注意点**: APIサーバはプレースホルダー値をプロファイルの`countries`（enumFrom参照先）に対して必ず列挙値チェックする（apiserver/design.md「入力検証・セキュリティ方針」）。そのため`zz`をプロファイルの`countries`に含めておかないと、この422検証用リクエストはプロキシに到達する前にAPIサーバの400（入力エラー）で弾かれてしまう。Phase 1のプロファイル（apiserver/design.md「Phase 1における具体プロファイル」）では`countries`に`"zz"`をテスト用として含めている。

内部コマンド受信サーバの待受パスは`POST /exec`に固定する（Phase 3で設定反映用`POST /settings`を追加する際、既存仕様の変更ではなく追加で済むようにするため）。


# VPNベンダーCLI（ランナー）の追加方法

1. （Phase 11以降）新規ベンダーのランナーコンテナのDockerイメージに、ベンダーCLIバイナリを同梱する（従来はproxyコンテナのイメージ）。
2. 管理者向け設定（VPNクライアント操作プロファイルJSON、apiserver/design.md参照）に新規ベンダーのエントリを追加する。
3. ランナーの許可バイナリ（`RUNNER_ALLOWED_BINARY`。ランナーのイメージに焼き込む）に新規バイナリのパスを設定する。
4. **【Phase 9】** プロバイダごとの機能差・プラン制限をプロファイルの`account`・`features`・`restrictedPattern`等で表現する（apiserver/design.md「Phase 9における具体プロファイル」）。
5. **【Phase 11】** そのベンダーのランナー（`proxy/Dockerfile.runner-<ベンダー>`と、`docker-compose.yml`の`runner-<ベンダー>`サービス（`profiles: [<ベンダー>]`）、ベンダー専用のボリューム）を追加する。CLIが特殊な実行環境（NetworkManager等）を必要とする場合も、その環境はこのランナーに閉じる（他のベンダーのランナー・ネットワークコンテナに影響しない）。プロファイルは`api/config/profiles/<ベンダーID>.json`。


