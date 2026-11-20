# 実機受入結果

- 検証サーバ: `192.168.3.240`（LXD 5.21.9、共有カーネル 6.8.0-149）
- 導入済み環境の確認用容器: `acc-vpngwgui`（Ubuntu 24.04.5、OS 標準の Docker 29.1.3 / Compose v2 パッケージ、Node.js 22 導入後のスナップショット `clean-node22`）
- Docker 導入受入用容器: `acc-vpngwgui-fresh`（Ubuntu 24.04.5、イメージ `12a0de07e168` から作成、スナップショット `clean-nodocker`）
- 配布物: `vpngwgui-acc-e540ded.tar.gz`（SHA-256 `07fc5815f85b796186e16a0acd76272149411d6c9f78ccc4c7ec7e5288ea7317`）、修正後 `vpngwgui-acc-89fbccc.tar.gz`（SHA-256 `7cc20b15536205169ebfb86f76795140af516210a2229340e8aabb8585b330e8`）
- 模擬資材: `vpngwgui-mock-inputs.tar.gz`（SHA-256 `bc2c587ca1b5ab17df115259a920fb178a51a54d8267133ab0be0c95719af035`）
- 8.3〜8.6 の実行方式: `acc-vpngwgui-fresh`（Docker を host-preparation `apply` で導入した容器）に、NOPASSWD sudo を持つ root 以外の利用者 `runner` を作り、リポジトリ一式（`git archive` の tarball を scp で配置）で GitHub のワークフロー `e2e-hosted.yml` と同じ手順を実行した。試験用の経路（`lan`・`isp`・`vpnexit` 名前空間、ブリッジ `e2eseg`）と製品の起動は hosted E2E の準備処理（`provision_group_prepare`）で行い、その状態の上で個別の測定スクリプトを root で実行した。nftables 1.0.9、kernel 6.8.0-149（サーバと共有）。

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

## 8.3 nft guard の構文・評価順・遮断経路（要件 2.5・2.8・8.2）

測定は c4bd560（下記の出口判定の修正後）で、gateway の準備処理のあと mock VPN 接続・透過ゲートウェイ・DNS 中継と 53 番転送・迂回（`bypass.e2e.test`）を API で有効にして行った。各経路は、正常時（guard が LEASE）の成功と、proxy を `docker pause` してリースを失効させた遮断時（BLOCK）の失敗を両方確かめた。

