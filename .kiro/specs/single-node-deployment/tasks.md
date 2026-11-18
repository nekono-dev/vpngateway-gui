# Implementation Plan

共有ファイルと単一の実機検証環境を順に使うため、タスクは逐次実行とし (P) は付けない。

## 1. 実装前提と対象範囲の確定
- [ ] 1. 実装前提と対象範囲を確定する
  - 1.1 の棚卸し成果物 `.kiro/specs/single-node-deployment/inventory.md` を、後続の実装・検証・撤去タスクが対象ファイルを選ぶ際の参照元とする。
- [ ] 1.1 旧方式参照と変更対象ファイルを棚卸しする
  - `rg` で旧 URL、API/Web PKI、TLS 前提、installer の役割選択・SSH/SCP・常設コマンド参照を洗い出す。
  - Kill Switch 切替 Web 部品と関連 API・テストを特定し、design.md の File Structure Plan と照合して対象ファイル一覧をこのタスクの成果にする。
  - 隣接する e2e-tests、vendor-live-e2e、release/installer-check workflow の参照箇所も記録する。
  - 棚卸し成果物を `.kiro/specs/single-node-deployment/inventory.md` に作成し、旧 URL・PKI・installer、Kill Switch、E2E・配布 workflow を境界ごとの対象ファイル一覧として記録する。後続タスクはこの一覧を参照する。
  - 観測できる完了条件: `inventory.md` に検索語・境界ごとの対象パス・所有境界が列挙され、実装タスク間の対象重複が解消され、後続タスクが一覧を参照している。
  - _Boundary: 棚卸し（実装前の横断調整）_
  - _Requirements: 1.3, 1.4, 4.2, 4.3, 4.4, 7.2, 8.6_
- [ ] 1.2 実行環境の前提を整える
  - `@fastify/http-proxy` を Fastify 5 対応の最新 11.x（11.6.6 以上。調査時点の latest は 11.6.9）へ `web/package.json` と lockfile で限定更新する。
  - nft の構文検証には Debian 12+ または Ubuntu 22.04+ の nftables 環境を使い、boot guard の適用・実確認に失敗する環境は apply を非0で失敗させる。6秒/timeout 実測は対応 OS の検証サーバで行う。
  - 観測できる完了条件: イメージ内で UID/GID 降格コマンドが存在し、`web/package.json` で Fastify 5 と互換の `@fastify/http-proxy` 最新 11.x（11.6.6 以上。調査時点の latest は 11.6.9）が指定され、lockfile と整合する。
  - _Boundary: 実行前提_
  - _Requirements: 2.8, 5.7, 8.2_

## 2. root Compose とホスト準備
- [ ] 2. 単一ノード Compose とホスト準備を実装する
- [ ] 2.1 root Compose と vendor fragment の merge 契約を作る
  - root Compose に `name: vpngwgui` を宣言し、Web/API/proxy、app-net、gateway-socket、ctl-socket、永続 named volume を集約する。全 lifecycle command で `-p vpngwgui` を明示する。`COMPOSE_PROJECT_NAME` と `-p` は `name:` より優先されるため、他名は非対応（volume 名が変わる）とする。
  - API を LAN 公開せず、Gateway に TCP 制御 listener を置かず、runner の ctl-socket と Gateway UDS volume を分離する。
  - ベンダー fragment の標準 `-f`/`COMPOSE_FILE` merge と fragment 除外・再追加時の volume 再利用を成立させる。
  - 観測できる完了条件: root Compose と各 vendor fragment の merge に対する `docker compose -p vpngwgui config --quiet` が成功し、service/volume/network と公開ポートが契約どおりである。未使用の `.env` キーは Compose が無視することをテストで確認し、未知キー拒否を期待しない。
  - _Boundary: root Compose_
  - _Requirements: 1.1, 1.2, 1.5, 4.3, 5.7, 6.2, 6.3, 6.4, 6.7_
- [ ] 2.2 TLS override fragment と設定例を用意する
  - `.env.example` と Web HTTPS/API→Gateway TLS の独立した override fragment を用意し、既定値は両方 OFF とする。
  - TLS OFF 時には対応する証明書 mount が無く、TLS ON 時だけ必要な証明書 mount/環境変数が加わる。
  - 観測できる完了条件: TLS fragment を含む4通りの Compose config が成功し、各構成で `vendors/protonvpn/compose.yml`、`vendors/adguardvpn/compose.yml` の各 fragment と fragment なしを検証し、ON の区間にだけ証明書 mount が現れる。
  - _Boundary: root Compose_
  - _Depends: 2.1_
  - _Requirements: 3.1, 3.2, 3.3, 5.1, 5.2, 5.6, 5.8_
