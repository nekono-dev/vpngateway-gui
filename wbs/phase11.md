# Phase 11: Web UIからのベンダー選択（ネットワーク制御とCLI実行の分離）

**【2026-09-21追加】実施順は Phase 9 の直後・Phase 10 の前（`1 → 2 → 3 → 5 → 8 → 4 → 9 → 11 → 10 → 6 → 7`）。** Phase 10（Proton VPN対応）の設計中に、利用者から「Web UI上から使うベンダーを選択できるようにしたい」という要望があり、Phase 10の前提（ベンダーごとに別のproxyコンテナを起動する構成）を見直す必要が生じたため、Proton VPN実CLIの導入（Phase 10）より先に、複数ベンダーを扱える構成へ改める。フェーズ番号は識別子であり実施順ではない（`README.md`参照）。

## 目的

管理者が有効化した複数のVPNベンダーから、Web UI利用者が使うベンダーを選べるようにする。そのために、従来1つのコンテナに同居していた「ネットワーク制御」と「ベンダーCLIの実行」を分離し、ベンダーごとの実行環境（ランナー）を並存させる。

設計は`specs/requirements.md`「VPNベンダーの選択（Web UI）」、`specs/design.md`「ベンダーの選択と実行基盤」、`specs/apiserver/design.md`「ベンダーの選択」、`specs/proxyserver/design.md`「コンテナ構成（Phase 11）」と`specs/runner/`、`specs/webserver/design.md`「ベンダーの選択の実装方針」。

## 前提

- Phase 9完了（プロバイダ抽象化基盤・モックプロバイダCLI）。
- 実VPN（AdGuard VPN CLI、ログイン済み・PREMIUM）を持つ実機検証環境（`GW_MODE=ssh`）が使えること。**Proton VPN実CLIはこのフェーズでは使わない**（Phase 10）。2つ目のベンダーには、Phase 9のモックプロバイダCLI（Proton VPN公式CLIの挙動を模擬）を、専用のモックランナーで使う。

## スコープ外

- Proton VPN実CLIのランナー（イメージ・PoC・実機検証）（Phase 10）。
- 複数ベンダーの同時接続（接続は常に1ベンダー。要求されれば別課題）。
- ベンダーごとに異なるユーザ向け設定（Kill Switch等は全ベンダー共通の1つ）。
- 認証・利用者別の選択（現状LAN限定・認証なしのため、選択は利用者全員で共有される）。

## 決定事項（利用者への確認結果、2026-09-21）

| 項目 | 決定 |
|---|---|
| 同時接続 | 接続は常に1ベンダーのみ（切替式） |
| コンテナ構成 | ネットワーク制御（`proxy`）とCLI実行（`runner-<ベンダー>`）を分離 |
| 接続中の切替 | 確認のうえ、現在のVPNを自動で切断してから切り替える |
| 選択肢の範囲 | 管理者が用意・有効化したプロファイルのみ |

## 設計上の判断（本文書の作成時、利用者への確認なしに決めた点。誤りがあれば指摘を受けて改訂する）

- 選択は**サーバ側に永続化**し全ブラウザで共通にする（認証がなくLAN限定のため）。
- ランナーが停止しているベンダーは選択肢に出すが選択不可とし、選択中のベンダーのランナーが後から止まっても**自動で他のベンダーへ切り替えない**（意図しないベンダーへの接続を避ける）。
- 切替時に現在のランナーが応答しない場合は、切断できないが切替は許可する（止まったランナーに縛られない）。切断コマンドが失敗した場合は切り替えない。
- ベンダー別の状態（ログイン状態・プラン・お気に入り・最後の接続先・接続先）は独立に保持し、切替で失わない。ユーザ向け設定（Kill Switch等）はベンダー共通。
- 有効化は`.env`の`VPN_PROVIDERS`（`install/select-providers.sh`で書く）。既定は`adguardvpn`のみ（Phase 10までの構成と同じ動作）。

## 主要タスク

### 設計・仕様（実装前）
- [x] 要件定義・設計・タスク一覧の作成（`specs/`各ファイル、本ファイル）。`wbs/phase10.md`をランナー構成へ改訂。

