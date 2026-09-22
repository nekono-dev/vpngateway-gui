# Phase 2: 実VPNベンダーCLI統合・ログイン代行

> 全体整合性の再評価により、当初計画（実VPNベンダーCLI統合は旧phase6）を前倒しした版である。詳細はwbs/README.md「フェーズ分割の考え方」参照。

## 目的

Phase1で構築したコマンド実行パイプライン（プレースホルダー検証→UDS送信→execFile実行）を、モックCLIから実際のVPNベンダーCLI（例: AdguardVPN CLI）に置き換え、実CLIの接続・切断・状態取得・ログイン代行を動作確認できる状態にする。

`network_mode: host`への移行、透過ゲートウェイ、Kill Switch、明示的プロキシは本フェーズでは扱わず、プロキシコンテナ自身がVPNトンネルを確立・利用できることの確認に留める。これにより、「モックの決定的な状態遷移でロジックを先に検証してから実CLIに対応する」のではなく、実運用に近い実CLIの非決定的な挙動（ログイン、接続試行、レート制限等）に早期から向き合い、後続のネットワーク制御ロジック（phase3.md／phase6.md）の検証も、モックではなく実際のVPN接続状態を用いて行えるようにする。

## 前提

- Phase1完了（web/api/proxyのUDS経由コマンド実行パイプラインがモックCLIで検証済み）。
- 対象VPNベンダー（AdguardVPN等）の契約・CLIバイナリが利用可能であること。

## スコープ外

| 項目 | 理由・先送り先 |
|---|---|
| `network_mode: host` | LAN機器へのゲートウェイ提供に必要だが、実CLI自体（コンテナ自身の通信）の動作確認には不要。→ phase3.md |
| 透過ゲートウェイ・Kill Switch実処理 | ホストのネットワーク名前空間共有が前提。→ phase3.md |
| 明示的プロキシモード（3proxy） | ホストのLAN側インターフェースへの直接bindが前提（`network_mode: host`必須）。→ phase6.md |
| インストールスクリプト | ホストの永続変更はphase3.mdのネットワーク基盤移行と合わせて実施。 |

## 主要タスク

### Step 0: specs更新
- [x] `specs/apiserver/design.md`「Phase 1における具体プロファイル」節の「Phase 6で実CLI統合時に」等の記述を「Phase 2で」に更新する。
- [x] `specs/proxyserver/design.md`「Phase 1における縮小構成」表にPhase 2の列（実CLI・NET_ADMIN/tun付与・ネットワークはブリッジのまま）を追加する。
- [x] `specs/proxyserver/tasks.md`に「実VPNベンダーCLI統合・ログイン代行 (Phase 2)」節を追加する。
- [x] `specs/apiserver/tasks.md`の`POST /v1/session`項目の参照先を`wbs/phase2.md`に更新する。

### Step 1: proxy — 実CLI同梱・権限付与
- [x] 実VPNベンダーCLIバイナリをproxyイメージに同梱（Dockerfile更新）。公式GitHub Releasesからビルド時に取得する方式とし、バージョンを`ADGUARDVPN_CLI_VERSION`（v1.7.12）で固定した。
- [x] `docker-compose.yml`のproxyサービスに`cap_add: [NET_ADMIN]`、`devices: ["/dev/net/tun:/dev/net/tun"]`を追加する（`networks: [app-net]`はこの時点では維持し、`network_mode: host`への変更はphase3.mdで行う）。あわせて`init: true`（実CLIがforkするバックグラウンドプロセスのゾンビ化対策）と、ログイン情報永続化用の`adguard-data`ボリュームを追加した。
- [x] 実行可能バイナリ許可リスト（`proxy/src/allowlist.ts`）をモックCLIパスから実CLIパスに置換する。

