# VPNGateway-GUI

VPN 接続を複数の LAN 機器で共有するための Web 管理画面付きゲートウェイです。VPN ランナー、API、Web はすべて同じ Linux ノード上の Docker Compose で動作します。Web UI から接続先やネットワーク設定を管理できます。

## 対応環境

| 項目 | 対応内容 |
|---|---|
| OS | Debian 12 以降または Ubuntu 22.04 以降 |
| 配置 | 全サービスを同一ノードで動かす構成のみ |
| Docker | ローカル Docker Engine と Compose plugin を使う rootful Docker のみ |
| ホスト機能 | nftables と systemd が必要。起動時の Kill Switch guard を適用・確認できない環境は非対応 |
| 非対応 | rootless Docker、リモート Docker Engine、複数ホストへの分離配置 |

`check` はホスト設定を変更せず、OS・権限・必要コマンド・LAN interface・Docker の状態を確認します。Docker 未導入、Docker 公式版の 28 未満、Compose plugin の不足は `apply` で解消できる項目として表示します。OS 標準 Docker が 28 未満、rootless Docker、対応外 OS など、自動で解消できない状態は失敗として表示します。必要コマンド、LAN interface、権限などの前提条件を満たさない場合も失敗します。

`apply` は Docker と Compose plugin の状態を先に整え、その後にホスト設定を適用します。Docker または Compose plugin の導入・更新が必要な場合は、内容を表示して同意を求めます。同意しない場合、または対話端末がなく `--yes` も指定されていない場合は、Docker 以外のホスト設定を変更せず中止します。端末のない自動実行では `--yes` を指定してください。`--yes` は同意の問い合わせを省略します。同意前の中止では何も変更しません。Docker 処理の途中で失敗した場合は自動では元に戻さず、失敗した段階と手動で確認する事項を表示します。

| apply 開始時の Docker 状態 | `apply` の動作 |
|---|---|
| 未導入 | `https://get.docker.com` から公式導入スクリプトを取得し、取得元・取得内容の SHA-256・Docker Engine と関連パッケージ（Compose plugin を含む）の導入内容を表示して同意後に実行します。取得には `curl` を優先し、なければ `wget` を使います。どちらもなければ、`curl` と CA 証明書の導入にも同意を得てから取得します。 |
| Docker 公式版（`docker-ce`）が 28 未満 | 公式導入スクリプトで更新します。Docker と稼働中コンテナが再起動され、スクリプトは既存 Docker の検出後に約20秒待機して続行することを表示して同意を求めます。 |
| OS 標準版（`docker-ce` 以外）が 28 未満 | 自動更新せず中止します。Docker を手動で更新してから再度確認してください。 |
| 28 以上 | Docker の導入・更新には触れません。 |

| Compose plugin の状態（Docker Engine 28 以上） | `apply` の動作 |
|---|---|
| Docker 公式版 | Docker 公式配布元の `docker-compose-plugin` を同意後に導入します。 |
| Ubuntu 標準版 `docker.io` | Ubuntu 標準配布元の `docker-compose-v2` を同意後に導入します。 |
| Debian 12 標準版 `docker.io` | Docker 公式配布元を追加して `docker-compose-plugin` のみを導入します。Docker 本体は更新しません。 |
| 上記以外 | 自動導入せず中止し、手動導入を案内します。 |

Docker と Compose plugin の再検査に成功した後、`apply` は sysctl、boot guard、Docker forwarding 設定を適用します。Docker が管理する FORWARD chain の DROP policy が LAN forwarding を遮断しないように、`/etc/docker/daemon.json` が存在しない場合だけ `{"ip-forward-no-drop": true}` を作成して Docker を再起動します。既存ファイルは変更しません。既存ファイルにこのキーがない場合は、運用者が設定を追加して Docker を再起動してください。

## 配布物の取得

