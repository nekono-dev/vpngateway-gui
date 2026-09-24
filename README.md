# VPNGateway-GUI

## 概要

VPNベンダー（AdGuard VPN・Proton VPN等）のCLIをLinuxサーバ上に導入し、そのサーバをLAN向けのVPNゲートウェイとして使うためのWeb UIである。LAN機器はこのサーバをゲートウェイまたはプロキシに指定するだけで、個別に設定しなくてもVPN経由で通信できる。特定のVPNベンダーに依存せず、複数ベンダーを導入して後からWeb UI上で切り替えられる。

## インストール

対象は、クリーンなDebian系のベアメタル（Debian・Raspberry Pi OS・Ubuntu 24.04 LTS等。検証済みはUbuntu 24.04）である。Docker・git等をホストに事前導入しておく必要はない。

```sh
curl -fsSL https://github.com/nekono-dev/vpngateway-gui/releases/latest/download/install.sh | sudo sh -s -- --providers <ベンダーID>[,<ベンダーID>...]
```

| 引数 | 意味 |
|---|---|
| `--providers <ID>[,<ID>...]` | 有効にするベンダー（`vendors/<ID>/`のディレクトリ名）。省略時は、その時点で`vendors/`にある全ベンダー（all）を有効にする |
| `--web-port <番号>` | Web UIを配信するホスト側のポート番号（1〜65535）。既定は80 |
| `--lan-iface <名前>` | LAN側インターフェース名を指定する。自動検出できない場合、または複数NICがある場合に指定する |
| `--redetect-lan-iface` | 保存済みのLAN側インターフェース名を破棄し、再検出する。VPN未接続の状態で実行する |
| `--api <ホスト名/IP>` | APIサーバの配置先ホスト。省略時はこのコマンドを実行したホスト（ローカル） |
| `--web <ホスト名/IP>` | Webサーバの配置先ホスト。省略時はローカル |
| `--gateway <ホスト名/IP>` | ゲートウェイ（VPN通信を実際に中継する機体）の配置先ホスト。省略時はローカル |
| `--rotate-pairing` | 各ホスト間の通信を保護する証明書一式を破棄し、再生成・再配布する |
| `--no-start` | インストール後にコンテナを起動しない |

初回アクセス時、Web UIは自己署名証明書を使ったHTTPS（`https://<ホストのアドレス>:<ポート>`）で応答する。ブラウザが表示する証明書の警告は、自己署名証明書によるもので想定内であるため、許可して進めてよい。アクセス後、最初に開いた人がWeb UIの利用者アカウント（ユーザー名・パスワード）を作成する（複数人が同時にアクセスした場合、先に作成した方が優先される）。

### 複数ホストへの分離配置

`--api`・`--web`・`--gateway`を指定すると、Webサーバ・APIサーバ・ゲートウェイをそれぞれ別のホストへ分離して配置できる（いずれも省略した場合は、全体を1台へまとめる単一ホスト構成になる）。指定しなかったロールは、このコマンドを実行したホスト（オーケストレーター）へ配置される。

```sh
sudo sh install/install.sh --web 192.168.1.10 --api 192.168.1.11 --gateway 192.168.1.12 --providers adguardvpn
```

- 配置先に指定するリモートホストへは、このコマンドを実行するユーザーと同じユーザー名でのSSH鍵認証によるアクセスが、事前に確立できていること（`ssh <ホスト>`がパスワード入力なしで通ること）。ユーザー名・秘密鍵・ポートを個別に指定する引数は無いため、ホストごとに設定が要る場合は`~/.ssh/config`側で吸収する。
- リモートホストにDocker・gitなどを事前に導入しておく必要はない（オーケストレーター側のインストーラが、対象ホストへ導入する）。
- ホスト間の通信（ブラウザ⇄Webサーバ・Webサーバ⇄APIサーバ・APIサーバ⇄ゲートウェイ）は、いずれもこのコマンドが生成・配布する証明書によって暗号化・認証される。
- 一度決めたロールの配置先（トポロジー）は、`--uninstall`で後始末してから新しい配置で再インストールするまで変更できない（配置を変えて再実行すると、記録済みの配置と異なる旨のエラーで停止する）。

## 設定方法

### 更新・ベンダー構成の変更