| 確認項目 | 操作 | UTC | 期待結果 | 実測結果 | 合否 |
|---|---|---|---|---|---|
| 構文検査 | 製品と同じ timeout set・priority -1 の return/drop・priority 0 の chain を一時 table で `nft -c -f` | 16:35:31.977Z | 成功し、規則は適用されない | 成功 | 合格 |
| 状態遷移 batch の繰り返し | 製品の LEASE batch（flush chain・flush set・add element・return・drop）を `nft -c` で 3 回。実適用は proxy が 1 秒ごとにリース更新として同じ batch を適用 | 16:35:32.016Z | すべて成功 | 3 回とも成功。proxy ログに `gateway_guard_lease_refreshed` が 1 秒ごとに続き、適用失敗なし | 合格 |
| 期限付き set | proxy を一時停止し、製品と同じ batch で 4 秒の要素を追加、2 秒後に更新、250ms ごとに観測 | 16:30:01.106Z〜16:30:07.206Z | 更新でタイマーが再開し、更新から約 4 秒で自然失効 | 追加 01.106Z、更新 03.125Z（残り 3s985ms に戻る）、自然失効 07.206Z（更新から 4080ms、追加から 6099ms） | 合格 |
| 評価順 | `nft -a list table inet vpngwgui_guard` と `inet vpngwgui` | 16:01Z（acc-vpngwgui） | guard chain は priority filter-1 で LEASE 時 `iifname @healthy_lease4 return`、その後 `iifname "e2eseg" drop`。Gateway の forward は priority filter | 期待どおり。LEASE 時の return のあと priority 0 の `ct status dnat accept` 等で評価が続くことを下の DNAT 転送の成功で確認 | 合格 |
| DNAT 転送 | `ip netns exec lan curl http://192.168.50.1:<Web>/`（Docker 公開ポートへの DNAT） | LEASE 16:35:32.025Z / BLOCK 16:35:43.081Z | LEASE は 200、BLOCK は失敗 | 200 / 5 秒で接続タイムアウト | 合格 |
| DNS 中継 | `lan` から `relay.e2e.test` を引く | 16:35:45.136Z / 16:36:01.196Z | LEASE は上流の応答 198.51.100.254、BLOCK は応答なし | 198.51.100.254 / 応答なし | 合格 |
| 53 番転送 | ISP の DNS（198.51.100.254）へ直接問い合わせ。転送無効の対照と有効時を比較 | 16:36:03.537Z / 16:36:12.690Z | 無効時は ISP の直接応答 203.0.113.99、有効時は中継へ転送され NXDOMAIN。BLOCK は応答なし | 203.0.113.99 / NXDOMAIN / 応答なし（TIMEOUT） | 合格 |
| VPN 転送 | `lan` から ISP の echo（`https://198.51.100.254/`） | 16:36:14.732Z / 16:36:28.787Z | LEASE は VPN 出口の IP 192.168.50.200 が見える。BLOCK は失敗 | 192.168.50.200 / 8 秒でタイムアウト | 合格 |
| 迂回 | `bypass.e2e.test` を引いてから `https://198.51.100.253/` | 16:36:30.849Z / 16:36:54.926Z | LEASE は迂回され送信元がゲートウェイ（192.168.50.1）、bypass set に 198.51.100.253。BLOCK は失敗 | 192.168.50.1、bypass set に要素あり / タイムアウト | 合格 |
| BLOCK 時の guard | 各経路の BLOCK 中に guard chain と set を表示 | 各 BLOCK 時 | `iifname "e2eseg" drop` があり、`healthy_lease4` が空 | 5 経路すべてで期待どおり | 合格 |
| Gateway table 再作成後の guard 維持 | `docker restart <proxy>` の前後で両 table の handle を比較 | 16:37:02.243Z | `inet vpngwgui` は作り直され、guard table・set・chain は同じもののまま LEASE に戻る | Gateway table handle 116→117。guard は table 78・set 1・chain 2 のまま。再起動後の DNAT 転送 200 | 合格 |

## 8.4 Kill Switch 停止時の遮断と変更拒否（要件 2.8・8.2）

透過ゲートウェイ有効・mock VPN 接続中に、`lan` から Docker 公開ポートへの DNAT 転送経路（`http://192.168.50.1:<Web>/`）を 100ms 間隔で確かめながら proxy を停止した。測定中は proxy の自動再起動を止め、各ケースの後に元へ戻して LEASE（Kill Switch 無効時は OFF）への回復を待った。proxy 停止中は API から guard の状態を読めないため、遮断は nft の guard chain を直接見て判定した。

2 回目（a79788d、停止要求以降の probe 回数を記録）:

| Kill Switch | 停止方式 | 停止要求（UTC） | 最後の成功（UTC） | 最初の失敗（UTC） | 経過ms | 停止要求以降の probe（成功/失敗） | guard 遮断規則 | 合否 |
|---|---|---|---|---|---|---|---|---|
| true | 強制終了（`docker kill -s KILL`） | 2026-11-19T17:06:14.169Z | 2026-11-19T17:06:17.904Z | 2026-11-19T17:06:18.011Z | 3842 | 35/9 | あり | 合格 |
| true | 一時停止（`docker pause`） | 2026-11-19T17:06:31.919Z | 2026-11-19T17:06:35.434Z | 2026-11-19T17:06:35.541Z | 3622 | 33/9 | あり | 合格 |
| true | 通常停止（`docker stop`） | 2026-11-19T17:06:43.582Z | 2026-11-19T17:06:43.546Z | 2026-11-19T17:06:43.652Z | 70 | 0/19 | あり | 合格 |
| false | 強制終了（`docker kill -s KILL`） | 2026-11-19T17:07:01.879Z | 2026-11-19T17:07:08.934Z | なし | — | 66/0 | なし | 合格 |
| false | 一時停止（`docker pause`） | 2026-11-19T17:07:11.752Z | 2026-11-19T17:07:18.689Z | なし | — | 65/0 | なし | 合格 |
| false | 通常停止（`docker stop`） | 2026-11-19T17:07:23.408Z | 2026-11-19T17:07:30.457Z | なし | — | 66/0 | なし | 合格 |

1 回目（c4bd560）も同じ傾向だった（Kill Switch 有効で 3296ms・3294ms・75ms、無効では失敗なし）。

