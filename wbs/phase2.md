# Phase 2: 実VPNベンダーCLI統合・ログイン代行

> 全体整合性の再評価により、当初計画（実VPNベンダーCLI統合は旧phase4）を前倒しした版である。詳細はwbs/README.md「フェーズ分割の考え方」参照。

## 目的

Phase1で構築したコマンド実行パイプライン（プレースホルダー検証→UDS送信→execFile実行）を、モックCLIから実際のVPNベンダーCLI（例: AdguardVPN CLI）に置き換え、実CLIの接続・切断・状態取得・ログイン代行を動作確認できる状態にする。

`network_mode: host`への移行、透過ゲートウェイ、Kill Switch、明示的プロキシは本フェーズでは扱わず、プロキシコンテナ自身がVPNトンネルを確立・利用できることの確認に留める。これにより、「モックの決定的な状態遷移でロジックを先に検証してから実CLIに対応する」のではなく、実運用に近い実CLIの非決定的な挙動（ログイン、接続試行、レート制限等）に早期から向き合い、後続のネットワーク制御ロジック（phase3.md／phase4.md）の検証も、モックではなく実際のVPN接続状態を用いて行えるようにする。

## 前提

- Phase1完了（web/api/proxyのUDS経由コマンド実行パイプラインがモックCLIで検証済み）。
- 対象VPNベンダー（AdguardVPN等）の契約・CLIバイナリが利用可能であること。

## スコープ外

| 項目 | 理由・先送り先 |
|---|---|
| `network_mode: host` | LAN機器へのゲートウェイ提供に必要だが、実CLI自体（コンテナ自身の通信）の動作確認には不要。→ phase3.md |
| 透過ゲートウェイ・Kill Switch実処理 | ホストのネットワーク名前空間共有が前提。→ phase3.md |
| 明示的プロキシモード（3proxy） | ホストのLAN側インターフェースへの直接bindが前提（`network_mode: host`必須）。→ phase4.md |
| インストールスクリプト | ホストの永続変更はphase3.mdのネットワーク基盤移行と合わせて実施。 |

## 主要タスク

### Step 0: specs更新
- [ ] `specs/apiserver/design.md`「Phase 1における具体プロファイル」節の「Phase 4で実CLI統合時に」等の記述を「Phase 2で」に更新する。
- [ ] `specs/proxyserver/design.md`「Phase 1における縮小構成」表にPhase 2の列（実CLI・NET_ADMIN/tun付与・ネットワークはブリッジのまま）を追加する。
- [ ] `specs/proxyserver/tasks.md`に「実VPNベンダーCLI統合・ログイン代行 (Phase 2)」節を追加する。
- [ ] `specs/apiserver/tasks.md`の`POST /v1/session`項目の参照先を`wbs/phase2.md`に更新する。

### Step 1: proxy — 実CLI同梱・権限付与
- [ ] 実VPNベンダーCLIバイナリをproxyイメージに同梱（Dockerfile更新）。
- [ ] `docker-compose.yml`のproxyサービスに`cap_add: [NET_ADMIN]`、`devices: ["/dev/net/tun:/dev/net/tun"]`を追加する（`networks: [app-net]`はこの時点では維持し、`network_mode: host`への変更はphase3.mdで行う）。
- [ ] 実行可能バイナリ許可リスト（`proxy/src/allowlist.ts`）をモックCLIパスから実CLIパスに置換する。

### Step 2: api — プロファイル・パーサー差し替え
- [ ] `api/config/vpn-profile.json`を実ベンダーの実argv体系に置き換える（Phase1のモック用argv・エラー注入用国コード`"zz"`を実際のコマンド体系・国コード一覧に更新）。
- [ ] stdout/stderrパーサーの差し替え: `outputFormat`に実CLI用の値（例: `"text"`）を追加し、対応するパーサーを`api/src/profile/`に実装する（Phase1で見越して分離済みの、vendor非依存のレスポンス整形層とモック専用パーサーの分離構成を活かす）。
- [ ] `POST /v1/session`実装（`login`アクション解決→実行→stdoutからログインURL等を抽出）。
- [ ] 実CLIの非決定的挙動（ネットワーク遅延、認証エラー、レート制限等）に対するタイムアウト・リトライ方針の見直し。

## 完了基準（動作確認シナリオ）

```bash
docker compose build
docker compose up -d

# 実CLI経由での状態取得
curl -s http://localhost:8080/api/v1/connection/countries
curl -s http://localhost:8080/api/v1/connection                  # → {"status":"disconnected"}

# ログイン未実施状態からのログイン代行
curl -s -X POST http://localhost:8080/api/v1/session             # → ログインURL等を含むレスポンス
# （表示されたURLで実際にログインを完了させる）

# 実CLI経由での接続・切断
curl -s -X PUT http://localhost:8080/api/v1/connection -H 'Content-Type: application/json' -d '{"connect":true,"country":"jp"}'
curl -s http://localhost:8080/api/v1/connection                  # → 実際の接続状態を反映

# コンテナ自身の通信が実際にVPNトンネル経由になっていることを確認
docker compose exec proxy sh -c 'ip route show default'
docker compose exec proxy sh -c 'curl -s https://<接続元IP確認用エンドポイント>/'   # 接続先国に応じたIPになることを確認

curl -s -X PUT http://localhost:8080/api/v1/connection -H 'Content-Type: application/json' -d '{"connect":false}'
```

- Web UIから実際にVPN接続・切断・国変更ができ、`GET /v1/connection`が実際の接続状態を反映することを確認する。
- 実CLIの認証エラー・接続失敗等が`422`として、タイムアウトが`504`としてAPI経由で正しくハンドリングされることを確認する。

## 次フェーズへの申し送り

- （Phase1完了後に実装しながら追記する）