インストール時と同じコマンドを対象ホスト上で再実行する（冪等なので、既存の設定・ログイン情報は保持される）。

```sh
sudo sh /opt/vpngwgui/install/install.sh --providers adguardvpn
```

| 目的 | コマンド |
|---|---|
| アップデート | インストールコマンドを再実行する。 |
| 有効なベンダーを絞る・増やす | `--providers`に有効にしたいベンダーだけを指定して再実行する |
| Web UIのポートを変更する | `--web-port`に変更後のポート番号を指定して再実行する。省略した場合は現在の設定を維持する |

### 迂回ドメインとDNS中継

VPNを経由させたくない通信は、Web UIの設定ダイアログで迂回ドメインとして登録する。登録したドメイン宛の通信は、VPNを経由せず通常の回線から直接送出される（透過ゲートウェイ・明示的プロキシのどちらも対象）。迂回ドメインは、DNS中継を有効にしたときだけ機能する。

DNS中継は、LAN機器の名前解決をゲートウェイが受け取り、自宅などに構築したDNSサーバ（DoHに対応した、AdGuard Home等）へ転送する機能である。DNSのフィルタリングとクエリ履歴を自宅のDNSサーバへ集約しつつ、迂回ドメインの判定をゲートウェイで行える。LAN機器のDNSサーバには、ゲートウェイのアドレスを指定する（DHCPで配布するのが簡単である）。

| 迂回ドメインの表記 | 対象 |
|---|---|
| `example.com` | `example.com`のみ（サブドメインは含まない） |
| `*.example.com` | `example.com`のすべてのサブドメイン（`example.com`自身は含まない） |

`example.com`とそのサブドメインの両方を迂回するには、`example.com`と`*.example.com`の両方を登録する。

| 設定項目 | 意味 |
|---|---|
| DNS中継を有効にする | ゲートウェイがLAN機器の名前解決を中継する |
| 自宅DNSサーバ（DoHのURL） | 転送先。例: `https://dns.home.example/dns-query`。`https://`のURLのみ指定できる |
| 自宅DNSサーバの証明書を発行したCA | 自宅DNSサーバの証明書が自己署名・私的な認証局のものである場合に、その認証局の証明書（PEM形式）を貼り付ける。公的な認証局の証明書であれば空でよい |
| 応答しないとき | 「名前解決を止める」（フィルタと履歴を優先）か、「公開DNSへ切り替える」（名前解決を優先。切り替え先を1〜3件指定する。この間、自宅DNSサーバのフィルタと履歴は効かない）を選ぶ |
| 手動でDNSを指定した端末の問い合わせも中継する | ゲートウェイを通る宛先ポート53の通信を、宛先にかかわらず中継する。既定は無効 |
| 中継しない宛先 | 上記を有効にしたとき、中継の対象から外す宛先（LAN内のDNSサーバ等）をCIDRで指定する |

自宅DNSサーバには、問い合わせたLAN機器を区別できる識別子が付いて届く（MACアドレスから作った`mac-aa-bb-cc-dd-ee-ff`。MACアドレスが分からない場合は`ip-192-168-3-25`）。AdGuard Homeでは、この識別子をクライアントの識別子（ClientID）として登録すると、名前を付けて管理できる。自宅DNSサーバ側では、DoHを受け付ける設定（暗号化の有効化と証明書）が必要である。明示的プロキシを経由した通信の名前解決は、プロキシ利用者ごとには区別されず、`explicit-proxy`という識別子で届く。

### 自宅DNSサーバ（AdGuard Home）のDoH用証明書の発行

DNS中継は、自宅DNSサーバへDoH（HTTPS）で転送する。自宅DNSサーバのHTTPS用に、証明書と秘密鍵が必要である。公的な認証局の証明書（Let's Encrypt等）を使える場合は、この手順は不要で、Web UIの「自宅DNSサーバの証明書を発行したCA」は空でよい。ここでは、自前の認証局（CA）を作り、それで自宅DNSサーバの証明書を発行する手順を示す。`openssl`が使える任意のホストで実行してよい。

証明書に含めるアドレスは、Web UIの「自宅DNSサーバ（DoHのURL）」に書くホスト名またはIPアドレスと一致させる。一致しないと、ゲートウェイは接続を拒否する。以下では、自宅DNSサーバのアドレスを`192.168.3.240`、ホスト名を`dns.home.example`とする（環境に合わせて読み替える）。