- 通常停止では、1 回目の停止要求（16:37:54.816Z）から 42ms 後の 16:37:54.858Z に proxy が `gateway_guard_shutdown_lease_expired`（state BLOCK）を記録しており、proxy の終了前に遮断へ移っている。強制終了と一時停止は、リース（4 秒）の失効によって 3.3〜3.9 秒で遮断された。
- Kill Switch 無効では、どの停止方法でも停止要求から 7 秒間の probe 65〜66 回がすべて HTTP 成功し、guard の遮断規則は入らなかった。
- 通常停止の proxy ログは 1 回目のもの（2 回目は直後の試験で container を作り直したためログが残っていない）。

| 確認項目 | 操作 | UTC | 期待結果 | 実測結果 | 合否 |
|---|---|---|---|---|---|
| 停止中の Kill Switch 変更 | proxy を一時停止して `PUT /api/v1/connection/config`（killSwitch を反転） | 16:38:57.176Z | 503 `kill_switch_not_applied`、永続値は不変 | 503 `{"error":"kill_switch_not_applied"}`、前後の GET で値は不変 | 合格 |
| 再開後の再試行 | proxy 再開後に同じ PUT | 16:38:59.247Z | 反映される | 200、新しい値を返す | 合格 |
| 停止中の透過ゲートウェイ変更 | 一時停止中に `{"transparentGatewayEnabled":false,"explicitProxyEnabled":true}` | 16:39:27.981Z | 503、永続値は不変 | 503 `{"error":"gateway_setting_not_applied"}`、値は不変 | 合格 |
| 有効値を変えない変更 | 一時停止中に同じ値の PUT | 16:39:33.011Z | 受け付けられる | 200 | 合格 |
| 再開後の再試行 | 再開後に同じ PUT、その後元へ戻す | 16:39:46.023Z | 反映される | 200、`transparentGatewayEnabled=false` を確認後、元に戻して 200 | 合格 |

## 8.5 Compose lifecycle とホスト準備（続き、要件 2.5・2.7・6.1〜6.7・8.3・8.5）

| 確認項目 | 操作 | UTC | 期待結果 | 実測結果 | 合否 |
|---|---|---|---|---|---|
| lifecycle とデータ保持 | hosted E2E の lifecycle 試験を lab で実行（管理者・設定・お気に入り・監査ログ・ベンダー状態を作成し、build と up、force-recreate、通常 down と up、vendor fragment を外した down と orphan の識別・再追加、`down -v`） | 2026-11-19 lab 1 回目（dd46af8、15:56 頃開始）・2 回目（c4bd560、16:36 頃開始） | 通常操作では保持、`down -v` の後だけ初期設定画面から始まる | 合格（lab の 1 回目・2 回目とも）。各段階（build と up、force-recreate、通常 down と up、fragment を外した down・up と再追加）の後に、管理者が設定済み、Kill Switch を false に変えた設定、登録したお気に入り、監査ログの `switch-provider`、adguardvpn のログイン状態がすべて残ることを確認。fragment を外した間は protonvpn の volume を orphan として識別し、再追加で同じ volume 名に戻る。`down -v` で project の named volume が空になり、次の up は管理者未設定・「初期設定」画面から始まる | 合格 |
| host-preparation の apply/status/remove | Docker 導入受入（上記）と `acc-vpngwgui` の status | 12:44Z / 16:42Z | 製品の所有物だけを変更・解除し、状態を表示 | 上記 Docker 導入受入の結果どおり。`acc-vpngwgui` の status は sysctl・boot guard・reboot 基盤・daemon.json がすべて active/OWNED | 合格 |
| 製品外設定の不変更 | `acc-vpngwgui-fresh` で apply 前・apply 後・`docker compose down` と remove 後に、/etc・/usr/local の全ファイルの内容・権限・所有者・リンク先、`sysctl -a` の net.*、nft の table 一覧を記録して比較（acceptance-scripts/acc-8.5-foreign.sh） | 17:00:11Z〜17:00:15Z | apply が変えるのは製品の所有物だけで、remove 後は apply 前と同一 | apply で変わったのは `/etc/docker/daemon.json`、`/etc/sysctl.d/99-vpngwgui-host-preparation.conf`、`/etc/systemd/system/vpngwgui-{boot-guard.service,host-reboot.path,host-reboot.service}`、`/etc/vpngwgui/boot-guard.nft`、`/usr/local/libexec/vpngwgui-host-reboot`、製品 unit への依存 symlink 3 本、`inet vpngwgui_guard` table だけ。sysctl net.* は apply 前から製品の値と同じで差分なし。remove 後は apply 前とすべて同一（差分なし） | 合格 |
| boot guard の起動順 | `acc-vpngwgui` を `lxc restart` | 16:46:44Z | nftables の後、network-pre・Docker の前に BLOCK を適用し、Docker と stack が起動する | 修正後: nftables 完了 56.286Z → boot guard 56.337〜56.343Z → network-pre 56.576Z → docker.socket 57.688Z → docker.service 57.854〜58.612Z。guard table は BLOCK、stack の 5 サービスが running | 合格（修正後） |
| boot guard の起動順（docker-ce） | `acc-vpngwgui-fresh`（docker-ce 29.10.0）で a79788d の host-preparation を apply して `lxc restart` | 16:55:15Z | 同上 | nftables 完了 16.727Z → boot guard 16.765〜16.772Z → network-pre 17.038Z → docker.socket 18.749Z → containerd・docker.service 起動。docker・boot guard とも active、前回停止時の順序循環ログなし。再起動で試験用ブリッジ `e2eseg` が消えたため remove は LAN_IFACE の sysctl を「foreign conflict」として一度止まり、ブリッジを作り直すと 4 項目を解除した（lab 固有） | 合格 |
| 再起動要求 | `POST /api/v1/gateway/reboot`（管理者パスワード再入力） | 16:51:49.705Z | 受け付け後にホストが再起動し、製品が自動で戻る | 202 `{"requested":true}`、16:52:00 に新しい boot（boot_id 変化）。Docker・boot guard・再起動要求の監視が active、stack の 5 サービスが running | 合格 |