### Step 2: api — プロファイル・パーサー差し替え
- [x] `api/config/vpn-profile.json`を実ベンダーの実argv体系に置き換える（Phase1のモック用argv・エラー注入用国コード`"zz"`を実際のコマンド体系・国コード一覧に更新）。国コード一覧は、実機にログインした状態の`adguardvpn-cli list-locations`出力から取得した実在の62コードを採用した（2026-09-06時点）。
- [x] stdout/stderrパーサーの差し替え: `outputFormat`に実CLI用の値`"text"`を追加し、対応するパーサー（`parseTextOutput`）を`api/src/profile/response-parser.ts`に実装した。
- [x] `POST /v1/session`実装（`login`アクション解決→実行→stdoutからログインURL等を抽出）。実CLIの`login`はブラウザ認証完了まで数分〜最大約30分プロセスが終了しないため、内部プロトコルに`completionPattern`（早期応答・バックグラウンド継続実行）を追加する設計変更を伴った。詳細はapiserver/design.md「Phase 2における具体プロファイル」・proxyserver/design.md「内部コマンド受信サーバの仕様」参照。
- [x] 実CLIの非決定的挙動に対するタイムアウト・リトライ方針の見直し: `login`を上記の`completionPattern`方式に変更したことで対応した。`connect`のタイムアウトはモック時の15000msから30000msへ拡大（実ネットワーク越しの接続確立を考慮）。自動リトライは範囲外のままとした（要件上の必然性が確認できていないため。次フェーズへの申し送り参照）。

### Step 3: web — 簡易ログインUIの前倒し実装

`POST /v1/session`実装により、Web UIからログイン未実施状態を解消する手段が無いまま`GET /v1/connection`が422を返し続ける状態が判明した（本来Phase 4でWeb UIをまとめて実装する計画だったが、それまで接続状態の確認自体ができない）。影響範囲を検討した上で、ログイン代行UIのみをPhase 2に前倒しすることとした（設定ダイアログ・接続ログ・トースト表示等、他のWeb UI要素はPhase 4のまま）。判断根拠・影響は`specs/webserver/requirements.md`「画面構成」・`wbs/phase4.md`「次フェーズへの申し送り」参照。

- [x] ダッシュボードに「VPNベンダーへログイン」ボタンを追加（`web/src/components/dashboard/VpnLoginButton.tsx`）。`POST /v1/session`を呼び出し、返却された`loginUrl`（あれば）・`message`を表示する。ログイン完了後の状態反映は既存の接続状態ポーリング（5秒間隔）に委ね、待機処理は実装しない。
- [x] 実機（ログイン済みの実CLI）に対する動作確認: proxy/api/webをnodeプロセスとして起動し、ヘッドレスChromiumで実際にボタンをクリックし、`POST /v1/session`のレスポンス（「You are already logged in...」メッセージ）が画面に表示されることを確認した。
- [x] 実機（未ログイン状態からの実CLI）に対する動作確認: `docker compose`で構築したweb/api/proxy経由で、未ログイン→ログインボタン→URL表示→ブラウザ認証完了→ポーリングによる状態反映までの一連をPlaywright・実アカウントで確認した（2026-09-14、詳細は下記「次フェーズへの申し送り」参照）。

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
- Web UIの「VPNベンダーへログイン」ボタンから実際にログインURLが表示され、ブラウザで認証を完了すると、ポーリングにより`GET /v1/connection`のエラー表示が接続状態表示に切り替わることを確認する。

## 次フェーズへの申し送り

