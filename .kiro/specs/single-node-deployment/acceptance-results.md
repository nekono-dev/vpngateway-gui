# 実機受入結果

- 検証サーバ: `192.168.3.240`（LXD 5.21.9、共有カーネル 6.8.0-149）
- 導入済み環境の確認用容器: `acc-vpngwgui`（Ubuntu 24.04.5、OS 標準の Docker 29.1.3 / Compose v2 パッケージ、Node.js 22 導入後のスナップショット `clean-node22`）
- Docker 導入受入用容器: `acc-vpngwgui-fresh`（Ubuntu 24.04.5、イメージ `12a0de07e168` から作成、スナップショット `clean-nodocker`）
- 配布物: `vpngwgui-acc-e540ded.tar.gz`（SHA-256 `07fc5815f85b796186e16a0acd76272149411d6c9f78ccc4c7ec7e5288ea7317`）、修正後 `vpngwgui-acc-89fbccc.tar.gz`（SHA-256 `7cc20b15536205169ebfb86f76795140af516210a2229340e8aabb8585b330e8`）
- 模擬資材: `vpngwgui-mock-inputs.tar.gz`（SHA-256 `bc2c587ca1b5ab17df115259a920fb178a51a54d8267133ab0be0c95719af035`）

## 8.5 Docker 未導入環境からの導入（要件 8.9）

### 準備

| 項目 | 内容 |
|---|---|
| 容器の作成 | `lxc launch 12a0de07e168 acc-vpngwgui-fresh -c security.nesting=true -c security.syscalls.intercept.mknod=true -c security.syscalls.intercept.setxattr=true` |
| 初期状態 | `docker` コマンドなし、`docker`/`containerd` パッケージなし、curl・nft あり |
| スナップショット | `clean-nodocker`（各 run の前に復元） |
| LAN 側インターフェース | 試験用ブリッジ `e2eseg` を作成し `.env` に `LAN_IFACE=e2eseg` |

### 結果

| 確認項目 | 操作 | UTC | 期待結果 | 実測結果 | 合否 |
|---|---|---|---|---|---|
| 事前確認 | `check` | 2026-11-19T12:48:10Z | Docker 未導入を apply で対処する項目として表示し合格 | 「Docker 未導入 … apply 対処=Docker Engine と Compose plugin を同意のうえ導入」「OK: Docker action=install」、終了 0 | 合格 |
| 端末なし・`--yes` なし | `apply </dev/null`（`lxc exec -T`） | 2026-11-19T12:48:10Z | 取得元と SHA-256 を表示し、`--yes` を案内して非 0、何も変更しない | 取得元 `https://get.docker.com`、SHA-256 `c9e2607b…a890e4` を表示。「対話端末がないため同意を確認できません。自動実行では `sh compose/host-preparation.sh apply --yes` を指定してください。」、終了 1。state・`/etc/docker` なし、Docker 未導入のまま | 合格 |
| 同意拒否 | `apply` に `n` を入力（`lxc exec -t`） | 2026-11-19T12:40:44Z 頃 | 非 0、何も変更しない | 「同意が得られなかったため中止しました。」、終了 1、state なし、Docker 未導入のまま | 合格 |
| 対話同意で導入 | `apply` に `y` を入力 | 2026-11-19T12:48:20Z〜12:48:52Z | 公式スクリプトで導入、再検査、以降のホスト準備まで成功 | Docker Engine 29.10.0（docker-ce）と Compose plugin 5.8.0 を導入。「Docker Engine 29.10.0 と Compose plugin を確認しました。」（1 回）、boot guard BLOCK（e2eseg）、reboot 基盤、daemon.json 作成と Docker 再起動まで終了 0 | 合格 |
| `--yes` で導入 | `apply --yes`（端末なし） | 2026-11-19T12:43:51Z〜12:44:26Z | 問い合わせなしで導入から全段階まで成功 | 同上の段階をすべて完了し終了 0（配布物 e540ded。確認表示が 3 回重複していたため修正し、89fbccc で 1 回を確認） | 合格 |
| 導入後の状態 | `status`、`check`、パッケージ・設定の確認 | 2026-11-19T12:44Z | rootful・Compose・28 以上、daemon.json 所有、FORWARD 許可、boot guard が Docker の前提 | 配布元=Docker公式、Engine 29.10.0、Compose 利用可、daemon.json OWNED（`{"ip-forward-no-drop": true}`）、FORWARD ACCEPT、sysctl・boot guard・reboot 基盤 active、`docker.service` の Requires/After に `vpngwgui-boot-guard.service` | 合格 |
| 解除 | `remove` | 2026-11-19T12:48:53Z | 製品固有設定だけ解除し、Docker が残る旨を表示 | host_reboot・sysctl・boot_guard・docker_forward を解除、daemon.json と state を削除。「Docker・Compose plugin・追加した配布元は残ります。必要なら手動で撤去してください」。Docker と Compose はそのまま、guard table なし | 合格 |

### 受入中に見つけて直した不具合

| 内容 | 対応 |
|---|---|
| 制御端末がないと `/dev/tty` を開けずシェルの生のエラーが表示され、`--yes` の案内が出なかった | 89fbccc で修正し、上の「端末なし」行で再確認 |
| Docker の確認表示が apply で 3 回、check で 2 回重複した | 89fbccc で修正し、1 回の表示を確認 |
