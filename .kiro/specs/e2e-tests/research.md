# Research & Design Decisions

## Summary
- **Feature**: `e2e-tests`
- **Discovery Scope**: Complex Integration（実ホストのインストーラ、ネットワーク名前空間を使ったゲートウェイ検証、実ブラウザ、ベンダー CLI の模擬を含む）
- **Key Findings**:
  - GitHub-hosted runner（ubuntu-latest）で、netns・NET_ADMIN・nftables・`network_mode: host` のコンテナ・Playwright 1.63.0 の chromium が動くことを PoC で確認済み（ブランチ `poc/hosted-runner-netns`、run 41273196695）。実行環境は Ubuntu 26.04.1・カーネル 7.0 だった。
  - トンネルの検出は「既定経路の出口インターフェースが LAN のインターフェースと異なるか」で行われる（`proxy/src/network/connection-monitor.ts`）。テスト配線は、本番と同じく LAN と WAN を同じ NIC（ブリッジ）にまとめる必要がある。
  - ベンダーのランナーは `proxy/src/runner.ts`（`dist/runner.js`）を実行し、CLI のバイナリは `RUNNER_ALLOWED_BINARY` で許可される。モックは、ランナー本体をそのまま使い、CLI のバイナリだけを差し替えられる。
  - 検証の出口 IP 確認（`egress-probe`）は、プロキシのコンテナ内で `curl` が https の URL を取得する。テスト用 CA を、プロキシの信頼ストアに入れる必要がある。

## Research Log

### インストーラの非対話実行
- **Context**: E2E の lifecycle グループで、実ホストへ導入・更新・削除する方法を決める。
- **Sources Consulted**: `installer/main.sh`（`install`・`update`・`uninstall`・`status`、`--repo-url`・`--commit`・`--ref`・`--purge`）、`installer/setup.sh`（`--providers`・`--web-port`・`--lan-iface`・`--no-start`）、`installer/build-bootstrap.sh`。
- **Findings**:
  - `install.sh` は `build-bootstrap.sh <ref> <commit> <repo-url>` で生成する。`cmd_apply` は `REPO_URL` を `git fetch --depth 1` で取得し、`COMMIT` へ checkout する。
  - `file://` の URL を指定すると、ローカルのチェックアウトを取得元にできる。
  - `--no-start` を付けると、compose の起動を遅らせられる。E2E では、テスト用の上書きを `.env` の `COMPOSE_FILE` へ追記してから起動する。
  - `uninstall --purge` は、`CONF_DIR`・`DATA_DIR`・`STATE_DIR` を削除し、取得先の `DIR` も削除する。
- **Implications**: lifecycle テストは、ローカルのチェックアウトを取得元にして実ホストで install・update・uninstall を行う。ビルドで外部へ出るのは、ベースイメージと npm・apt の取得だけになる。

### 導入経路の PoC（hosted runner）
- **Context**: systemd の単位と、本番の導入経路（install.sh）が hosted runner で動くかを確認する。
- **Result**（ブランチ `poc/hosted-runner-installer`、run 41278083962、全項目 PASS）:
  - `systemctl enable --now` で単位が有効化できる。docker は稼働している。ただし `systemctl is-system-running` は `degraded` を返した（原因は未調査）。
  - `sudo sh install.sh install --set PROVIDERS=adguardvpn --set LAN_IFACE=eth0 --set WEB_PORT=18080` は 78 秒で完了。4 コンテナ（api・proxy・runner-adguardvpn・web）が起動した。
  - 導入後、`vpngwgui-boot-guard.service` が有効、`vpngwgui-reboot.path` が稼働中。Web UI は HTTPS で 200。
  - `uninstall --purge` で、単位・`/etc/vpngwgui`・`/var/lib/vpngwgui`・`/opt/vpngwgui` が消えた。
  - `GET /v1/session` は未ログインでも 200 を返した（保護された API の例には使えない）。保護された API の例は `POST /v1/gateway/reboot`（401 を定義）等を使う。
- **Implications**: `install` は起動まで行うため、E2E は起動後に止めてから、テスト用の上書きで起動し直す。`reboot.path` は稼働中のため、再起動テストでは停止が必要（設計の R7）。