```sh
# 1. 認証局（CA）の鍵と証明書を作る（有効期間10年）
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout ca.key -out ca.pem -subj "/CN=home-dns-ca" \
  -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign"

# 2. 自宅DNSサーバの鍵と証明書要求を作る
openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr -subj "/CN=dns.home.example"

# 3. アドレスを指定して、CAで署名する（有効期間1年）
printf 'subjectAltName=DNS:dns.home.example,IP:192.168.3.240\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n' > san.ext
openssl x509 -req -in server.csr -CA ca.pem -CAkey ca.key -CAcreateserial -days 365 -extfile san.ext -out server.pem
```

| 生成物 | 使い道 |
|---|---|
| `server.pem`（証明書） | AdGuard Homeの暗号化設定の「証明書」に貼り付ける |
| `server.key`（秘密鍵） | AdGuard Homeの暗号化設定の「秘密鍵」に貼り付ける。他へ渡さない |
| `ca.pem`（CAの証明書） | Web UIの「自宅DNSサーバの証明書を発行したCA」に貼り付ける |
| `ca.key`（CAの秘密鍵） | 証明書の再発行に使うため、安全な場所に保管する。他へ渡さない |

AdGuard Homeでは、「設定」→「暗号化設定」で、暗号化を有効にし、サーバー名に上記のアドレス（ホスト名またはIPアドレス）、HTTPSポートに任意のポート（既定443）を指定して、証明書と秘密鍵を貼り付ける。Web UIの「自宅DNSサーバ（DoHのURL）」には、`https://<アドレス>:<ポート>/dns-query`を指定する。

サーバの証明書の有効期限（1年）が切れたら、手順2・3をやり直して`server.pem`・`server.key`を差し替える。CAは変わらないため、Web UIの設定を変更する必要はない。

アドレスを追加・変更する場合（`server.csr`は再利用できる）は、`san.ext`の`subjectAltName`を書き換えて手順3だけをやり直し、`server.pem`だけを差し替える（秘密鍵は変わらない）。

| 表示・症状 | 原因と対処 |
|---|---|
| AdGuard Homeに「証明書チェーンが無効です」と表示される | AdGuard Home自身が、自前のCAを信頼していないために出る警告である。証明書の内容（件名・発行者・有効期限・ホスト名）が表示されていて、DoHは動作する。ゲートウェイはWeb UIに貼り付けた`ca.pem`で検証するため、無視してよい。警告を消すには、AdGuard Homeを動かす環境の信頼済み認証局へ`ca.pem`を登録する（Dockerの場合はコンテナ内の`/etc/ssl/certs`へ登録する） |
| Web UIの稼働状況が「自宅DNSサーバに接続できません」になる | 次のいずれかである。①証明書のアドレス（`subjectAltName`）に、DoHのURLのホスト名またはIPアドレスが含まれていない（`openssl s_client -connect <アドレス>:<ポート> -CAfile ca.pem -verify_hostname <ホスト名>`で`hostname mismatch`と出る）。②ゲートウェイ機が、DoHのURLのホスト名を名前解決できない。ホスト名が自宅DNSサーバ自身にしか登録されていない場合に起こるため、DoHのURLにはIPアドレス（例: `https://192.168.3.252/dns-query`）を指定し、証明書のアドレスにそのIPアドレスを含める |

## 注意事項

### アンインストール

対象ホスト上で以下を実行する。インストールと同じ頒布URLで実行でき、`/opt/vpngwgui`を事前に取得しておく必要はない。docker composeスタック（ベンダーのログイン情報を含む）、証明書一式、IPフォワーディングの設定、起動時のKill Switchガード、ソース一式の取得先ディレクトリ（`/opt/vpngwgui`自体）を削除する。複数ホストへ分離配置した場合は、インストールを実行したホスト（オーケストレーター）上で実行すること。配置した全ホストの後始末をまとめて行う（`--uninstall`は`--api`・`--web`・`--gateway`と併用できない。後始末の範囲は記録済みの配置から自動的に決まる）。

