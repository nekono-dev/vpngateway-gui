# Phase 17: インストーラの`--providers`省略時のall化

## 目的

`install/install.sh`で`--providers`を省略した場合、これまでは「端末から対話できれば選ばせ、できなければ失敗」だったが、`vendors/`にあるその時点の全ベンダー（all）を有効にするよう変更する。あわせて、既存インストールに対する`--providers`省略での再実行（アップデート）でも同じ規則を適用することで、新しく`vendors/`へ追加されたベンダーが利用者の操作なしに自動的に有効化されるようにする。

## 前提

- Phase 11（インストーラと頒布）・Phase 8（Web UIからのベンダー選択、ベンダーバンドル`vendors/<ID>/`の枠組み）が完了していること。

## スコープ外

- `--providers`を明示的に指定した場合の挙動（従来通り、その集合をそのまま採用する。変更しない）。
- ベンダーごとの有効・無効をWeb UIから変更する機能（インストーラの引数のみを対象とする）。

## 主要タスク

- [x] `specs/requirements.md`「インストール」・`specs/design.md`「有効化」「本体インストーラ」を、`--providers`省略時はall、対話選択は廃止という内容へ更新する
- [x] `install/install.sh`の`setup_providers`を、`--providers`があればそれを使い、無ければ`list_bundles`（その時点の全ベンダー）を使うよう変更する
- [x] 対話選択（`prompt_providers`）を削除する
- [x] `install/tests/`の既存テストを更新する（対話選択のテストを削除し、省略時allのテストを追加）
- [x] `usage`（スクリプト冒頭のコメント）の`--providers`の説明を更新する

## 完了基準

- `install/tests/run.sh`がFAIL 0であること。
- 検証環境（AGENTS.md「実機検証のタイミング」）で、①`--providers`省略時に全ベンダーのランナーが起動すること、②既存インストール（一部ベンダーのみ有効化済み）に`vendors/`へ新規バンドルを追加した状態で`--providers`省略で再実行すると、既存の有効なベンダーは維持されたまま新規バンドルも有効化されること、を確認する。

## 検証手法

検証環境（`ubuntu@192.168.3.240`。Ubuntu 24.04、AdGuard VPN・Proton VPNの2ベンダー構成）の`/opt/vpngwgui/install/install.sh`のみをPhase17版へ差し替え（`scp`。docker-compose本体・vendorsは変更が無いため再ビルドせず、`--no-start`で`docker compose up`を伴わない範囲のみ検証）。検証前に既存の`install.sh`と`.env`をバックアップし、検証後に元へ復元した。

- **既存インストールへの適用（アップデート想定）**: `.env`の`VPN_PROVIDERS`を意図的に`adguardvpn`のみへ書き換えた上で、`sudo sh install/install.sh --no-start`（`--providers`省略）を実行し、`.env`の`VPN_PROVIDERS`・`COMPOSE_FILE`が`adguardvpn,protonvpn`（vendors/にある全ベンダー）へ戻ることを確認。
- **明示指定時の従来動作**: `sudo sh install/install.sh --providers adguardvpn --no-start`を実行し、`.env`が`adguardvpn`のみに絞られることを確認（allへの変更が明示指定を上書きしないこと）。
- 検証後、`install.sh`・`.env`を元のPhase16検証終了時点の内容へ復元し、`docker compose ps`で全コンテナ（api・proxy・runner-adguardvpn・runner-protonvpn・web）が検証前と変わらず稼働継続していることを確認した（`--no-start`のため、検証中もdocker composeの起動・再起動は発生していない）。

## 検証結果（2026-09-22、検証環境で確認）

- 上記2シナリオともFAIL 0（`.env`の内容が期待通り）。`npm test`のうち`check:neutrality`・`test:install`（開発機、`install/tests/run.sh`）もFAIL 0。
- 検証終了時: 実行前の状態（VPN切断、透過ゲートウェイ=ON・Kill Switch=ON、選択中ベンダー: AdGuard VPN、`.env`のVPN_PROVIDERS=adguardvpn,protonvpn）から変化なし。

## 次フェーズへの申し送り

- 本フェーズは`--no-start`の範囲（`.env`の決定ロジック）のみを実機検証した。`docker compose up`を伴う実際のランナー起動・停止（例: 新規ベンダー追加時に対応するランナーコンテナが実際に立ち上がること）は、通常のアップデート運用（Phase11以降の既存フローと同じ`docker compose up -d --build --remove-orphans`）の範囲であり、本フェーズで新たに変更した部分ではないため、個別の実機検証は行っていない。