- [ ] 2.3 host-preparation CLI と安全な共通処理を作る
  - `check|apply|status|remove` のみを受け付ける dispatcher とする。`check` は読み取り専用の静的 prerequisite 検査（OS Debian 12+/Ubuntu 22.04+、root、必要コマンド、rootful Docker、nft availability と許可時の `nft -c`、LAN_IFACE）を行い、rootless Docker を拒否する。boot guard の実適用・確認は `apply` が担い、失敗時は非0で非対応環境とする。標準エラー報告と所有状態記録も作る。
  - LAN interface は Compose と同じ repository root の `.env` にある `LAN_IFACE` だけから取得する。`check` と `apply` は未設定・`[A-Za-z0-9._-]` 以外を含む形式不正・ホスト上に interface が存在しない場合に非0で終了する。未設定時は既定ルートの interface を候補表示するだけとし、`.env` を生成・変更せず、自動検出値を適用しない。
  - Docker の導入・更新や daemon 設定変更、常設 update/uninstall/status コマンドを追加しない。
  - 観測できる完了条件: 静的に判定できる前提（対応外 OS・root 不足・必要コマンド不足・rootless Docker・nft 構文・LAN_IFACE の未設定/不正形式/不在）の失敗が `check` で非0となり、boot guard の実適用または確認失敗が `apply` で非0となる。未設定時に既定ルート候補が表示されても `.env` が作成・変更されず、state が root:root 0600 で保持される。
  - _Boundary: host-preparation_
  - _Requirements: 2.1, 2.3, 2.4, 2.7, 6.5_
- [ ] 2.4 sysctl の適用・復元と ownership drift 検出を作る
  - LAN 転送に必要な値の元値・製品適用値を記録し、apply は冪等に適用する。
  - remove は製品所有対象のみを元値へ戻し、外部変更がある項目を上書きせず競合として報告する。
  - 観測できる完了条件: 二度の apply で重複せず、変更済みの非所有設定は保持され、競合が非0と一覧で報告される。
  - _Boundary: host-preparation_
  - _Requirements: 2.2, 2.3, 2.4, 2.7, 6.5, 6.6_
- [ ] 2.5 boot guard を初期 BLOCK 専用で設置する
  - `apply` が検証した `LAN_IFACE` を所有 state に記録し、独立 `inet vpngwgui_guard` table/set/chain を一度作成する bootstrap と初期 BLOCK を適用する systemd unit を設置する。unit は nftables 起動後かつ network-pre/Docker 起動前に実行する。
  - boot unit は初期遮断のみを担い、起動後の切替 watcher/常駐 service や Docker socket 利用を作らない。unit の有効化と guard table/chain/rule の適用を確認できない場合は `apply` を失敗させ、非対応環境として扱う。
  - 観測できる完了条件: state の記録値が unit の BLOCK batch の interface と一致し、unit が Docker より前にその interface を BLOCK にする。unit 有効化・table/chain/rule 検査が失敗すれば非0となる。remove は所有記録に一致する unit/table だけを撤去する。
  - _Boundary: host-preparation_
  - _Requirements: 2.5, 2.7, 2.8, 8.2_
- [ ] 2.6 host-preparation に reboot request の固定実行基盤を設置する
  - ホスト `/var/lib/vpngwgui-host-ctl` を root:10001 / mode 0730 で作成し、systemd path unit は同じディレクトリの `reboot-request` を監視する。Compose bind mount と API→proxy 接続は 2.7 が所有する。proxy が作成する依頼ファイルは UID 10001 / mode 0600 とする。path/service は依頼ファイルの検出後に固定の `systemctl reboot` だけを実行し、依頼内容をコマンドとして解釈しない。
  - host-preparation は依頼ホスト directory の owner/mode 設定と systemd path/service の設置、および固定の `systemctl reboot` だけを担当する。Compose bind mount と API→proxy 接続は 2.7 が所有する。`remove` は Compose を `docker compose -p vpngwgui down` した後に行う。
  - 観測できる完了条件: ホスト directory owner/mode と systemd path unit の監視先が規定どおりで、systemd が所定の依頼ファイルを検出すると固定の再起動要求だけを実行し、任意コマンド文字列を実行しない。
  - _Boundary: host-preparation_
  - _Requirements: 2.6, 2.7_
- [ ] 2.7 root Compose で API の reboot 要求を host-preparation の依頼先へ接続する
  - Compose は rootful Docker で動作させる。entrypoint の root 起動、`USER`/Compose `user` の削除、`su-exec` による UID/GID 10001 への権限降格は 4.4 の成果に依存し、本タスクでは実装・テストしない。依頼先をホスト `/var/lib/vpngwgui-host-ctl`、proxy 内 `/var/run/vpngw-host-ctl` に統一する。ホスト dir は root:10001 / 0730、request file は UID 10001 / 0600。root Compose は proxy だけに read-write bind mount し、API は依頼 dir を mount しない。API は `requestGatewayReboot()` から新 gateway UDS 経由で proxy `/net/host-reboot` を呼ぶ。systemd path unit はホスト側の同一ディレクトリを監視する。
  - 認証済み API 要求から依頼ファイル作成までの経路を接続し、systemd の固定実行基盤と依頼先を一致させる。
  - 観測できる完了条件: 管理者の API 要求が proxy UDS 経由で依頼ファイルを作り、受付結果（202/既存依頼/利用不可）が API 応答で返る。ホストとコンテナのパス、mount の proxy 限定、owner/mode、systemd watch path が一致する。
  - _Boundary: Root Compose（API・proxy・host-preparation の依頼ディレクトリ接続）_
  - _Depends: 2.1, 2.6, 4.4, 4.6_
  - _Requirements: 2.6_