### proxy・runner（ネットワークコンテナ: `specs/proxyserver/tasks.md`「ネットワークコンテナとランナーの分離」、ランナー: `specs/runner/tasks.md`「ランナーの分離」。**ランナーは別アプリケーションとして`specs/runner/`に要件・設計・タスクを切り出した**）
- [x] ランナー（`runner.ts`）とネットワークコンテナ（`server.ts`）の分離、`POST /connection-checks`、`RUNNER_ALLOWED_BINARY`（`EXTRA_ALLOWED_BINARIES`の廃止）。
- [x] イメージ: `proxy/Dockerfile`（ネットワーク）・`Dockerfile.runner-adguardvpn`・`Dockerfile.runner-mock`（E2E専用）。
- [x] `docker-compose.yml`の再構成、`install/select-providers.sh`、`docker-compose.e2e-mock.yml`の改修。`docker-compose.protonvpn.yml`・`VPN_PROVIDER`・`proxy/Dockerfile.protonvpn`（Phase 10の作業中ファイル）の扱いの整理。

### api（`specs/apiserver/tasks.md`「ベンダーの選択」）
- [x] 複数プロファイルの読み込み、選択の永続化、ベンダー別の状態（旧形式からの移行）。
- [x] `proxy-client`のランナー宛・ネットワークコンテナ宛の分離と`GET /health`。
- [x] `GET /v1/providers`・`PUT /v1/providers/active`（切替の手順・直列化）。
- [x] `POST /connection-checks`の通知、監査ログの`provider`。
- [x] 既存ルートの選択中ベンダー対象への改修、単体・統合テスト。

### web（`specs/webserver/tasks.md`「ベンダーの選択」）
- [x] orval再生成、`ProviderSelector`、切替時の状態の入れ替え、ベンダー名の表示、コンポーネントテスト。

### 検証
- [x] モックE2E（`e2e/phase11/`）: AdGuard（実VPN）＋モックプロバイダの2ベンダーで、選択部品の表示・切替・接続中の確認と自動切断・状態の入れ替え・利用不可ランナーの無効化・別ブラウザでの共有・ベンダー別状態の独立を確認。
- [x] 実VPN（AdGuard VPN）でのリグレッション（ネットワーク分離後の`e2e/phase3`・`phase4`・`phase8`。透過ゲートウェイ・Kill Switch・明示的プロキシ・接続先リスト）。

## 完了基準

- 有効なベンダーが2つ（AdGuard VPN実CLI＋モックプロバイダ）のとき、Web UIにベンダー選択部品が表示され、選択したベンダーの接続先・ログイン状態・プラン・操作の実行可否に画面が入れ替わること。有効なベンダーが1つのときは選択部品が出ず、従来の画面・操作と同じであること。
- AdGuard VPNに接続中にモックプロバイダへ切り替えると確認ダイアログが出て、承諾すると実VPNが切断され（トンネルが消え、Kill Switch ONならLAN端末の通信が遮断される）、新ベンダーが選択中になること。拒否すると何も変わらないこと。切断に失敗した場合は元のベンダーのままで、原因が通知されること。
- ベンダーを切り替えて戻しても、各ベンダーのログイン状態・お気に入り・「前回」の接続先が保持されていること。
- 選択が再読み込み・別ブラウザでも共通であること。
- ランナーを停止したベンダーが「利用不可」と理由付きで無効になり、選択できないこと。
- 実VPNで、ネットワーク分離後も、透過ゲートウェイ・Kill Switch（切断・瞬断・ホスト再起動）・明示的プロキシ・接続先リスト・ログインが従来どおり動作すること（Phase 3・4・8のE2Eがリグレッションなく通る）。
- ネットワークコンテナ（`proxy`）にベンダーCLIのバイナリが含まれないこと、各ランナーが自ベンダーのバイナリ以外を`403`で拒否すること。

## 検証手法