### 単一 NIC 構成の再現
- **Context**: `connection-monitor.ts` は、既定経路の出口 IF が LAN IF と異なると VPN IF とみなす。LAN と WAN を別 NIC にすると、未接続時も WAN の IF が VPN と誤判定される。
- **Findings**: 本番の単一 NIC 構成では、LAN IF・WAN IF・既定経路の IF が同じになる（`WAN_IFACE` の既定は `LAN_IFACE`）。テストでも、LAN 側のクライアント・上位ルータ（isp）・VPN 出口を、同じ Linux ブリッジ（`e2eseg`）へ接続する。
- **Implications**: `LAN_IFACE` と `WAN_IFACE` は `e2eseg` になる。VPN 接続時は既定経路が `vpn0` へ移り、検出が正しく動く。

### VPN CLI の模擬
- **Context**: 実アカウントは使えない。ベンダーの CLI は、ランナーのバイナリ許可（`RUNNER_ALLOWED_BINARY`）に従い、プロファイルの `binary` のパスで実行される。
- **Findings**:
  - `vendors/protonvpn/profile.json` と `vendors/adguardvpn/profile.json` は、argv・出力パターン（`connectedPattern`・`locationPattern`・`successPattern`・`notLoggedInPattern`・`restrictedPattern`）を定義している。
  - `vendors/*/samples.json` は、実 CLI の出力サンプル（ケース単位）を持つ。モックの出力は、このサンプルと突き合わせて検証できる。
  - 本番のランナーは D-Bus・NetworkManager・keyring を起動する。モックでは不要なので省く。
- **Implications**: モックは、argv とパターンの契約を満たす Node スクリプト 1 本で、両ベンダーの CLI 名で呼ばれる。接続時は、ホストの netns に `vpn0`（veth の片方）を作り、既定経路を `vpn0` へ移す。VPN 出口の netns（`vpnexit`）は、トポロジの起動時に用意する。

### プロキシの信頼ストアとテスト CA
- **Context**: 検証の出口 IP 確認は、プロキシのコンテナ内で `curl` が https の IP 確認 URL を取得する（`verifyEchoUrl` は https 必須）。
- **Findings**: `curl` は、環境変数だけでは CA を差し替えられない前提で扱う。テスト用 CA を、システムの信頼ストアへ入れる必要がある。
- **Implications**: E2E 専用の Dockerfile（`e2e/hosted/proxy/Dockerfile`）を、本番の proxy イメージの上に重ねる。このイメージは、テスト CA を `ca-certificates` へ追加する。本番のイメージは変えない。

### 実ブラウザ（Web UI）の TLS
- **Findings**: Web は `https` で 8080 を待ち受ける（`web/server/index.ts`）。ホスト側の公開ポートは 18080 にする（`docker-compose.e2e-mock.yml`）。ブラウザはテスト用の自己署名証明書を無視する設定にする。
- **Implications**: Playwright の `ignoreHTTPSErrors: true` を使う。

### 既存の E2E 資産の扱い
- **Findings**: HEAD の `e2e/`（55 ファイル）は作業ツリーで削除済み。ユーザー指示により、復元せず、現行の実装から作り直す。`docker-compose.e2e-mock.yml` は残っているが、参照先が無いため作り直す。
- **Implications**: 新しい `e2e/` は、旧ファイルを一切参照せずに書く。旧ファイルの内容は、設計の根拠にしない。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
| --- | --- | --- | --- | --- |
| A. 実ホスト＋netns（採用） | 本番と同じインストーラで導入し、netns で LAN・ISP・VPN 出口を模擬する | 本番のコードとネットワーク経路をそのまま検証できる | ホストのルートを変更する。runner 上の作業と衝突しないよう後始末が必要 | 要件 5〜7 の挙動を LAN クライアントの通信で確認できる |
| B. コンテナのみで模擬 | ゲートウェイ・LAN クライアントを全てコンテナで構成する | ホストを汚さない | LAN クライアントの経路と単一 NIC の再現が難しい。`network_mode: host` のゲートウェイとの整合が取りにくい | 不採用 |
| C. LXC（従来方式） | LXD のコンテナで LAN・ゲートウェイを作る | 従来の資産がある | 公開リポジトリ・共用の検証サーバの制約で、hosted runner では使えない | ユーザー判断で不採用 |

## Design Decisions