```sh
curl -fsSL https://github.com/nekono-dev/vpngateway-gui/releases/latest/download/install.sh | sudo sh -s -- --uninstall
```

| 引数 | 意味 |
|---|---|
| `--keep-data` | ベンダーのログイン情報（Dockerボリューム）を削除せず残す。省略時は削除する |

以下は対象外であり、手動で削除・無効化する。

| 変更対象 | 内容 |
|---|---|
| `/etc/apt/keyrings/docker.asc`・`/etc/apt/sources.list.d/docker.list` | Docker公式リポジトリの設定 |
| Docker本体・依存パッケージ | `apt`で導入したもの（他の用途と共有されうるため対象外） |

### 既知の制約

| 制約 | 内容 |
|---|---|
| 動作検証済みの環境 | Ubuntu 24.04・Debian 12（bookworm、LXCのクリーンなコンテナ）・Raspberry Pi OS Lite arm64（trixie。QEMUのarm64エミュレーション） |
| 未検証の環境 | Raspberry Pi OSの32bit（armhf）、Raspberry Pi実機 |
| Raspberry Pi OSでの順序 | `nftables.service`が既定で有効なため、起動時のKill Switchガードはその後に適用されるよう順序付けている（設定済みであれば利用者が意識する必要はない） |
| `curl`が無いホスト | 先に`sudo apt-get install -y curl`を実行してからインストーラを実行する |
| 迂回ドメイン | 暗号化DNS（DoH・DoT）を使う端末の問い合わせはゲートウェイで中継できないため、迂回が効かない（端末側の「安全なDNS」等の設定を無効にする）。迂回はIPアドレス単位で判定するため、迂回するドメインとIPアドレスを共有する他のドメイン（CDN等）宛の通信も迂回される。IPv6は対象外である |
| DNS中継のポート | ゲートウェイはUDP/TCPの53番で待ち受ける。同じホストで他のDNSサーバが53番を使っている場合、DNS中継は起動しない（Web UIの稼働状況に「待受に失敗」と表示される） |
| 配布の信頼方式 | `curl \| sh`はGitHub ReleaseのHTTPS配布を信頼する方式である。配布物は取得するコミットを固定してあり、取得後に照合される。気になる場合はスクリプトをダウンロードして`install.sh.sha256`で検証してから実行してもよい |

## ベンダーの追加

対応済みのVPNベンダー以外（AdGuard VPN・Proton VPN以外のCLIを持つVPN）を使いたい場合、`vendors/<新しいベンダーID>/`ディレクトリを1つ追加するだけで対応できる。API・Web UI・ネットワークコンテナ・インストーラなど共通部分の改修は不要である。追加するファイルは以下のとおり。

| ファイル | 役割 |
|---|---|
| `profile.json`（必須） | 接続・切断・ログイン等の各操作に対応するCLIコマンド、機能差・プラン制限・ログイン方式の宣言。ベンダー固有の値はここにだけ書く |
| `Dockerfile`（必須） | ベンダーCLIを同梱したランナーのイメージ |
| `compose.yml`（必須） | ランナーのcomposeサービス定義 |
| `entrypoint.sh`（任意） | そのベンダー固有の起動処理 |
| `install-host.sh`（任意） | CLIがホスト（ベアメタル）側への追加導入を要する場合だけ |
| `samples.json`（推奨） | 実CLIの出力サンプルと期待値（適合テストが使う） |

詳細な仕様は[specs/design.md](specs/design.md)「ベンダー非依存の設計原則」、各ファイルの詳しい書式は[specs/runner/design.md](specs/runner/design.md)「ベンダーの追加方法」を参照。

## 開発

このリポジトリのコードに変更を加える場合のコマンドである（利用者としてWeb UIを使うだけなら不要）。

```sh
npm ci                        # このリポジトリの開発用パッケージ一式を導入する
npm run generate:api-client   # APIサーバのOpenAPI定義から、Web UIが使うAPIクライアントのコードを生成する（web/src/generated/。git管理外なので変更のたびに要実行）
npm test                      # 単体テスト・ベンダー中立性の検査（本番コードにベンダー固有の値が紛れていないかの静的チェック）・インストーラの検査をまとめて実行する
```

実VPN・実LAN・LXCを使ったE2Eテストの手順は[e2e/README.md](e2e/README.md)を参照。