- [ ] 2.8 host-preparation の失敗・status・remove を統合する
  - check/apply/status/remove を共通 state と接続し、部分失敗時に失敗段階・適用済み変更を表示する。
  - `status` は `.env` の `LAN_IFACE` と state の記録値を比較し、異なれば drifted と報告する。status は設定を変更せず、運用者が `apply` を再実行して一致させる。
  - remove は Compose volume を削除せず、所有差分がある対象を保持して非0で終える。
  - 観測できる完了条件: 部分失敗後に再実行でき、`.env` と記録値の相違が status に drifted と表示され、status 自体は `.env` を変更しない。status が所有対象と差分を識別し、remove が製品外設定を変更しない。
  - _Boundary: host-preparation_
  - _Depends: 2.3, 2.4, 2.5, 2.6_
  - _Requirements: 2.1, 2.3, 2.4, 2.7, 6.5, 6.6_

## 3. Gateway Guard と Kill Switch 反映契約
- [ ] 3. Gateway Guard と Kill Switch 反映契約を実装する
- [ ] 3.1 Guard nft batch 生成を実装する
  - boot unit bootstrap は table/set/chain を一度作成して BLOCK にする。状態遷移 batch は既存 chain/set の flush と rules/elements のみを行い、table/set/chain を再宣言せず、LEASE の要素と drop 規則は同一 batch、OFF に drop 規則を含めない。
  - 観測できる完了条件: 単体テストで各 batch の順序・規則・OFF に drop がないことを確認できる。
  - _Boundary: Gateway guard_
  - _Requirements: 2.5, 2.8, 8.2_
- [ ] 3.2 Gateway guard 状態機械と lease 更新を実装する
  - proxy を起動後の唯一の guard 切替主体とし、適用中の有効ガード値 `killSwitch && transparentGatewayEnabled` に応じて BLOCK→LEASE/OFF、LEASE↔OFF を切り替える。透過ゲートウェイ無効時は Kill Switch 値にかかわらず OFF とし、停止時保証の対象外とする。
  - 健康時のみ1秒周期で4秒 timeout lease を更新し、失敗/不健康時は更新停止、batch 失敗時は状態を変えない。GET status/監査ログに状態と最終更新を示す。
  - 観測できる完了条件: 遷移表全行、API settings を初回受信・適用するまで healthy とせず boot BLOCK を維持すること、proxy 再起動時は初回 settings 適用まで既存 state を操作せず LEASE は自然失効で drop、OFF は OFF のままであること、透過有効時だけ有効値で LEASE/OFF となること、健康前の無変更、更新失敗後の失効を単体テストで確認できる。
  - _Boundary: Gateway guard_
  - _Depends: 3.1_
  - _Requirements: 2.5, 2.8, 8.2_
- [ ] 3.3 Gateway 通常停止で lease を先に失効させる
  - SIGTERM/SIGINT/SIGQUIT handler が lease 削除後に listener/server/controller を閉じる。削除失敗時も終了し、timeout に委ねる。
  - 観測できる完了条件: 単体テストで各 signal の lease 削除が close より先になり、OFF は停止時に drop を追加しない。
  - _Boundary: Gateway guard_
  - _Depends: 3.2_
  - _Requirements: 2.8, 8.2_
- [ ] 3.4 API の通知直列キューを実装する
  - 起動時・10秒周期・`PUT /v1/connection/config` の3経路すべてが同じ API 所有の通知キューを通り、通知の順序を保証する。有効ガード値（`killSwitch && transparentGatewayEnabled`）変更は proxy 200 の後だけ永続化する。
  - 到達不能/503/5秒超の queue 待ち/timeout は保存せず 503 とする。Kill Switch を含む変更は `kill_switch_not_applied`、それ以外の有効値変更は `gateway_setting_not_applied`。有効値を変えない PUT は現行どおり通知失敗でも保存する。保存後の失敗は周期再通知で永続値へ戻す。
  - 観測できる完了条件: 単体・route test で3経路の順序と各成功/失敗時の保存値・HTTP status・最後に proxy に届く値を確認できる。
  - _Boundary: API 通知キュー_
  - _Requirements: 2.8_
- [ ] 3.5 Gateway settings endpoint と Web Kill Switch 表示を接続する
  - proxy `POST /settings` は Gateway ruleset 適用後に guard を切替え、guard 失敗は 503 `guard_apply_failed` とする。
  - Web の Kill Switch 部品は `kill_switch_not_applied` または `gateway_setting_not_applied` で関係するトグルを元に戻す。Kill Switch は透過ゲートウェイのみ対象で、明示的プロキシのみでは停止時保証がない旨を表示する。
  - 観測できる完了条件: API・proxy・Web 統合テストで両設定の変更時に適用成功時のみ永続化され、失敗時は表示と永続値が旧値に戻ること、Kill Switch が透過ゲートウェイにのみ適用され明示プロキシのみで停止保証がない UI 表示を確認する。
  - _Boundary: Kill Switch 反映契約_
  - _Depends: 3.2, 3.4_
  - _Requirements: 2.8_

## 4. 通信 transport と認証
- [ ] 4. Web/API/Gateway の通信 transport を切り替える
- [ ] 4.1 Web HTTP/HTTPS listener と証明書検証を切り替える
  - `WEB_HTTPS_ENABLED` の strict boolean により HTTP を既定とし、HTTPS ON 時のみ cert/key を必須化する。不足・不正・鍵不一致は HTTP へ降格せず起動失敗。
  - 観測できる完了条件: 単体テストで OFF の証明書不要、ON の listener、異常証明書の fail closed を確認できる。
  - _Boundary: 通信 transport_
  - _Requirements: 3.1, 3.2, 3.3, 3.4_