[GitHub Releases](https://github.com/nekono-dev/vpngateway-gui/releases) から同じ版の `vpngwgui-<版>.tar.gz` と `vpngwgui-<版>.tar.gz.sha256` を取得します。チェックサムファイルで tarball を検証してから展開してください。以下の `<版>` は取得したリリース版に置き換えます。

```sh
sha256sum -c vpngwgui-<版>.tar.gz.sha256
mkdir vpngwgui
tar -xzf vpngwgui-<版>.tar.gz -C vpngwgui --strip-components=1
cd vpngwgui
```

展開したディレクトリを運用ディレクトリとして使います。`.env` と証明書は配布物に含まれないため、運用者が準備します。

## 初回導入

最初に `.env` を作成し、ホスト側の LAN インターフェース名を `LAN_IFACE` に設定してください。値はこのノードの `ip link` で確認できる実在の interface 名です。

```sh
cp .env.example .env
```

`.env` を編集して、例えば次のように設定します。

```dotenv
LAN_IFACE=br0
VPN_PROVIDERS=
WEB_PORT=8080
WEB_HTTPS_ENABLED=false
GATEWAY_TLS_ENABLED=false
```

`VPN_PROVIDERS` は有効にする runner のディレクトリ名をカンマ区切りで指定します。利用する各 runner の Compose fragment も追加します。例えば次の例では `adguardvpn` runner を選びます。

```dotenv
COMPOSE_FILE=docker-compose.yml:vendors/adguardvpn/compose.yml
VPN_PROVIDERS=adguardvpn
```

複数の fragment を使う場合は、root の `docker-compose.yml` を先頭にし、選択する `vendors/<ID>/compose.yml` を後ろへ追加します。`COMPOSE_FILE` の代わりに、すべての Compose command で `-f docker-compose.yml -f vendors/<ID>/compose.yml` のように指定することもできます。Compose の file 指定は root を先に、vendor fragment を後に並べてください。

`check` は前提条件、Docker version、daemon 設定、実効 FORWARD policy を読むだけの検査です。Docker 28 未満では必要な daemon option が使えないため失敗します。LAN interface が未設定なら既定ルートの interface を候補として表示しますが、`.env` は作成・変更しません。候補を確認して `.env` に `LAN_IFACE` を明記してから再実行してください。`apply` は sysctl、boot guard、Docker forwarding 設定を適用し、Docker 再起動後に FORWARD policy を再確認します。Docker の再起動では稼働中の他のコンテナも再起動されます。

| daemon.json の状態 | `apply` の動作 |
|---|---|
| ファイルなし | 製品設定を作成し、Docker を再起動して policy を確認 |
| `ip-forward-no-drop: true` 設定済み | policy が DROP の場合だけ Docker を再起動 |
| 設定キーなしの既存ファイル | 変更せず失敗。運用者がキーを追加して Docker を再起動 |

`remove` は製品が作成した内容と完全一致する daemon.json だけを削除します。削除後の設定を反映する Docker 再起動は運用者が行ってください。Docker Engine、Compose plugin、追加した Docker 公式配布元は撤去しません。必要なら運用者が手動で撤去してください。

| コマンド | 効果 |
|---|---|
| `sudo compose/host-preparation.sh check` | ホストの前提条件を読み取り専用で確認します。 |
| `sudo compose/host-preparation.sh apply` | 必要な同意を得て Docker/Compose を整え、ホスト設定を適用します。 |
| `sudo compose/host-preparation.sh apply --yes` | 同意の問い合わせを省略して Docker/Compose とホスト設定を適用します。端末のない自動実行ではこの指定が必要です。 |
| `sudo docker compose -p vpngwgui config --quiet` | Compose 設定を検査し、問題があれば起動前に終了します。 |
| `sudo docker compose -p vpngwgui up -d --build` | イメージを構築し、選択したサービスをバックグラウンドで起動します。 |

`config --quiet` が設定エラーを返した場合は `up` を実行せず、`.env` と選択した Compose fragment を修正してください。boot guard の適用または確認が失敗した環境はサポート対象外です。

初回起動後は `http://<サーバーのアドレス>:8080` を開きます。最初にアクセスした利用者が管理者アカウントを作成します。`WEB_PORT` を変更した場合は、そのポートを使います。

## TLS 設定

| 通信区間 | 既定値 | 有効化 |
|---|---|---|
| ブラウザから Web | `WEB_HTTPS_ENABLED=false`（HTTP） | Web 用証明書と秘密鍵を用意し、`compose/web-tls.yml` を追加 |
| API から Gateway | `GATEWAY_TLS_ENABLED=false`（UDS 上の HTTP） | Gateway の server 証明書・秘密鍵、API client 証明書・秘密鍵、信頼 CA を用意し、`compose/api-tls.yml` を追加 |

Web HTTPS と API→Gateway mTLS は独立した設定です。既定ではどちらも TLS 無効です。Web→API は同一ノード内部ネットワークの HTTP で、API の host port は公開しません。Web HTTPS を有効にしても API→Gateway の TLS は有効にならず、その逆も同様です。

証明書と秘密鍵は運用者が準備し、Compose に読み取り専用 mount します。秘密鍵をリポジトリや `.env` に置かず、ホスト上の保護された場所へ保存してください。`.env` にはファイルのホストパスを設定します。

Web と API のコンテナは UID・GID 10001 で動きます。Web 用の証明書・秘密鍵と、API が読む API client 証明書・秘密鍵・信頼 CA は、この UID から読める権限にしてください。読めない場合、Web または API は起動に失敗します。Gateway（proxy）は root で動くため、Gateway の server 証明書・秘密鍵に追加の設定は要りません。

```sh
# 例: 鍵を root 所有・グループ 10001 で読み取りだけ許可する
sudo chown root:10001 /etc/vpngwgui/tls /etc/vpngwgui/tls/web.crt /etc/vpngwgui/tls/web.key
sudo chmod 0750 /etc/vpngwgui/tls
sudo chmod 0640 /etc/vpngwgui/tls/web.crt /etc/vpngwgui/tls/web.key
```

Web HTTPS の設定例です。証明書は PEM 形式とし、`WEB_PORT` は HTTPS 用に利用可能なポート（例: `8443`）を指定します。

```dotenv
COMPOSE_FILE=docker-compose.yml:vendors/adguardvpn/compose.yml:compose/web-tls.yml
WEB_HTTPS_ENABLED=true
WEB_PORT=8443
WEB_TLS_CERT_HOST_PATH=/etc/vpngwgui/tls/web.crt
WEB_TLS_KEY_HOST_PATH=/etc/vpngwgui/tls/web.key
```

ブラウザは `https://<サーバーのアドレス>:8443` で接続します。証明書の SAN はアクセスする名前または IP アドレスに一致させてください。

API→Gateway mTLS を有効にする場合は、`GATEWAY_TLS_ENABLED=true` と `compose/api-tls.yml` を設定し、次のファイルパスを `.env` に指定します。

```dotenv
GATEWAY_TLS_ENABLED=true
GATEWAY_TLS_CA_HOST_PATH=/etc/vpngwgui/tls/ca.crt
GATEWAY_TLS_CLIENT_CERT_HOST_PATH=/etc/vpngwgui/tls/api-client.crt
GATEWAY_TLS_CLIENT_KEY_HOST_PATH=/etc/vpngwgui/tls/api-client.key
GATEWAY_TLS_SERVER_CERT_HOST_PATH=/etc/vpngwgui/tls/gateway-server.crt
GATEWAY_TLS_SERVER_KEY_HOST_PATH=/etc/vpngwgui/tls/gateway-server.key
GATEWAY_TLS_SERVER_NAME=gateway.local
```

証明書の SAN に `GATEWAY_TLS_SERVER_NAME` の値を含めます。CA と各証明書の発行・更新・安全な保管は運用者が行います。TLS の有効化・無効化や fragment の変更後は、必ず `config --quiet` で構成を確認してサービスを再作成してください。

## 更新

新しい版の tarball と sha256 ファイルを取得し、チェックサムを確認します。bundle には `api/`、`web/`、`proxy/`、`vendors/`、`compose/`、ホスト準備スクリプト、`.env.example`、`docker-compose.yml` など、イメージの build に必要な資材がすべて含まれます。Compose 資材や `compose/` だけでなく、bundle 全体を展開して既存の配布資材を置き換えてください。

安全に更新するには、bundle を新しいディレクトリへ展開し、運用者が管理する `.env` をコピーします。`.env` に `COMPOSE_FILE` の選択があればそのまま引き継がれます。証明書を既存インストールディレクトリ内に置いている場合は、そのディレクトリも新しい場所へコピーし、`.env` の証明書パスがコピー先を指すようにします。証明書を `/etc/vpngwgui/tls` などインストールディレクトリ外に置いている場合は、移動せずそのまま使います。

```sh
sha256sum -c vpngwgui-<版>.tar.gz.sha256
mkdir -p ../vpngwgui-<版>
tar -xzf vpngwgui-<版>.tar.gz -C ../vpngwgui-<版> --strip-components=1
cp .env ../vpngwgui-<版>/.env
# 証明書が既存の配布ディレクトリ内にある場合だけ、該当ディレクトリもコピーする。
# 例: cp -a ./certs ../vpngwgui-<版>/certs
cd ../vpngwgui-<版>
sudo compose/host-preparation.sh apply
sudo docker compose -p vpngwgui config --quiet
sudo docker compose -p vpngwgui up -d --build
```

`apply` はホスト準備を現在の `.env` と新しい資材に合わせます。`config --quiet` が成功した後に `up -d --build` を実行すると、新しい `api/`・`web/`・`proxy/`・選択した runner からイメージを再構築します。更新時にレジストリからイメージを取得する必要はありません。Compose project 名 `vpngwgui` の named volume は更新後も使われ、管理者設定、監査ログ、runner の認証状態が保持されます。更新のために `down -v` を実行しないでください。これは保存データを削除する操作です。

## 停止と削除

通常の停止は Compose のコンテナとネットワークを停止・削除します。named volume の設定、監査ログ、runner の保存状態は残ります。

```sh
sudo docker compose -p vpngwgui down
```

ホスト設定も解除する場合は、必ず先に Compose を停止し、その後 `remove` を実行します。ホスト準備の解除は Compose volume を削除しません。

```sh
sudo docker compose -p vpngwgui down
sudo compose/host-preparation.sh remove
```

`down -v` は永続データを削除します。管理者アカウント、設定、お気に入り、監査ログ、runner の認証状態を含む named volume が削除され、復元できません。

```sh
sudo docker compose -p vpngwgui down -v
```

データを消去してホスト設定も解除する場合は、`down -v` の完了後に `sudo compose/host-preparation.sh remove` を実行してください。

すべての Compose 操作では project 名 `vpngwgui` を固定します。`-p vpngwgui` またはこの値と一致する `name:` を使ってください。`COMPOSE_PROJECT_NAME` や別の `-p` 値は Compose の `name:` より優先され、volume 名を変えるためサポートしません。

## 通信保護と Kill Switch

Kill Switch は透過ゲートウェイのみを対象とし、VPN が利用できない間の LAN 転送を boot guard で遮断します。起動時は nftables.service の後、network-pre.target と Docker socket/service の前に BLOCK を適用します。boot guard が失敗した場合は Docker も起動しません。明示的プロキシだけを使う場合、停止時の通信遮断は保証されません。

Web UI の設定にあるゲートウェイ再起動操作は、認証済み要求をホストの固定 systemd 処理へ渡して OS を再起動します。再起動中は Gateway と Web UI が利用できません。

## 旧環境について

旧方式は未リリースのため、旧方式からの移行・互換対応・保存データの引き継ぎには対応しません。新しい Compose 方式で新規導入してください。旧方式で保存した設定や runner の認証情報は新方式へ移行されません。

## 開発者向け

以下はリポジトリの開発・検証用です。

```sh
npm ci
npm test
npm run build
npm run test:e2e-unit
```