- **単体・統合テスト**: `npm test`（proxy 101件・api 214件・web 92件）。APIの統合テストは2ベンダー（AdGuard VPN・モックProton）で、切替（接続中の自動切断・切断失敗の中止・ランナー利用不可の`502`・切替中の`409`・ベンダー別状態の独立）を検証する。
- **モックE2E（開発ホストのdocker compose。実VPN不要）**: `bash e2e/phase11/provider-scenarios.sh`（27項目）。AdGuard VPN（ランナー同梱・未ログイン）とモックProton VPNの2ベンダーで、選択部品・切替・確認ダイアログ・別ブラウザでの共有・ベンダー別ログイン状態・ランナーの許可バイナリ（`403`）・ネットワークコンテナへのCLI非同梱・利用不可を確認。Phase 9の`bash e2e/phase9/mock-scenarios.sh`（36項目）も新構成（ランナー`runner-mock`）で通る。
- **実VPN（AdGuard VPN・実LAN）**（検証環境`GW_MODE=ssh`。`e2e/lxc/sync.sh`で展開）:
  - `bash e2e/phase11/real-switch-scenarios.sh`（10項目）: 実VPN接続中にモックへ切り替え → 実VPN切断・トンネル消滅・Kill Switch ONでLAN端末遮断 → 切り戻して再接続でVPN経由。
  - リグレッション: `e2e/phase8/locations-scenarios.sh`（46項目）、`e2e/phase3/gateway-scenarios.sh A B C D E F`（C・D・Eは修正後の再実行で47項目PASS。A・B・Fは初回で通過）、`e2e/phase4/proxy-scenarios.sh`（A〜H・G。D修正後の再実行含む。全項目PASS）。

## 次フェーズへの申し送り

- （検証結果の要約）2026-09-21、上記の全ての完了基準を、モックE2E（27項目）・実VPN切替E2E（10項目）・実VPNリグレッション（phase8 46項目、phase3 C/D/E 47項目＋A/B/F、phase4 全項目）で確認した。**未実施: phase3のG（上流断）・H（ホスト再起動）**（ネットワークコンテナ・ランナーの`restart: always`は変更していないが、ランナー分離後の再実測はしていない）。
- （実装中に判明した点）(1)旧形式の状態ファイルの移行は実機で確認済み（ログイン・お気に入り・「前回」が保持された）。(2)ランナーがVPNデーモンを持つため、Phase 3のシナリオD1（VPNデーモン消滅＋proxy再起動）は`proxy`と`runner-adguardvpn`の両方の再起動で再現する形へ改めた。(3)読み取り専用のバインドマウントの中へ単一ファイルを重ねられないため、モックランナーを使うE2Eはプロファイルを集めたディレクトリを`E2E_PROFILES_DIR`で渡す（`e2e/lib/e2e-profiles.sh`）。(4)`docker compose logs`が大きくなり、ログ全体をコマンドライン引数へ渡すE2Eが`Argument list too long`で失敗した（ファイル経由に修正）。(5)検証環境ではAdGuard VPNのjp（Tokyo）の出口IPが、LANの直接の出口IP（156.146.34.246）と一致する（tcpdumpでトンネル経由を確認）ため、「出口IPが直接と異なる」ことを見るE2E（phase3・phase4）は既定でus-las-vegasを使うよう改めた（`VPN_COUNTRY`）。(6)`e2e/phase3/webgui-connection.mjs`がPhase 8で廃止された「接続国」セレクトを前提にしたまま壊れていたため、接続先リストから選ぶ形へ改めた（phase3のC・D・Eの失敗の一因）。(7)コンテナ再作成直後の初回の実接続が原因不明で1回失敗した（`connect -l Shanghai`が終了コード13。再現せず。phase8にも同様の「原因不明のFAIL」の記録がある）。
- （既知の限界）選択中でないベンダーの実VPN接続がAPIの管理外で残っている場合（例: API外でCLIを直接操作した）は、切替時に検出・切断しない（選択中のベンダーの`status`だけを見る）。
- Phase 10（Proton VPN）は、本フェーズのランナー構成の上に`runner-protonvpn`を追加する形で行う（`wbs/phase10.md`。`proxy/docker-entrypoint.protonvpn.sh`・`networkmanager-vpngwgui.conf`・`api/config/profiles/protonvpn.json`は下書き）。