### Decision: 単一ブリッジで LAN・ISP・VPN 出口を接続する
- **Context**: 要件 5 の遮断・フェイルオープン・迂回の判定は、既定経路の IF が LAN IF と同じかどうかに依存する。
- **Alternatives Considered**:
  1. LAN と WAN を別の veth にする — 未接続時に WAN IF が VPN IF と誤判定される。
  2. 単一ブリッジ `e2eseg` に全てを接続する — 本番の単一 NIC と同じ判定になる。
- **Selected Approach**: 2。ブリッジ `e2eseg` に、LAN クライアント（netns `lan`）・ISP（netns `isp`、ルータ兼サービス）・VPN 出口（netns `vpnexit`）を接続する。ホストは `e2eseg` に IP を持つ。
- **Rationale**: 本番の判定ロジックを変えずに検証できる。
- **Trade-offs**: 実際のインターネットには出ない。ISP は模擬の応答器で、外部の到達性は検証しない。
- **Follow-up**: 実装時に、既定経路が `vpn0` へ移ったときに `isp`（192.168.50.254）への経路が直接のまま残ることを確認する。

### Decision: モックは本番のランナー本体の上で CLI だけを差し替える
- **Selected Approach**: `e2e/hosted/vendors/<id>/Dockerfile` は、本番と同じ `proxy` のビルド成果（`dist/runner.js`）を使い、CLI のバイナリだけをモックにする。D-Bus・NetworkManager は起動しない。
- **Rationale**: ランナーの許可・実行・ソケットの契約は本番と同じになる。検証対象はランナー本体とプロキシ・API になる。
- **Trade-offs**: CLI の出力はモックが再現する。CLI の実装の不具合は検出できない。`samples.json` との突き合わせで、出力の差を抑える。

### Decision: テストは Playwright Test でまとめる（ブラウザ・API・netns 操作）
- **Selected Approach**: `@playwright/test` 1.63.0 を、リポジトリの devDependencies に固定する。UI は実ブラウザ、API は `request` フィクスチャ、LAN の操作は `lan.ts` のヘルパ（`ip netns exec lan ...`）で行う。
- **Rationale**: 1 つのランナーで、結果の一覧（要件 1.1）、失敗時のスクリーンショットとトレース（要件 1.5）、JSON レポートを揃えて出せる。
- **Trade-offs**: テスト間の状態が共有されるため、ワーカーは 1 に固定する。

### Decision: グループ単位で初期化し、グループ間で状態を引き継がない
- **Selected Approach**: `e2e/hosted/run.sh` が、`lifecycle` → `stack` → `gateway` の順にグループを実行する。各グループの前に、netns・compose・インストール済みの状態を全て消す。
- **Rationale**: 要件 1.2 を満たす。失敗しても次のグループは実行する（要件 1.4 の集約のため）。

## Risks & Mitigations
- **R1: systemd の単位がランナーで動くか未確認** — インストーラは、`vpngwgui-boot-guard`・`vpngwgui-reboot.path/.service` を有効化する。実装の最初の段階で、hosted runner で `systemctl enable --now` が成功するかを確認する。
- **R2: 実行時間の上限** — 3 グループで、インストールと起動を 3 回行う。イメージのビルドは Docker のレイヤーキャッシュで 2 回目以降を短くする。目標の上限は未決定（design の Open Questions）。
- **R3: モック CLI の忠実度** — 出力は `samples.json` と突き合わせる。モックで再現できない挙動（実アカウントの仕様変更など）は、テストの対象外とする。
- **R4: ホストのルート変更** — 既定経路を ISP へ向ける。後始末（`always()` の破棄）で元へ戻す。runner の成果物のアップロードは、破棄の後に行う。
- **R5: テスト CA の信頼ストア** — 本番のイメージを変えないため、E2E 専用の層で追加する。ベースの変更で層が壊れないかを、ビルド時に検査する。
- **R6: runner の Ubuntu 版の変化** — 今回の PoC は 26.04 だった。ubuntu-latest の版が変わると、ホストの nftables や systemd の挙動が変わりうる。

## References
- `.github/workflows/installer-check.yml` — 既存の CI の前提（PLAYWRIGHT_VERSION 1.63.0）
- `vendors/protonvpn/`・`vendors/adguardvpn/` — ベンダーバンドル（プロファイル・ランナーのイメージ・出力サンプル）
- `proxy/src/network/connection-monitor.ts`・`proxy/src/network/ruleset.ts` — トンネル検出と、ゲートウェイの nftables の構成
- PoC: ブランチ `poc/hosted-runner-netns`、run 41273196695