- [ ] 4.2 Web same-origin API proxy と API 内部 HTTP を構成する
  - Web→API を Compose 内 HTTP とし、ブラウザには `/api` を proxy して同一オリジンに見せる。API は host 公開せず、到達不能は 502、復旧後は証明書再生成なしで再利用する。
  - `web/package.json` にある Fastify 5 対応の最新互換 11.x（>=11.6.6）を使う。
  - 観測できる完了条件: 統合テストで `/api/v1` の prefix strip、API 不達時 502、復旧後の再要求を確認できる。
  - _Boundary: 通信 transport_
  - _Depends: 1.2, 2.1_
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
- [ ] 4.3 Web HTTPS flag と Cookie Secure を連携する
  - API の session cookie Secure を `WEB_HTTPS_ENABLED` から決め、`trustProxy`/転送ヘッダーで推定しない。管理者登録・login/logout/session 認可を維持する。
  - 観測できる完了条件: 単体テストで flag true のみ Secure、X-Forwarded-Proto 単独では変化せず、既存認証シナリオが成立する。
  - _Boundary: 通信 transport_
  - _Requirements: 3.5, 3.6_
- [ ] 4.4 Gateway UDS server と安全な socket ownership を実装する
  - `proxy/Dockerfile` の `USER vpngwgui` と `compose/gateway.yml` の `user: "10001:10001"` を削除し、entrypoint が root で UDS volume を整えてから `su-exec` で UID/GID 10001 へ降格する。Gateway 制御を `/run/vpngw-gateway/gateway.sock` の単一 owner に bind し、stale socket の安全な判定・除去、通常 close/unlink、API 再接続を実装する。
  - entrypoint は root で volume を chown 10001:10001/chmod 0700 してから `su-exec` で降格し、socket mode は 0600 とする。
  - 観測できる完了条件: integration test で root entrypoint による初回 root-owned volume の初期化、`USER`/Compose `user` 削除後の起動、UID/GID 降格、権限、stale/active/不正 owner socket、再作成と reconnect を確認できる。
  - _Boundary: 通信 transport_
  - _Depends: 1.2, 2.1_
  - _Requirements: 1.2, 5.7, 6.2, 6.7_
- [ ] 4.5 API Gateway UDS HTTP/HTTPS client を実装する
  - `GATEWAY_TLS_ENABLED` 既定 OFF の HTTP over UDS と、ON 時の厳格な mTLS (CA/SAN/client cert) を実装する。誤設定・期限切れ・不一致時は降格しない。
  - 観測できる完了条件: 単体テストで HTTP/HTTPS 選択、CA/SAN/client cert 検証、期限切れ・誤設定失敗を確認できる。TLS/保護モード不一致は専用エラーとしてログ・status・UI に区別して表示するテストを含める。
  - _Boundary: 通信 transport_
  - _Depends: 4.4_
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.8_
- [ ] 4.6 Gateway listener と設定通知の lifecycle を接続する
  - Gateway（proxy）の TCP 8443 listener を除去し、UDS の HTTP/HTTPS listener と TLS options を接続する。
  - 観測できる完了条件: integration test で Gateway TCP port 不在、UDS 経由制御、保護方式不一致時の専用ログ/status/UI 表示と復旧を確認できる。
  - _Boundary: 通信 transport_
  - _Depends: 4.5, 3.2, 3.4_
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.7, 5.8, 8.1, 8.2, 8.8_

## 5. E2E と隣接テスト契約
- [ ] 5. E2E と隣接テストを新しい通信契約へ追従させる
- [ ] 5.1 共通 E2E API client を Web origin `/api` 契約へ更新する
  - HTTP/HTTPS scheme に応じて client を選び、HTTPS 時のみ任意 Web CA を使い、未指定時は標準 trust store を検証する。
  - 観測できる完了条件: client test が `/api/v1` を使い、API CA の必須依存を持たない。
  - _Boundary: E2E_
  - _Requirements: 4.4, 8.6_
- [ ] 5.2 hosted provision/lifecycle と fixture を Compose 方式へ追従させる
  - 全 fixture lifecycle command に `-p vpngwgui` を付け、`COMPOSE_PROJECT_NAME`/`-p` の優先と他 project 名による volume 名変更を契約化する。installer fixture を Compose fixture に置換し、TLS matrix fragments、HTTP 既定、volume retention、vendor fragment の着脱を扱う。
  - 観測できる完了条件: fixture が config/up/down を実行し、`down` 後も volume が保持され、fragment 再選択で再利用される。
  - _Boundary: E2E_
  - _Depends: 2.1, 2.2, 4.1, 4.2, 4.4, 4.5, 4.6_
  - _Requirements: 1.1, 1.2, 6.1, 6.2, 6.3, 6.4, 6.7, 8.3, 8.5_
- [ ] 5.3 hosted VPN 操作シナリオを新しい到達経路に更新する
  - hosted API 呼び出しを Web 公開 origin `/api` 経由にし、管理者認証、runner allowlist 拒否を維持する。mock VPN 操作としてベンダー切替、接続・切断、都市・サーバー選択、お気に入り、距離順を列挙して検証する。Gateway の通信経路・転送シナリオは 5.7 が所有する。
  - 実 VPN 資格情報を hosted CI の環境・secret・artifact に渡さない。
  - 観測できる完了条件: hosted E2E が default HTTP/no-cert 構成で login、上記の mock VPN 操作の各項目を完了し、Gateway 通信シナリオを重複して扱わず、結果が項目ごとに記録される。
  - _Boundary: E2E_
  - _Depends: 5.1, 5.2, 4.2, 4.6_
  - _Requirements: 8.1, 8.3, 8.7, 8.8_
