# VPNGateway-GUI

VPNベンダーのCLIをLinuxサーバ上に導入し、VPNゲートウェイ（透過ゲートウェイ・明示的プロキシ・Kill Switch）として使うための、Web UIとその裏側のAPI・ネットワーク制御。特定のVPNベンダーに依存せず、ベンダーごとの差は設定（プロファイル）とベンダーバンドル（`vendors/<ID>/`）だけに置く。

- 要件・設計: [specs/](specs/)（仕様駆動開発。`requirements.md`が要件、`design.md`が設計）
- 作業計画: [wbs/](wbs/)

## インストール

対象: クリーンなDebian系のベアメタル（Debian・Raspberry Pi OS・Ubuntu 24.04 LTS等。検証済みはUbuntu 24.04）。ホストにDocker・git等を事前に入れる必要はない。

```sh
curl -fsSL https://github.com/nekono-dev/vpngateway-gui/releases/latest/download/install.sh | sudo sh -s -- --providers <ベンダーID>[,<ベンダーID>...]
```

例（`vendors/`にあるベンダーを有効にする）: `--providers adguardvpn,protonvpn`

インストーラは次のことを行う（すべて冪等）。

1. Docker（公式リポジトリ）と依存パッケージを導入する（既にdocker composeが使えるなら何もしない）。
2. ホストの最小限の設定: `/etc/sysctl.d/99-vpngwgui.conf`（IPフォワーディング）と、起動時のKill Switchガード（`vpngwgui-boot-guard.service`）。
3. ソースを`/opt/vpngwgui`へ取得し、`.env`（LAN側インターフェース名・有効なベンダー・composeの合成）を作る。
4. 有効にしたベンダーのホスト側の追加手順（`vendors/<ID>/install-host.sh`。あるベンダーだけ）を実行する。
5. `docker compose up -d --build`で起動し、Web UI（`http://<このホスト>:8080`）の応答を待つ。

完了後、Web UIでベンダーごとにログインし、LAN機器のデフォルトゲートウェイをこのホストへ向ける。

### 引数

| 引数 | 意味 |
|---|---|
| `--providers <ID>[,<ID>...]` | 有効にするベンダー（`vendors/<ID>/`のディレクトリ名）。省略時は前回の設定を維持し、初回で端末から実行していれば対話で選ぶ。指定も対話もできなければ失敗する（既定のベンダーは無い） |
| `--lan-iface <名前>` | LAN側インターフェース名を指定する（自動検出できない・複数NICの場合） |
| `--redetect-lan-iface` | 保存済みのLAN側インターフェース名を捨てて再検出する（VPN未接続のときに実行する） |
| `--no-start` | 起動しない |

### 更新・ベンダーの変更

同じ操作を再実行する。新しい版へ更新するには、新しい版の`install.sh`（`releases/latest`か、タグ指定の`releases/download/<タグ>/install.sh`）を実行する。ベンダーの追加・削除は`--providers`を変えて再実行する（無効にしたベンダーのランナーは停止・削除され、ログイン情報は残る）。引数なしの再実行は、前回のベンダーのまま更新だけを行う。

```sh
sudo sh /opt/vpngwgui/install/install.sh --providers adguardvpn   # 取得済みのソースから直接実行してもよい
```

### 手動で取得する場合

```sh
git clone https://github.com/nekono-dev/vpngateway-gui.git /opt/vpngwgui
sudo sh /opt/vpngwgui/install/install.sh --providers <ベンダーID>
```

### ホストへの変更（すべて）

取得先ディレクトリ（`/opt/vpngwgui`）、`/etc/sysctl.d/99-vpngwgui.conf`、`/etc/systemd/system/vpngwgui-boot-guard.service`、Dockerの公式リポジトリ設定（`/etc/apt/keyrings/docker.asc`・`/etc/apt/sources.list.d/docker.list`）とDocker・依存パッケージ、有効なベンダーの`install-host.sh`が行うもの。

### 既知の制約

- 検証済みはUbuntu 24.04とDebian 12（bookworm）（いずれもLXCのクリーンなコンテナ。導入・再実行・ベンダーの変更・失敗系）。Raspberry Pi OSと、ホストの再起動後の起動時Kill Switchガードの維持は未検証。`nftables.service`が有効な環境（Debian 12の既定は無効）では、起動時のガードが消去される可能性がある（インストーラは警告を出す）。
- アンインストール・IPv6は対象外。
- `curl | sh`はGitHub ReleaseのHTTPSを信頼する方式。頒布物は取得するコミットを固定し、取得後に照合する。ダウンロードして`install.sh.sha256`で検証してから実行してもよい。

## ベンダーの追加

`vendors/<ベンダーID>/`を1つ追加するだけで、共通部（API・Web・ネットワークコンテナ・composeの本体・インストーラ）の改修は要らない。構成は[specs/design.md](specs/design.md)「ベンダー非依存の設計原則」、手順は[specs/runner/design.md](specs/runner/design.md)「ベンダーの追加方法」。

## 開発

```sh
npm ci
npm run generate:api-client   # OpenAPIからWebのAPIクライアントを生成（web/src/generated/。git管理外）
npm test                      # 単体テスト・ベンダー中立性の検査・インストーラの検査
```

E2E（実VPN・実LAN・LXC）は[e2e/README.md](e2e/README.md)。