- **【発見・修正済み】`connect`実行時にAPIが常に422（コマンド失敗、exitCode 13）を返す不具合があった。** 実機での動作確認で発覚。原因は`adguardvpn-cli`が非rootユーザー実行時にTUNインターフェース設定（`ip link`等）で内部的に`sudo`を要求する実装になっており（`cap_add: NET_ADMIN`を付与していても不要にならない）、proxyイメージに`sudo`コマンドが存在しなかったため`Can't find executable sudo`で失敗していた（`adguardvpn-cli`のログ`$HOME/.local/share/adguardvpn-cli/app.log`で判明）。`proxy/Dockerfile`に`sudo`パッケージを追加し、`vpngwgui`ユーザーへパスワードなしsudo（`NOPASSWD:ALL`）を付与して解決した。修正後、実機で`connect`（TOKYO/TUNモードで接続、`tun0`経由のルーティング確立）・`disconnect`とも正常動作を確認済み。
- **【発見・修正済み】`connect`実行時にAPIが常に504（プロキシタイムアウト）を返す不具合があった。** 実機（ユーザー環境）での動作確認で発覚。原因は`proxy/src/exec/command-runner.ts`の`runCommand`が`child_process.execFile`を使っており、その完了判定が内部的に子プロセスの`'close'`イベント（stdout/stderrパイプが完全に閉じるまで）を待つ実装だったため。実CLIの`connect`はバックグラウンドにVPNデーモン（孫プロセス）をforkして自身は先に終了するが、forkされたデーモンが標準出力/エラーのパイプを引き継いだまま存在し続けるため`'close'`が永久に発火せずハングしていた（`login`の`completionPattern`対応時に`runDetachableCommand`では`spawn`+`'exit'`イベントで正しく実装していたが、`runCommand`側への横展開が漏れていた）。`runCommand`も`spawn`+`'exit'`イベント方式に統一し、この種のバックグラウンドfork一般に対して堅牢にした。回帰テスト（孫プロセスがstdoutを保持したまま親が先に終了するケース）を`command-runner.test.ts`に追加済み。
- **【解消済み】`connect`成功時の実機接続確認。** 上記のsudo修正後、実機で以下を確認できた:
  - `connect`成功時・`status`（接続中）実行時の実際の標準出力文言による"connected"判定が正しく機能すること。
  - `-y`フラグにより対話的プロンプトが発生しないこと。
  - トンネル（`tun0`）経由でコンテナのルーティングが実際に切り替わること。
  - 【2026-09-14 追加検証で解消】完了基準記載の外部IP確認による実通信確認: `adguardvpn-cli connect -l jp -y`実行前後で外部IPを比較したところ、接続前は自ホストのIPだったのに対し、接続後は`156.146.34.246`（Tokyo, AS60068 Datacamp Limited＝AdGuard VPNのIP）に変化しており、実際にVPNトンネル経由で通信していることを確認した。`disconnect`後は接続前のIPに復帰することも確認済み。
  - なお、この検証環境では`adguardvpn-cli`本体プロセス（非rootユーザー実行）が内部的に対話端末経由の`sudo`パスワード入力を要求する構成だったため、`expect`を用いてパスワード入力を自動化して実行した。本番proxyイメージでは上記の`NOPASSWD:ALL`設定により本来この手当ては不要なはずであり、これは検証専用環境固有の制約であることに留意。