- [ ] 5.4 Web HTTPS × Gateway TLS の4構成と不正証明書を E2E 化する
  - OFF/OFF、ON/OFF、OFF/ON、ON/ON それぞれの起動と browser/API 操作を確認し、wrong CA、期限切れ、SAN 不一致、client cert 不足に加え、TLS ON/OFF mismatch を独立ケースとして fail closed とし、不一致専用ログ/status/UI 表示を確認する。
  - 観測できる完了条件: hosted browser matrix が全4行と個別の不正証明書ケースを通過し、HTTP 降格がない。
  - _Boundary: E2E_
  - _Depends: 5.2, 5.3, 4.1, 4.5_
  - _Requirements: 3.3, 3.4, 3.6, 5.3, 5.4, 5.6, 5.8, 8.4_
- [ ] 5.5 hosted lifecycle と保存データ削除を E2E 化する
  - 資材更新相当・recreate・down・条件付き remove-orphans・down -v を検証し、通常操作でデータ保持、明示削除でのみ volume 削除を確認する。
  - remove-orphans は vendor fragment を先に外した結果 runner が orphan になった場合に限り、固定 project 配下の orphan であることと named volume が保持されることを確認して実行する。fragment 除外前に通常の down を行い、orphan 回復手順も確認する。
  - 観測できる完了条件: E2E が管理者/設定/favorite/audit/vendor state の保持と down -v による削除を確認する。
  - _Boundary: E2E_
  - _Depends: 5.2_
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.6, 8.5_
- [ ] 5.6 vendor-live-e2e の URL/CA 前提を更新する
  - 手動実 VPN 試験は Web 公開 URL の `/api` 経由を使い、HTTPS 時のみ任意 Web CA を受け付ける。API CA 前提を除き、CI 起動拒否を保つ。
  - 観測できる完了条件: 設定・prepare・関連 test が新 URL 契約を検証し、実 VPN 資格情報は hosted CI に渡らない。
  - _Boundary: E2E_
  - _Depends: 5.1_
  - _Requirements: 8.6, 8.7_
- [ ] 5.7 hosted Gateway 通信シナリオを検証する
  - 5.3 から分けた Gateway シナリオとして、透過ゲートウェイ、明示的プロキシ、DNS 中継、迂回の通常動作を列挙して hosted E2E で検証する。Kill Switch の UI は透過ゲートウェイのみを対象とし、明示的プロキシのみでは停止時保証がない旨を表示することも確認する。
  - 観測できる完了条件: 各 Gateway 通常動作と Kill Switch の対象モード表示が個別に検証され、項目ごとの結果が記録される。
  - _Boundary: E2E_
  - _Depends: 5.2, 4.6_
  - _Requirements: 2.8, 8.2_

## 6. 配布・文書・installer 撤去
- [ ] 6. Compose 配布・文書へ移行し installer を撤去する
- [ ] 6.1 配布 workflow を Compose bundle の公開・検査へ変更する
  - release/installer-check workflow を installer 配布から Compose 資材・`.env.example`・host-preparation 資材の配布/検査へ置換する。
  - 観測できる完了条件: workflow artifact に必要資材が含まれ、installer bootstrap が配布されない。
  - _Boundary: 配布・文書_
  - _Requirements: 7.4_
- [ ] 6.2 README と steering の導入・通信契約を更新する
  - 本タスクは README と steering の文書を成果物とし、要件 7.1, 7.2, 7.3, 7.5 を担う。README に Compose 導入/更新/停止/削除、host preparation、HTTP/HTTPS と Gateway TLS の既定・証明書方法、Debian 12+/Ubuntu 22.04+ 上の rootful Docker Engine のみ対応し rootless Docker は非対応であること、Kill Switch は透過ゲートウェイのみ適用され明示プロキシのみでは停止時保証がないこと、未リリース旧方式の移行対象外を記す。7.4 の配布物提供は 6.1 が所有する。README に配布物の入手方法を書く場合は、7.1 の導入方法の説明として扱う。
  - 初回・設定変更の導入手順は `.env` を先に用意して `LAN_IFACE` を設定し、その後に読み取り専用 prerequisite 検査の `host-preparation.sh check`、実際に boot guard を適用・確認する `apply`、`docker compose -p vpngwgui config --quiet` と `docker compose -p vpngwgui up`を行う順とする。`check` の候補表示は `.env` への自動設定を意味しないことも案内する。
  - top-level `name: vpngwgui` を宣言し、README の全 lifecycle command に `-p vpngwgui` を明記する。`COMPOSE_PROJECT_NAME` と `-p` は `name:` より優先し、別名は volume 名を変えるため非対応とする。停止・削除時は `docker compose -p vpngwgui down` の後に host-preparation `remove` を行う順を明記する。`docker compose pull` を手順に含めず、build-only 更新順と `down -v` のデータ削除を明示する。
  - 観測できる完了条件（7.1）: README に対応 OS が Debian 12+/Ubuntu 22.04+ のみである旨、単一ノードのみをサポートする旨、Compose による導入・更新・停止・削除手順、ホスト準備と boot guard 検証の必要性が記載され、初回・設定変更で `.env` の `LAN_IFACE` 設定が check/apply より前に示されている。
  - 観測できる完了条件（7.2）: README に旧 installer の役割指定・遠隔配置・ペアリング手順が現行の有効な導入方法として記載されていない。
  - 観測できる完了条件（7.3）: README に Web HTTPS と API→Gateway TLS の既定値（いずれも無効）と、各区間の任意有効化・証明書準備方法が区別して記載され、Kill Switch は透過ゲートウェイのみ適用・明示的プロキシのみでは停止保証がない旨が記載されている。
  - 観測できる完了条件（7.5）: README に新方式への新規導入を案内し、旧方式からの移行・互換対応・保存データ引き継ぎが非対応と明記されている。
  - README の全 lifecycle command は `-p vpngwgui` を使い、必ず `docker compose -p vpngwgui down` の後に host-preparation `remove` を行う。README の更新・停止・削除手順の全 Compose lifecycle command に `-p vpngwgui` を付け、旧インストーラ手順がなく、`docker compose pull` を使わない build-only 更新順と `down -v` によるデータ削除が明記され、steering の product/tech/structure/roadmap と矛盾しない。
  - _Boundary: 配布・文書_
  - _Requirements: 1.1, 1.3, 1.4, 6.1, 6.4, 6.5, 6.6, 7.1, 7.2, 7.3, 7.5_
