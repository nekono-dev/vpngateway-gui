# Phase 19: インストーラのWeb UIポート指定機能

## 目的

`install/install.sh`に`--web-port`引数を追加し、Web UIを配信するホスト側のポート番号を指定できるようにする。既定を80（HTTPの標準ポート）へ変更する（従来は8080固定）。

## 前提

- Phase 11（インストーラと頒布）・Phase 18（アンインストール機能）が完了していること。

## スコープ外

- コンテナ内部でのリッスンポート（`web/Dockerfile`の`PORT=8080`）の変更。ホスト側のマッピング元ポートのみを可変にする。
- HTTPS対応・TLS終端（本フェーズは平文HTTPのポート番号のみを対象とする）。

## 主要タスク

- [x] `specs/requirements.md`「インストール」・`specs/design.md`「本体インストーラ」に、`--web-port`の要件・設計（優先順、既定値80、`docker-compose.yml`との連携）を追記する
- [x] `docker-compose.yml`の`services.web.ports`を`"8080:8080"`固定から`"${WEB_PORT:-80}:8080"`（`.env`のWEB_PORTを参照。コンテナ内は8080固定）へ変更する
- [x] `install/install.sh`に`--web-port`引数と`setup_web_port`（優先順: 引数 ＞ `.env`の既存値 ＞ 既定80。1〜65535の整数であることを検証）を実装し、`main`から呼ぶ。待機（`start_stack`）・完了表示（`finish`）が決定した`WEB_PORT`を使うようにする
- [x] `usage`（スクリプト冒頭のコメント）に`--web-port`の使い方を追記する
- [x] `install/tests/run.sh`に、`setup_web_port`の決定ロジック（省略時の既定・引数優先・`.env`の既存値維持・範囲外や非数値の拒否）のテストを追加する
- [x] `README.md`の引数表・設定方法に`--web-port`を追記する

## 完了基準

- `install/tests/run.sh`がFAIL 0であること。
- 検証環境（AGENTS.md「実機検証のタイミング」）で、①`--web-port`省略時にポート80でWeb UIへアクセスできること、②`--web-port 8080`指定時に指定したポートでアクセスでき、80番では応答しないこと、③`--web-port`省略の再実行では直前の設定が維持されること、を確認する。

## 検証手法

検証環境（`ubuntu@192.168.3.240`。Ubuntu 24.04、AdGuard VPN・Proton VPNの2ベンダー構成、稼働中）の`/opt/vpngwgui/install/install.sh`・`install/tests/run.sh`・`docker-compose.yml`のみをPhase19版へ`scp`で差し替え、以下を実施した。

1. `install/tests/run.sh`（root不要な範囲）を実行。
2. `sudo sh install/install.sh --providers adguardvpn,protonvpn`（`--web-port`省略）を実行し、ポート80でWeb UIへアクセスできること、ポート8080では応答しないことを確認。
3. `sudo sh install/install.sh --providers adguardvpn,protonvpn --web-port 8080`を実行し、ポート8080でアクセスできることを確認。
4. `sudo sh install/install.sh --providers adguardvpn,protonvpn`（`--web-port`省略で再実行）を実行し、直前に指定した8080が維持されることを確認。

## 検証結果（2026-09-22、検証環境で確認）

- `install/tests/run.sh`: FAIL 0（32項目PASS）。
- 手順2: `curl http://127.0.0.1:80/api/v1/providers`が200で応答、`curl http://127.0.0.1:8080/...`は接続失敗（`Couldn't connect to server`）。完了表示も`Web UI: http://192.168.3.240:80`。
- 手順3: `--web-port 8080`指定で`curl http://127.0.0.1:8080/api/v1/providers`が200で応答。完了表示も`:8080`。
- 手順4: `--web-port`省略の再実行後も、完了表示・`curl http://127.0.0.1:8080/...`の応答がともに8080のまま（直前の設定を維持）。
- 検証を通じてAdGuard VPNのログイン状態（`active: true`）は変化なし（ポート変更のみでボリュームは触れないため）。
- 検証終了時: `.env`のWEB_PORTは8080（検証環境の従来の運用ポートに復元済み）、`VPN_PROVIDERS=adguardvpn,protonvpn`のまま。
