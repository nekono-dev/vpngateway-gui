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
| `--no-start` | インストール後にコンテナを起動しない |

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

## 注意事項

### アンインストール

対象ホスト上で以下を実行する。インストールと同じ頒布URLで実行でき、`/opt/vpngwgui`を事前に取得しておく必要はない。docker composeスタック（ベンダーのログイン情報を含む）、IPフォワーディングの設定、起動時のKill Switchガード、ソース一式の取得先ディレクトリ（`/opt/vpngwgui`自体）を削除する。

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