- [ ] 6.3 installer の command 層・設定・bootstrap 生成・専用テストを撤去する
  - inventory.md の installer 境界に従い、installer/ 配下の setup/main/app/bootstrap/build/config command 層、設定、生成物、専用テストを削除する。root `package.json` の `test:install` を新しい host-preparation テスト runner へ変更し、`npm test` が installer 撤去後も実行できるようにする。
  - host-reboot の新しい実行経路（API→proxy→依頼ファイル→systemd）は 2.6・2.7 が所有し、本タスクは移管も実装も行わない。installer 配下の再起動関連の旧部品は、inventory.md に「旧部品と新しい所有タスク（2.6/2.7）」の対応を記録したうえで、他の installer 部品と同様に撤去だけを行う。
  - 旧 installer test を host-preparation の新テストに置き換え、対象 installer ファイルと bootstrap 生成物が存在せず、root `package.json` の `test:install` が置換後 runner を呼び、`npm test` 経由で新しい host-preparation 検査が実行されることを確認する。
  - 観測できる完了条件: installer/ の撤去対象一覧が不在で、root `package.json` の `test:install` が更新済みで、host-reboot の新経路のテストが通り、`rg` で残存 installer 参照を調査した結果が inventory.md に記録されている。
  - _Boundary: installer command・bootstrap_
  - _Depends: 1.1, 2.3, 2.5, 2.6, 2.7, 6.2_
  - _Requirements: 1.3, 1.4, 7.2_
- [ ] 6.4 分離配置用 Compose fragment を撤去し root Compose へ統合する
  - inventory.md に列挙した compose/web.yml・compose/api.yml・compose/gateway.yml と関連する分離配置用設定・テストを削除し、必要な定義は root Compose に移管済みであることを確認する。
  - fragment 別検査を root Compose と vendor/TLS fragment の新しい config 検査へ置き換える。
  - 観測できる完了条件: 3つの旧 fragment と関連撤去対象が不在で、対象構成ごとの `docker compose -p vpngwgui config --quiet` が成功し、root Compose の service・volume・network・公開 port が契約どおりである。
  - _Boundary: Compose 構成_
  - _Depends: 1.1, 2.1, 2.2, 6.1, 6.2_
  - _Requirements: 1.3, 1.4, 7.2_
- [ ] 6.5 遠隔配置・ペアリング・旧 PKI 経路を撤去する
  - inventory.md の remote deployment・role selection・pairing・旧 PKI 境界に基づき、該当コード、設定、証明書生成・配布経路を削除する。
  - 旧経路のテストと release-installer.yml・installer-check.yml の検査は 6.1 が所有する Compose bundle の配布・検査へ置換し、その workflow が新方式の対象資材を検査することを依存先として確認する。
  - 観測できる完了条件: inventory.md の対象ファイルが不在で、旧経路のテストが削除または新方式テストに置換され、置換後の workflow と関連 test suite が成功する。`rg` の現行参照調査結果も inventory.md に記録する。
  - _Boundary: remote deployment・pairing・旧 PKI_
  - _Depends: 1.1, 4.2, 4.5, 5.1, 5.2, 5.6, 6.1, 6.2_
  - _Requirements: 1.3, 1.4, 7.2_

## 7. 統合・受入
- [ ] 7. 統合検証と実機受入を完了する
- [ ] 7.1 実機受入環境を確認し手順書を作る
  - 検証サーバ `192.168.3.240` へ sshpass で接続できることと、sudo NOPASSWD を確認する。OS 種別・版が Debian 12+ または Ubuntu 22.04+ か、`nft --version` と root での `nft -c` 可否、Docker Engine と Compose v2 の有無・版、空きディスクを記録する。
  - LAN 側に使う interface と、LAN 端末役（network namespace 等）の準備・起動方法を確認する。受入資材を scp で配置する具体的な手順と配置先を記録する。
  - 受入前の初期状態を調べ、旧方式の残骸と既存の `vpngwgui` nft table・Compose volume がないことを確認する。存在する場合は影響を特定し、安全な片付け手順を記録する。
  - 検証のため新たに導入したアプリケーションは検証サーバの `~/claude-installed.md` に記録する。
  - 確認結果、実行コマンド、資材配置・初期化手順を `.kiro/specs/single-node-deployment/acceptance-env.md` にまとめる。
  - 観測できる完了条件: `acceptance-env.md` に接続、Debian 12+/Ubuntu 22.04+ の対応 OS、nftables と systemd boot guard 適用・確認可否、Docker/Compose、空き容量、LAN interface/端末役、scp、初期状態と必要時の片付け手順が具体的に記録され、7.x の実機受入タスクがこの文書の手順だけで開始できる。
  - _Boundary: 実機受入環境_
  - _Requirements: 8.3, 8.4, 8.5_