製品外設定の比較の出力（各「---」見出しの下が空なら差分なし）:

```text
開始 2026-11-19T17:00:11.613Z
apply 終了コード=0
remove 終了コード=0
--- before → applied: ファイル（内容）
変更・追加・削除: /etc/docker/daemon.json
変更・追加・削除: /etc/sysctl.d/99-vpngwgui-host-preparation.conf
変更・追加・削除: /etc/systemd/system/vpngwgui-boot-guard.service
変更・追加・削除: /etc/systemd/system/vpngwgui-host-reboot.path
変更・追加・削除: /etc/systemd/system/vpngwgui-host-reboot.service
変更・追加・削除: /etc/vpngwgui/boot-guard.nft
変更・追加・削除: /usr/local/libexec/vpngwgui-host-reboot
--- before → applied: ファイル（権限・所有者・リンク）
> /etc/docker/daemon.json 644 0:0 
> /etc/sysctl.d/99-vpngwgui-host-preparation.conf 600 0:0 
> /etc/systemd/system/docker.service.requires/vpngwgui-boot-guard.service 777 0:0 /etc/systemd/system/vpngwgui-boot-guard.service
> /etc/systemd/system/multi-user.target.wants/vpngwgui-boot-guard.service 777 0:0 /etc/systemd/system/vpngwgui-boot-guard.service
> /etc/systemd/system/multi-user.target.wants/vpngwgui-host-reboot.path 777 0:0 /etc/systemd/system/vpngwgui-host-reboot.path
> /etc/systemd/system/vpngwgui-boot-guard.service 644 0:0 
> /etc/systemd/system/vpngwgui-host-reboot.path 644 0:0 
> /etc/systemd/system/vpngwgui-host-reboot.service 644 0:0 
> /etc/vpngwgui/boot-guard.nft 600 0:0 
> /usr/local/libexec/vpngwgui-host-reboot 755 0:0 
--- before → applied: sysctl net.*
--- before → applied: nft tables
> table inet vpngwgui_guard
--- before → removed: ファイル（内容）
--- before → removed: ファイル（権限・所有者・リンク）
--- before → removed: sysctl net.*
--- before → removed: nft tables
終了 2026-11-19T17:00:15.520Z
```

lifecycle 試験は、各段階の直後に同じ確認関数（管理者・設定・お気に入り・監査ログ・ベンダー状態）で値を照合し、1 つでも違えばその段階で失敗する。lab の 2 回目（c4bd560、16:36 頃開始の全体実行の最初の群）では 1.5 分で全段階が成功した。

