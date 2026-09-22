# Phase 20: アンインストールの頒布URL対応・取得先ディレクトリの削除

## 目的

Phase 18で実装した`install/install.sh --uninstall`は、ソースの取得先ディレクトリ（`/opt/vpngwgui`）へ既に`cd`して実行することを前提にしており、そのディレクトリ自体は対象外（手動削除）としていた。本フェーズでは、(1) インストール時と同じ頒布URL（`curl -fsSL <URL>/install.sh | sudo sh -s -- --uninstall`）だけでアンインストールが完結できるようにし、(2) ソースの取得先ディレクトリ自体も自動で削除する。

## 前提

- Phase 13（インストーラと頒布のCI・ブートストラップ）・Phase 18（アンインストール機能）が完了していること。

## スコープ外

- Docker本体・依存パッケージ・Dockerの公式リポジトリ設定の削除（Phase18から変更なし。他の用途と共有されうるため対象外）。
- `install/bootstrap.sh`自体の変更（ブートストラップは元々「取得 → 本体インストーラへ引数をそのまま渡す」だけであり、`--uninstall`もこの仕組みにそのまま乗る。変更は本体インストーラ側のみ）。

## 主要タスク

- [x] `specs/requirements.md`「インストール」・`specs/design.md`「本体インストーラ」に、頒布URL経由でのアンインストール完結・取得先ディレクトリの自動削除の要件・設計（安全対策、セルフデリートがLinuxで安全な理由）を追記する
- [x] `install/install.sh`に`remove_repo_root`（`REPO_ROOT`の削除。危険なパスへの安全対策付き）を実装し、`uninstall_main`の最後で呼ぶ
- [x] `usage`（スクリプト冒頭のコメント）を、頒布URL経由の例を含めて更新する
- [x] `install/tests/run.sh`に、`remove_repo_root`がディレクトリを削除すること・危険なパス（`install/install.sh`を含まないディレクトリ）では中止することのテストを追加する
- [x] `e2e/phase20/uninstall-scenarios.sh`（LXCのクリーンなコンテナ、`phase11/install-scenarios.sh`と同じfile://方式）を追加し、頒布URLと同じ経路（ブートストラップの標準入力パイプ）での導入→アンインストール（取得先ディレクトリの削除を含む、実行中のスクリプト自身を含むディレクトリを削除しての完走＝セルフデリートを実機で兼ねて確認）→再導入を自動検証する
- [x] `README.md`「アンインストール」のコマンド例を、ローカルの`install/install.sh`直接実行から頒布URL（`curl | sudo sh -s -- --uninstall`）へ変更し、「残っているもの」から取得先ディレクトリの項目を削除する

## 完了基準

- `install/tests/run.sh`がFAIL 0であること。
- 検証環境（AGENTS.md「実機検証のタイミング」）で、①頒布URL経由の`--uninstall`実行後に`/opt/vpngwgui`が存在しないこと、②docker composeスタック・sysctl設定・起動時ガードがPhase18同様に後始末されること、③アンインストール後に同じ頒布URLで再インストールでき、正常に動作することを確認する。

## 検証手法

`e2e/phase20/uninstall-scenarios.sh`を、開発ホストのLXD（クリーンなUbuntu 24.04コンテナ、`security.nesting=true`）で実行した。`phase11/install-scenarios.sh`と同じく、開発ホストのリポジトリ（このコミット）から作った裸リポジトリをコンテナ内`/srv/vpngw.git`へ置き、`file://`で取得する頒布物（`install/build-bootstrap.sh`で生成）を使う。GitHubへのpush・Releaseは使わない。

1. ブートストラップを標準入力のパイプで実行し、導入（`--providers adguardvpn`、`--web-port`省略＝既定80）。
2. 同じ頒布物を`--uninstall`で標準入力のパイプで実行（事前に`/opt/vpngwgui`を用意せず、ブートストラップ自身に取得させた）。
3. 取得先ディレクトリ・docker composeスタック・sysctl設定・起動時ガードの状態を確認。
4. 同じ頒布物で`--providers adguardvpn`を再実行し、再導入できることを確認。

## 検証結果（2026-09-22、開発ホストのLXCで確認）

- `install/tests/run.sh`: FAIL 0（35項目PASS）。
- `e2e/phase20/uninstall-scenarios.sh`: **FAIL 0（12項目PASS）**。
  - 導入: ブートストラップ経由で成功、Web UIがポート80で応答、AdGuard VPNが一覧に現れる。
  - アンインストール: ブートストラップが`--uninstall`引数をそのまま本体インストーラへ渡し、`/opt/vpngwgui`（実行中のスクリプト自身を含むディレクトリ）を削除する形で完走した（自己削除。ログの最後に`ソース一式を削除しました（/opt/vpngwgui）`が出力され、後続のコマンドも正常終了）。取得先ディレクトリの消失、docker composeのコンテナ全消滅、`/etc/sysctl.d/99-vpngwgui.conf`・`vpngwgui-boot-guard.service`の削除・無効化を確認。
  - 再導入: 同じ頒布物（`--uninstall`無し）で再実行すると、`/opt/vpngwgui`が復元され、Web UIが再び応答する。
- 検証中、開発時に用意した簡易な検証手順（`sh -c`でシェル関数を呼ぶ形）が`sh`環境ではbash関数を見つけられず1件FAILしたため、`check`へ渡す関数を他の検査と同じ形（`t_web_has_adguard`のような専用関数）へ修正し、再実行でFAIL 0を確認した。

## 次フェーズへの申し送り

- 本検証はLXCの開発ホストで実施した。検証環境（`ubuntu@192.168.3.240`）の実機での頒布URL（GitHub Releaseの実URL）経由の確認は、pushの許可を得た上で別途行う（`e2e/phase11/install-scenarios.sh`と同じ位置づけ。Phase11の完了基準もLXCでの`file://`検証が中心で、実際の`curl | sh`はGitHub Actions・Releaseを使った別検証で確認済み）。