- [ ] 7.2 Compose・host-preparation・通信を統合検証する
  - `scripts/deploy-verify.sh` を新構成に合わせ、Compose merge/config、固定名、公開ポート、TLS mount、UDS volume、host-preparation 実行前提を検査する。検証サーバ接続先・認証等は `acceptance-env.md` に記録された `VERIFY_HOST` 等の環境変数を使う。
  - unit/integration coverage を通し、GitHub-hosted runner 上の disposable/privileged 環境で hosted E2E を実資格情報なしで実行する。開発ホスト上では hosted E2E を実行しない。
  - _Boundary: 統合（Compose・host-preparation・通信・E2E）_
  - _Depends: 2.7, 2.8, 3.5, 4.6, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 6.3, 6.4, 6.5, 7.1_
  - 統合対象は次の3種類に固定し、実行したコマンドと件数を `acceptance-env.md` 隣の記録（`integration-report.md`）に列挙する: (a) `scripts/deploy-verify.sh`、(b) root `npm test`（置換後の `test:install` を含む）、api/web/proxy の各パッケージの `package.json` にある unit/integration テストスクリプト全部、(c) 5.3〜5.5 および 5.7 の GitHub-hosted runner 上の hosted E2E spec 全部（5.6 の vendor-live-e2e は実資格情報が要る手動試験のため対象外とし、その設定・prepare の関連 test は (b) に含める）。
  - 観測できる完了条件: `scripts/deploy-verify.sh`、root `npm test`（置換後 `test:install` を含む）、unit/integration テスト一式、GitHub-hosted runner 上の5.3〜5.5・5.7 の hosted E2E spec が通り、生成 API client は公式生成手順で更新されている。
  - _Requirements: 2.5, 2.6, 2.8, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_
- [ ] 7.3 検証サーバで nft guard の構文・評価順・遮断経路を受け入れる
  - acceptance-env.md の手順で資材を配置し、Debian 12+ または Ubuntu 22.04+ の nft/kernel で batch を `nft -c` 検証後に適用する。
  - 同一の状態遷移 batch を対象 OS 上で繰り返し適用して成功することを確認する。timeout set の追加・更新・4秒自然失効、priority -1 return と priority 0 評価、DNAT 済み・DNS redirect 後・迂回・VPN 転送を含む遮断、Gateway table 再作成後の guard 維持を個別に確認し、コマンド・結果・時刻を記録する。
  - 観測できる完了条件: 構文検証成功、timeout/評価順の結果、各遮断経路の pass/fail と guard 維持が受入記録に残り、設計条件を満たす。
  - _Boundary: 統合受入（検証サーバ nft guard）_
  - _Depends: 7.1, 7.2_
  - _Requirements: 2.5, 2.8, 8.2_
- [ ] 7.4 検証サーバで Kill Switch 停止時の遮断と変更拒否を受け入れる
  - acceptance-env.md の手順で資材を配置し、Kill Switch true/false の各条件で SIGKILL・Gateway hang・通常停止を実施する。
  - 遮断時刻を測定し、透過ゲートウェイ有効かつ Kill Switch true は全停止経路で6秒以内、通常停止は Gateway 終了前に遮断されることを確認する。透過有効かつ Kill Switch false は停止後も guard が遮断しないことを確認する。
  - proxy 停止中の `killSwitch` / `transparentGatewayEnabled` PUT が effective 値を変える場合に503となり永続値不変であること、Kill Switch を含む場合の `kill_switch_not_applied`、proxy 再開後の再試行を記録する。
  - 観測できる完了条件: 透過ゲートウェイ有効時の各停止方式・Kill Switch 値の実測時刻、6秒上限と通常停止順序、proxy 停止中の有効値変更に対する503/永続値/再開後反映の結果が受入記録にあり、全条件を満たす。
  - _Boundary: 統合受入（検証サーバ Kill Switch）_
  - _Depends: 7.1, 7.2, 7.3_
  - _Requirements: 2.8, 8.2_
- [ ] 7.5 検証サーバで Compose lifecycle とホスト準備を受け入れる
  - acceptance-env.md の手順で資材を配置し、初回起動・更新・停止・再作成・`down -v` と vendor fragment の除外・再追加を実施する。
  - 管理者・設定・お気に入り・監査ログ・vendor state の保持、通常 down での volume 保持、`down -v` での明示削除を確認する。
  - host preparation の apply/status/remove の状態・所有差分と、boot guard が nftables 後かつ network-pre/Docker 前に BLOCK を適用する起動順を確認して記録する。host-preparation `remove` は必ず `docker compose -p vpngwgui down` 後に実施する。
  - 観測できる完了条件: lifecycle ごとのデータ保持/削除、vendor fragment の再追加、apply/status/remove の結果、boot guard 起動順が受入記録にあり、製品外設定を変更しない。
  - _Boundary: 統合受入（検証サーバ Compose・host-preparation）_
  - _Depends: 7.1, 7.2, 5.5_
  - _Requirements: 2.5, 2.7, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 8.3, 8.5_
