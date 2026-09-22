# Phase 18: インストーラのアンインストール機能

## 目的

`install/install.sh`に`--uninstall`引数を追加し、このインストーラ自身が導入・作成したもの（docker composeスタック、IPフォワーディングの設定、起動時のKill Switchガード、有効なベンダーのホスト側の後始末）を後始末できるようにする。これまではREADME.mdに手動手順を列挙するだけだった。

## 前提

- Phase 11（インストーラと頒布）・Phase 17（`--providers`省略時のall化）が完了していること。

## スコープ外

- ソースの取得先ディレクトリ（既定`/opt/vpngwgui`）・Docker本体・依存パッケージ・Dockerの公式リポジトリ設定の削除（他の用途と共有されうるため、意図的に自動化しない。手動での削除に委ねる）。
- ベンダーの追加・削除（`--providers`。本フェーズはインストール全体の後始末のみを対象とする）。

## 主要タスク

- [x] `specs/requirements.md`「インストール」・`specs/design.md`「本体インストーラ」に、アンインストールの要件・設計（処理の順序、`--keep-data`、`uninstall-host.sh`の契約、対象外とするものの理由）を追記する
- [x] `install/install.sh`に`--uninstall`・`--keep-data`引数を追加し、`uninstall_main`（`uninstall_stack`・`uninstall_boot_guard`・`uninstall_sysctl`・`uninstall_host_hooks`）を実装する
- [x] ベンダーバンドルの新しい任意ファイル`uninstall-host.sh`の契約（`install-host.sh`と同じ環境変数・カレントディレクトリだが、失敗しても後始末を続ける）を実装する
- [x] `usage`（スクリプト冒頭のコメント）にアンインストールの使い方を追記し、`usage()`関数がその範囲も表示するようにする
- [x] `install/tests/run.sh`に、引数解釈（`--uninstall`の使い方表示、`--keep-data`単独指定の拒否）と、root・Docker・systemdが要らない範囲の関数検査（`uninstall_stack`の未導入時no-op、`uninstall_host_hooks`の呼び出し契約）を追加する
- [x] `README.md`「アンインストール」を、手動手順の列挙から`--uninstall`コマンドの案内へ更新し、対象外の項目のみ手動手順として残す

## 完了基準

- `install/tests/run.sh`がFAIL 0であること。
- 検証環境（AGENTS.md「実機検証のタイミング」）で、`--uninstall`実行後に①docker composeのコンテナ・ネットワーク・ボリューム（ベンダーのログイン情報）が削除されていること、②`/etc/sysctl.d/99-vpngwgui.conf`・`vpngwgui-boot-guard.service`が削除・無効化されていること、③再度インストールコマンドを実行すると復旧すること（再ログインが必要）、④`--keep-data`を付けた場合はボリュームが保持され再導入後もログイン状態が維持されることを確認する。

## 検証手法

検証環境（`ubuntu@192.168.3.240`。Ubuntu 24.04、AdGuard VPN・Proton VPNの2ベンダー構成、稼働中）の`/opt/vpngwgui/install/install.sh`・`install/tests/run.sh`のみをPhase18版へ`scp`で差し替え、以下を実施した。

1. `install/tests/run.sh`（root不要な範囲）を実行。
2. `sudo sh install/install.sh --uninstall --keep-data`を実行し、docker composeスタック・sysctl設定・起動時ガードが削除され、ボリュームが保持されることを確認。
3. `sudo sh install/install.sh --providers adguardvpn,protonvpn`で再インストールし、AdGuard VPNのログイン状態（`GET /v1/session`）が再ログイン無しで維持されていることを確認。
4. 利用者の承認のもと、`sudo sh install/install.sh --uninstall`（`--keep-data`無し、既定動作）を実行し、ボリューム（ベンダーのログイン情報）も削除されることを確認。
5. 再度`sudo sh install/install.sh --providers adguardvpn,protonvpn`で再インストールし、`GET /v1/session`が`loggedIn:false`（再ログインが必要な状態）に戻ることを確認。

## 検証結果（2026-09-22、検証環境で確認）

- `install/tests/run.sh`: FAIL 0（26項目PASS）。
- `--keep-data`指定時: `docker compose ps`でコンテナ・ネットワークが削除されること、`/etc/sysctl.d/99-vpngwgui.conf`・`vpngwgui-boot-guard.service`（`systemctl is-enabled`が`not-found`）が削除されること、`docker volume ls`でベンダーのボリューム（`vpngwgui_adguard-data`・`vpngwgui_proton-*`等）が保持されることを確認。再インストール後、`GET /v1/session`が`{"loggedIn":true,...}`（AdGuard VPN、再ログイン不要）を返すことを確認。
- 既定動作（`--keep-data`無し）: `docker compose down --volumes`によりベンダーのボリュームがすべて削除される（ログ・`docker volume ls`で確認）ことを確認。再インストール後、`GET /v1/session`が`{"loggedIn":false}`となり、再ログインが必要な状態になることを確認（意図通り）。
- 検証終了時点: `.env`は検証前と同じ内容（`VPN_PROVIDERS=adguardvpn,protonvpn`）に復元済みだが、**ベンダーのログイン情報は検証（手順4）により失われている**。検証環境の利用者（nekono）が、Web UI（`http://192.168.3.240:8080`）から両ベンダーへ再ログインする必要がある。

## 次フェーズへの申し送り

- 検証環境のAdGuard VPN・Proton VPNは、本フェーズの検証（既定動作の実機確認）により未ログイン状態になっている。次にこの検証環境を使う作業（Phase19以降）の前に、Web UIから再ログインしておくこと。