- **接続先国(country)をレスポンスに含められていない。** 実CLIのテキスト出力から接続先国を確実に抽出できる固定書式を実機で確認できなかったため、`ConnectionStatus.country`は常に`undefined`を返す（`ConnectionStatus.country`は元々optionalであるため型上は問題ない）。UIで接続先国を表示する場合は、PUT時にリクエストした`country`をクライアント側で保持するなどの回避策が必要になる可能性がある。Phase 4（Web UI完成）着手時に要検討。**→ 2026-09-21解決: クライアント保持は再読み込みで消えるため、APIサーバ側で永続化する方式とした（`specs/apiserver/design.md`「接続先国の永続化」、`wbs/phase4.md`「申し送り」）。**
- **`countries`一覧は経年劣化する。** `api/config/vpn-profile.json`の`countries`はある時点の`list-locations`のスナップショットであり、AdGuard側のサーバ増減で古くなる。管理者向けの定期更新手順（またはAPIサーバ起動時に`list-locations`を都度実行して動的に取得する設計への変更）を将来検討する。
- **`login`の同時多重実行は考慮していない。** `POST /v1/session`を短時間に複数回呼ぶと、実CLI側の多重ログイン試行の挙動（拒否されるか、新しいデバイスコードが発行されるか）は未検証。認証機構がない現状（apiserver/tasks.md「将来課題」参照）と合わせて、Phase 4以降で認証・レート制限を追加する際に併せて検討する。
- **自動リトライ方針は導入していない。** 実CLIの一時的なネットワーク遅延・レート制限に対する自動リトライの必要性は、実機での接続検証（上記）を経てから判断する方が確度が高いと判断し、今回は見送った。
- **【解消済み】ログインUIの主経路（未ログイン→URL表示→ブラウザで認証完了→状態反映）のweb/api/proxy経由E2E。** 2026-09-14、`docker compose`で構築した実機（web/api/proxyを全てコンテナとして起動）に対し、ヘッドレスChromium（Playwright）でWeb UIの「VPNベンダーへログイン」ボタンを実際にクリックし、`POST /v1/session`→proxy経由でデバイス認証URL（`https://auth.adguard.io/device_code?user_code=...`）が画面に正しく表示されることを確認した。表示されたURLでユーザーが実際にブラウザ認証を完了した後、`GET /v1/connection`が422エラーから`{"status":"disconnected"}`へ切り替わることを確認し、ポーリングによる状態反映の経路が機能することを確認した。あわせてWeb UIから国選択（jp）→接続→（ポーリングで「接続中」表示に切替）→切断→（「切断」表示に復帰）の一連の操作をPlaywrightで実施し、いずれも5秒ポーリング内に画面へ反映されることを確認した。タイムアウト（504）についても、`proxy`コンテナを`docker compose pause`で意図的に無応答にし、`GET /v1/connection`が`504 {"error":"proxy_timeout",...}`を返すことを実機で確認した（`specs/apiserver/tasks.md`の該当タスクもあわせて更新）。
- **【発見・修正済み】ログイン代行のバックグラウンドプロセスが認証完了後に停止しない不具合。** 上記検証中に発覚。`runDetachableCommand`（`proxy/src/exec/command-runner.ts`）で起動する`login`プロセスは、認証完了（デバイス認証URLのブラウザ承認）をサーバー側が受理した後も、`stdio: ["ignore", ...]`でstdinを閉じているため、CLI内部の確認入力待ち処理（`ConsoleIOImpl get_char: Failed to read from console`）が失敗し続け、プロセスが終了せずCPUを消費し続ける不具合を確認した（実機で2分半以上ビジーループを確認、`kill -9`で強制終了した）。幸い認証情報自体はサーバー側で先に確定しており、別途`login`や`status`等を実行すればログイン済み状態を検知できるため実害はログイン検知の遅延とCPU浪費に留まっていたが、放置すると`login`ボタンを押すたびにゾンビ化したビジーループプロセスが積み重なる問題があった。対応として、`runDetachableCommand`のstdinを`"ignore"`（即時EOF）から`"pipe"`（読み取りブロック、CPU消費なし）に変更し、あわせて`completionPattern`一致後もプロセスが自然終了しない場合に備えたバックグラウンド安全装置（`backgroundTimeoutMs`、デフォルト30分で強制`SIGKILL`、`onBackgroundExit`コールバックで監査ログに記録）を追加した。実機で再現・修正確認済み（修正後は`login`プロセスがCPUを消費せず、認証完了検知後に自然終了し`background_exec_completed`イベントが記録されることを確認）。回帰テストを`command-runner.test.ts`に追加済み。
- **【発見・修正済み】ログイン情報の永続化が実際には機能していなかった不具合。** `docker-compose.yml`は`adguard-data`ボリュームを`/home/vpngwgui/.local/share/adguardvpn-cli`にマウントし「ログイン情報の永続化」を意図していたが、実機でproxyコンテナを再作成すると、同ボリュームにログ・キャッシュ・暗号化設定ファイル（`adguardvpn-cli.conf`）が残っていたにもかかわらず「You are not logged in」となり再ログインが必要になる不具合を確認した。原因調査のため`adguardvpn-cli`バイナリを`strings`で解析したところ`/etc/machine-id`・`/var/lib/dbus/machine-id`への参照を発見したため、まずこれらをボリューム上に永続化したmachine-idから復元する`proxy/docker-entrypoint.sh`を追加したが、それだけでは再現し続けた。さらに調査したところ、原因はmachine-idではなく、**proxyコンテナがDockerブリッジネットワーク上でIPv6に到達できず、実CLIの起動時バックエンド疎通（IPv6/HTTP3、`app.log`に`Failed to set socket destination: Network unreachable`のエラーが記録されていた）が失敗すること**だった（ホスト自体は実際にIPv6接続性を持つが、Dockerのデフォルトブリッジネットワークがそれを透過していなかった）。`network_mode: host`（本来Phase3で予定していた変更）に切り替えたところ、複数回のコンテナ再作成にわたってログインが維持されることを実機で確認できたため、この部分のみPhase2へ前倒しした（`docker-compose.yml`・`specs/proxyserver/design.md`「Phase 1における縮小構成」参照）。透過ゲートウェイ・nftables・インストールスクリプト等、host化に付随する他のタスクはPhase3のまま変更していない。なお、machine-id永続化（`docker-entrypoint.sh`）自体は根本原因ではなかったが、実CLIが参照している値である以上、コンテナ再作成間で不必要に変動させない一般的な堅牢化として残した。