- [ ] 7.6 検証サーバで Web HTTPS × Gateway TLS の4構成を受け入れる
  - acceptance-env.md の手順で資材を配置し、OFF/OFF、ON/OFF、OFF/ON、ON/ON の起動と管理画面/API 操作を行う。
  - wrong CA、期限切れ、SAN 不一致、client cert 不足を個別に与え、TLS 有効区間で接続が失敗し HTTP/平文へ降格しないことを確認する。
  - 観測できる完了条件: 4構成の起動・操作結果と各不正証明書ケースの失敗理由が受入記録にあり、無断降格がない。
  - _Boundary: 統合受入（検証サーバ TLS）_
  - _Depends: 7.1, 7.2, 5.4_
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.1, 5.1, 5.2, 5.3, 5.4, 5.6, 5.7, 8.4_

## 設計へ戻す事項

- 現時点で、要件・design.md・research.md 2026-11-18 決定の間に、タスク計画を止める未解決の矛盾は見つからなかった。6秒上限、nft timeout 実効値、TLS 4構成は設計上の未実測リスクとして明示され、検証サーバ受入タスクに割り当てた。

## 要件網羅表

| 要件ID | タスク |
|---|---|
| 1.1 | 2.1, 5.2, 6.2 |
| 1.2 | 2.1, 4.4, 5.2 |
| 1.3 | 1.1, 6.2, 6.3, 6.4, 6.5 |
| 1.4 | 1.1, 6.2, 6.3, 6.4, 6.5 |
| 1.5 | 2.1 |
| 2.1 | 2.3, 2.8 |
| 2.2 | 2.4 |
| 2.3 | 2.3, 2.4, 2.8 |
| 2.4 | 2.3, 2.4, 2.8 |
| 2.5 | 2.5, 3.1, 3.2, 7.2, 7.3, 7.5 |
| 2.6 | 2.6, 2.7, 7.2 |
| 2.7 | 2.3, 2.4, 2.5, 2.6, 2.8, 7.5 |
| 2.8 | 1.2, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 5.7, 7.2, 7.3, 7.4 |
| 3.1 | 2.2, 4.1, 7.2, 7.6 |
| 3.2 | 2.2, 4.1, 7.2, 7.6 |
| 3.3 | 2.2, 4.1, 5.4, 7.2, 7.6 |
| 3.4 | 4.1, 5.4, 7.2, 7.6 |
| 3.5 | 4.3, 7.2 |
| 3.6 | 4.3, 5.4, 7.2 |
| 4.1 | 4.2, 7.2, 7.6 |
| 4.2 | 1.1, 4.2, 7.2 |
| 4.3 | 1.1, 2.1, 4.2, 7.2 |
| 4.4 | 1.1, 4.2, 5.1, 7.2 |
| 4.5 | 4.2, 7.2 |
| 4.6 | 4.2, 7.2 |
| 5.1 | 2.2, 4.5, 4.6, 7.2, 7.6 |
| 5.2 | 2.2, 4.5, 4.6, 7.2, 7.6 |
| 5.3 | 4.5, 4.6, 5.4, 7.2, 7.6 |
| 5.4 | 4.5, 4.6, 5.4, 7.2, 7.6 |
| 5.5 | 4.5, 4.6, 7.2 |
| 5.6 | 2.2, 4.5, 5.4, 7.2, 7.6 |
| 5.7 | 1.2, 2.1, 4.4, 4.6, 7.2, 7.6 |
| 5.8 | 2.2, 4.5, 4.6, 5.4, 7.2 |
| 6.1 | 5.2, 5.5, 6.2, 7.2, 7.5 |
| 6.2 | 2.1, 4.4, 5.2, 5.5, 7.2, 7.5 |
| 6.3 | 2.1, 5.2, 5.5, 7.2, 7.5 |
| 6.4 | 2.1, 5.2, 5.5, 6.2, 7.2, 7.5 |
| 6.5 | 2.3, 2.4, 2.8, 6.2, 7.2, 7.5 |
| 6.6 | 2.4, 2.8, 5.5, 6.2, 7.2, 7.5 |
| 6.7 | 2.1, 4.4, 5.2, 7.2, 7.5 |
| 7.1 | 6.2 |
| 7.2 | 1.1, 6.2, 6.3, 6.4, 6.5 |
| 7.3 | 6.2 |
| 7.4 | 6.1 |
| 7.5 | 6.2 |
| 8.1 | 4.6, 5.3, 7.2 |
| 8.2 | 1.2, 2.5, 3.1, 3.2, 3.3, 4.6, 5.7, 7.2, 7.3, 7.4 |
| 8.3 | 5.2, 5.3, 7.1, 7.2, 7.5 |
| 8.4 | 5.4, 7.1, 7.2, 7.6 |
| 8.5 | 5.2, 5.5, 7.1, 7.2, 7.5 |
| 8.6 | 1.1, 5.1, 5.6, 7.2 |
| 8.7 | 5.3, 5.6, 7.2 |
| 8.8 | 4.6, 5.3, 7.2 |