## 8.6 Web HTTPS × Gateway TLS（要件 3.1〜3.4・4.1・5.1〜5.4・5.6・5.7・8.4）

hosted E2E の tls 試験を lab で実行した（Gateway TLS 区間の不正証明書と 4 構成）。Web HTTPS 区間の不正証明書は下の補足で個別に確かめた。

| 確認項目 | 実測結果 | 合否 |
|---|---|---|
| OFF/OFF・ON/OFF・OFF/ON・ON/ON | 4 構成すべてで起動し、ブラウザ認証と API 操作が成功し、平文へ降格しない | 合格 |
| Gateway の wrong-ca・expired・san-mismatch | TLS クライアントが API 操作を拒否し、HTTP へ降格しない | 合格 |
| Gateway の client 証明書不足 | API が起動を拒否し、不足している環境変数と終了状態を記録する | 合格 |
| API と Gateway の TLS 設定不一致 | 専用状態（502 `gateway_protection_mismatch`）と UI 表示を示し、HTTP へ降格しない | 合格 |

### Web HTTPS 区間の不正証明書（acceptance-scripts/acc-8.6-web.sh）

Web コンテナの証明書だけを差し替えて起動し、`curl --cacert <CA> --resolve <名前>:18080:127.0.0.1` で `/` と `/api/v1/operator` に接続した。失敗理由を 1 つに絞るため、不正証明書のケースは発行元の CA（gateway CA）と SAN の名前（gateway.local）で検証した。平文は同じポートへの `curl http://127.0.0.1:18080/` と別ポート 18081 で確かめた。

| ケース | UTC | 期待結果 | 実測結果 | 合否 |
|---|---|---|---|---|
| 正規証明書（対照） | 17:26:47Z | HTTPS で `/`・API とも 200、平文では応答なし | 200・200。平文は同じポートで `Empty reply from server`（本文 0 バイト）、別ポートは接続拒否 | 合格 |
| 誤った CA | 17:27:02Z | 検証失敗、平文へ降格しない | `SSL certificate problem: unable to get local issuer certificate`。平文は応答なし | 合格 |
| 期限切れ | 17:27:17Z | 同上 | `SSL certificate problem: certificate has expired`。平文は応答なし | 合格 |
| SAN 不一致 | 17:27:31Z | 同上 | `SSL: no alternative certificate subject name matches target host name 'gateway.local'`。平文は応答なし | 合格 |

Web 区間には client 証明書の要求がないため、client 証明書不足は Gateway 区間（上表）だけが対象となる。

## lab での hosted E2E 全体

| 実行 | コミット | 結果 |
|---|---|---|
| 1 回目 | dd46af8 | 88 件中 78 件合格。gateway の 10 件が不合格（出口判定の不具合。下表） |
| gateway のみ再実行 | c4bd560 | DNS サーバ宛ての個別経路を残したまま 17 件すべて合格 |
| 2 回目（全体） | c4bd560 | 88 件中 88 件合格（lifecycle・stack・gateway・tls すべて pass） |

## lab 受入で見つけて直した不具合

| 内容 | 対応 |
|---|---|
| 製品が VPN の出口を `ip route get 1.1.1.1` で判定していたため、systemd-networkd が DHCP の DNS サーバ（1.1.1.1・8.8.8.8）宛てに入れる個別経路に引っ張られ、VPN 接続中も物理 NIC（eth0）をトンネルと誤認した。透過ゲートウェイ（5.1）と動作検証（8.1・8.2）が lab でだけ失敗 | c4bd560 で問い合わせ先を TEST-NET-1（192.0.2.1）に変更。個別経路が残ったままで gateway 試験 17 件すべて合格を確認 |
| boot guard unit が既定依存（暗黙の After=basic.target）と `Before=docker.socket` で順序循環を作り、再起動後に Docker と stack が起動しなかった（停止時ログ `Found ordering cycle on docker.socket/stop`） | bae69a6 で `DefaultDependencies=no` に変更し、既知の旧本文を apply で置き換える。apply 後の再起動で上記の起動順と stack の復帰を確認 |
| TLS 不一致の UI 確認が、同じ文言の 2 か所表示（状態欄と接続操作のエラー欄）で Playwright の厳密一致に引っかかることがあった（試験側） | a79788d で状態欄に限定 |
