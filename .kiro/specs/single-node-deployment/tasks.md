# Implementation Plan

共有ファイルと単一の実機検証環境を順に使うため、タスクは逐次実行とし (P) は付けない。

全タスクは、対象ファイルを選ぶ際に `.kiro/specs/single-node-deployment/inventory.md`（タスク 1.1 の成果物）の境界別一覧を参照元とする。

## 1. 実装前提と対象範囲の確定
- [x] 1. 実装前提と対象範囲を確定する
  - 1.1 の棚卸し成果物 `.kiro/specs/single-node-deployment/inventory.md` を、後続の実装・検証・撤去タスクが対象ファイルを選ぶ際の参照元とする。
- [x] 1.1 旧方式参照と変更対象ファイルを棚卸しする
  - `rg` で旧 URL、API/Web PKI、TLS 前提、installer の役割選択・SSH/SCP・常設コマンド参照を洗い出す。
  - Kill Switch 切替 Web 部品と関連 API・テストを特定し、design.md の File Structure Plan と照合して対象ファイル一覧をこのタスクの成果にする。
  - 隣接する e2e-tests、vendor-live-e2e、release/installer-check workflow の参照箇所も記録する。
  - 棚卸し成果物を `.kiro/specs/single-node-deployment/inventory.md` に作成し、旧 URL・PKI・installer、Kill Switch、E2E・配布 workflow を境界ごとの対象ファイル一覧として記録する。後続タスクはこの一覧を参照する。
  - 観測できる完了条件: `inventory.md` に検索語・境界ごとの対象パス・所有境界が列挙され、実装タスク間の対象重複が解消され、後続タスクが一覧を参照している。
  - _Boundary: 棚卸し（実装前の横断調整）_
  - _Requirements: 1.3, 1.4, 4.2, 4.3, 4.4, 7.2, 8.6_
- [x] 1.2 実行環境の前提を整える
  - `@fastify/http-proxy` を Fastify 5 対応の最新 11.x（11.6.6 以上。調査時点の latest は 11.6.9）へ `web/package.json` と lockfile で限定更新する。
  - nft の構文検証には Debian 12+ または Ubuntu 22.04+ の nftables 環境を使い、boot guard の適用・実確認に失敗する環境は apply を非0で失敗させる。6秒/timeout 実測は対応 OS の検証サーバで行う。
  - 観測できる完了条件: イメージ内で UID/GID 降格コマンドが存在し、`web/package.json` で Fastify 5 と互換の `@fastify/http-proxy` 最新 11.x（11.6.6 以上。調査時点の latest は 11.6.9）が指定され、lockfile と整合する。
  - _Boundary: 実行前提_
  - _Requirements: 2.8, 5.7, 8.2_

## 2. root Compose とホスト準備
- [x] 2. 単一ノード Compose とホスト準備を実装する
- [x] 2.1 root Compose と vendor fragment の merge 契約を作る
  - root Compose に `name: vpngwgui` を宣言し、Web/API/proxy、app-net、gateway-socket、ctl-socket、永続 named volume を集約する。全 lifecycle command で `-p vpngwgui` を明示する。`COMPOSE_PROJECT_NAME` と `-p` は `name:` より優先されるため、他名は非対応（volume 名が変わる）とする。
  - API を LAN 公開せず、Gateway に TCP 制御 listener を置かず、runner の ctl-socket と Gateway UDS volume を分離する。
  - ベンダー fragment の標準 `-f`/`COMPOSE_FILE` merge と fragment 除外・再追加時の volume 再利用を成立させる。
  - 観測できる完了条件: root Compose と各 vendor fragment の merge に対する `docker compose -p vpngwgui config --quiet` が成功し、service/volume/network と公開ポートが契約どおりである。未使用の `.env` キーは Compose が無視することをテストで確認し、未知キー拒否を期待しない。
  - _Boundary: root Compose_
  - _Requirements: 1.1, 1.2, 1.5, 4.3, 5.7, 6.2, 6.3, 6.4, 6.7_
- [x] 2.2 TLS override fragment と設定例を用意する
  - `.env.example` と Web HTTPS/API→Gateway TLS の独立した override fragment を用意し、既定値は両方 OFF とする。
  - TLS OFF 時には対応する証明書 mount が無く、TLS ON 時だけ必要な証明書 mount/環境変数が加わる。
  - 観測できる完了条件: TLS fragment を含む4通りの Compose config が成功し、各構成で `vendors/protonvpn/compose.yml`、`vendors/adguardvpn/compose.yml` の各 fragment と fragment なしを検証し、ON の区間にだけ証明書 mount が現れる。
  - _Boundary: root Compose_
  - _Depends: 2.1_
  - _Requirements: 3.1, 3.2, 3.3, 5.1, 5.2, 5.6, 5.8_
- [x] 2.3 host-preparation CLI と安全な共通処理を作る
  - `check|apply|status|remove` のみを受け付ける dispatcher とする。`check` は読み取り専用の静的 prerequisite 検査（OS Debian 12+/Ubuntu 22.04+、root、必要コマンド、rootful Docker、nft availability と許可時の `nft -c`、LAN_IFACE）を行い、rootless Docker を拒否する。boot guard の実適用・確認は `apply` が担い、失敗時は非0で非対応環境とする。標準エラー報告と所有状態記録も作る。
  - LAN interface は Compose と同じ repository root の `.env` にある `LAN_IFACE` だけから取得する。`check` と `apply` は未設定・`[A-Za-z0-9._-]` 以外を含む形式不正・ホスト上に interface が存在しない場合に非0で終了する。未設定時は既定ルートの interface を候補表示するだけとし、`.env` を生成・変更せず、自動検出値を適用しない。
  - Docker の導入・更新や daemon 設定変更、常設 update/uninstall/status コマンドを追加しない。
  - 観測できる完了条件: 静的に判定できる前提（対応外 OS・root 不足・必要コマンド不足・rootless Docker・nft 構文・LAN_IFACE の未設定/不正形式/不在）の失敗が `check` で非0となり、boot guard の実適用または確認失敗が `apply` で非0となる。未設定時に既定ルート候補が表示されても `.env` が作成・変更されず、state が root:root 0600 で保持される。
  - _Boundary: host-preparation_
  - _Requirements: 2.1, 2.3, 2.4, 2.7, 6.5_
- [x] 2.4 sysctl の適用・復元と ownership drift 検出を作る
  - LAN 転送に必要な値の元値・製品適用値を記録し、apply は冪等に適用する。
  - remove は製品所有対象のみを元値へ戻し、外部変更がある項目を上書きせず競合として報告する。
  - 観測できる完了条件: 二度の apply で重複せず、変更済みの非所有設定は保持され、競合が非0と一覧で報告される。
  - _Boundary: host-preparation_
  - _Requirements: 2.2, 2.3, 2.4, 2.7, 6.5, 6.6_
- [x] 2.5 boot guard を初期 BLOCK 専用で設置する
  - `apply` が検証した `LAN_IFACE` を所有 state に記録し、独立 `inet vpngwgui_guard` table/set/chain を一度作成する bootstrap と初期 BLOCK を適用する systemd unit を設置する。unit は nftables 起動後かつ network-pre/Docker 起動前に実行する。
  - boot unit は初期遮断のみを担い、起動後の切替 watcher/常駐 service や Docker socket 利用を作らない。unit の有効化と guard table/chain/rule の適用を確認できない場合は `apply` を失敗させ、非対応環境として扱う。
  - 観測できる完了条件: state の記録値が unit の BLOCK batch の interface と一致し、unit が Docker より前にその interface を BLOCK にする。unit 有効化・table/chain/rule 検査が失敗すれば非0となる。remove は所有記録に一致する unit/table だけを撤去する。
  - _Boundary: host-preparation_
  - _Requirements: 2.5, 2.7, 2.8, 8.2_
- [x] 2.6 host-preparation に reboot request の固定実行基盤を設置する
  - proxy image / Compose と一致する製品専用 UID/GID `10001:10001` を予約する。ホスト `/var/lib/vpngwgui-host-ctl` は `10001:10001` / mode 0700 とし、UID/GID 10001 が既存のホスト passwd/group account に使われている場合は `check` と `apply` の双方を失敗させる。ホストに同 ID の汎用アカウントを作成しない。systemd path unit は同ディレクトリの `reboot-request` を監視する。Compose bind mount と API→proxy 接続は 2.7 が所有する。
  - proxy が作成する依頼ファイルは UID/GID `10001:10001` / mode 0600 / 内容 `vpngwgui-host-reboot-v1\n` とする。systemd service は固定の `systemctl reboot` の直前に、symlink でない通常ファイル・owner UID 10001・mode 0600・内容の完全一致を検証する。不一致時は再起動せずログに記録して要求ファイルを安全に除去する。適合時は要求ファイルを削除してから固定の `systemctl reboot` のみを実行し、依頼内容をコマンドとして解釈しない。
  - host-preparation は予約 ID の衝突検査、依頼ホスト directory の owner/mode 設定、systemd path/service の設置、および固定の `systemctl reboot` だけを担当する。Compose bind mount と API→proxy 接続は 2.7 が所有する。`remove` は Compose を `docker compose -p vpngwgui down` した後に行う。
  - 観測できる完了条件: `check`/`apply` が UID または GID 10001 の既存アカウント衝突で非0となり、適用後の directory owner/mode・path watch 先が規定どおりである。検証テストで有効依頼だけが削除後に固定再起動へ進み、symlink・非通常ファイル・誤 owner・誤 mode・誤内容はいずれも再起動せず拒否ログが出て安全に除去され、任意コマンド文字列が実行されないことを確認する。
  - _Boundary: host-preparation_
  - _Requirements: 2.6, 2.7_
- [x] 2.7 root Compose で API の reboot 要求を host-preparation の依頼先へ接続する
  - Compose は rootful Docker で動作させる。entrypoint の root 起動、`USER`/Compose `user` の削除、`su-exec` による UID/GID `10001:10001` への権限降格は 4.4 の成果に依存し、本タスクでは実装・テストしない。依頼先をホスト `/var/lib/vpngwgui-host-ctl`、proxy 内 `/var/run/vpngw-host-ctl` に統一する。ホスト dir は `10001:10001` / 0700、request file は UID/GID `10001:10001` / 0600 / 固定内容形式。root Compose は proxy だけに read-write bind mount し、API は依頼 dir を mount しない。API は `requestGatewayReboot()` から新 gateway UDS 経由で proxy `/net/host-reboot` を呼ぶ。あわせて `proxy/src/host-control/host-reboot.ts` が依頼ファイルを固定内容・mode 0600 で排他的に作成するよう改め（現行は空ファイルを作る）、そのユニットテストを置く。systemd path unit はホスト側の同一ディレクトリを監視する。
  - 認証済み API 要求から依頼ファイル作成までの経路を接続し、systemd の固定実行基盤と依頼先を一致させる。
  - 観測できる完了条件: 管理者の API 要求が proxy UDS 経由で規定の内容・owner/mode の依頼ファイルを作り、受付結果（202/既存依頼/利用不可）が API 応答で返る。ホストとコンテナのパス、mount の proxy 限定、owner/mode/content、systemd watch path が 2.6 と一致する。
  - _Boundary: Root Compose（API・proxy・host-preparation の依頼ディレクトリ接続）_
  - _Depends: 2.1, 2.6, 4.4, 4.6_
  - _Requirements: 2.6_
- [x] 2.8 host-preparation の失敗・status・remove を統合する
  - check/apply/status/remove を共通 state と接続し、部分失敗時に失敗段階・適用済み変更を表示する。
  - `status` は `.env` の `LAN_IFACE` と state の記録値を比較し、異なれば drifted と報告する。status は設定を変更せず、運用者が `apply` を再実行して一致させる。
  - remove は Compose volume を削除せず、所有差分がある対象を保持して非0で終える。
  - 観測できる完了条件: 部分失敗後に再実行でき、`.env` と記録値の相違が status に drifted と表示され、status 自体は `.env` を変更しない。status が所有対象と差分を識別し、remove が製品外設定を変更しない。
  - _Boundary: host-preparation_
  - _Depends: 2.3, 2.4, 2.5, 2.6_
  - _Requirements: 2.1, 2.3, 2.4, 2.7, 6.5, 6.6_

- [x] 2.9 Docker の FORWARD drop 防止設定を host-preparation で管理する
  - check/status で Docker version、daemon.json の所有状態、実効 FORWARD policy を表示する。Docker 28 未満と既存ファイルの競合を拒否する。
  - apply は daemon.json がない場合だけ設定を原子的に作成し、pending/applied state、Docker 再起動、起動待ち、policy 再確認を行う。remove は完全一致する製品所有ファイルだけ削除し、Docker を再起動しない。
  - PATH fixture による Docker/iptables/nft/systemctl の隔離テストを追加する。
  - _Boundary: host-preparation, README, specification_
  - _Depends: 2.3, 2.4, 2.5, 2.8_
  - _Requirements: 2.9_

## 3. Gateway Guard と Kill Switch 反映契約
- [x] 3. Gateway Guard と Kill Switch 反映契約を実装する
- [x] 3.1 Guard nft batch 生成を実装する
  - boot unit bootstrap は table/set/chain を一度作成して BLOCK にする。状態遷移 batch は既存 chain/set の flush と rules/elements のみを行い、table/set/chain を再宣言せず、LEASE の要素と drop 規則は同一 batch、OFF に drop 規則を含めない。
  - 観測できる完了条件: 単体テストで各 batch の順序・規則・OFF に drop がないことを確認できる。
  - _Boundary: Gateway guard_
  - _Requirements: 2.5, 2.8, 8.2_
- [x] 3.2 Gateway guard 状態機械と lease 更新を実装する
  - proxy を起動後の唯一の guard 切替主体とし、適用中の有効ガード値 `killSwitch && transparentGatewayEnabled` に応じて BLOCK→LEASE/OFF、LEASE↔OFF を切り替える。透過ゲートウェイ無効時は Kill Switch 値にかかわらず OFF とし、停止時保証の対象外とする。
  - 健康時のみ1秒周期で4秒 timeout lease を更新し、失敗/不健康時は更新停止、batch 失敗時は状態を変えない。GET status/監査ログに状態と最終更新を示す。
  - 観測できる完了条件: 遷移表全行、API settings を初回受信・適用するまで healthy とせず boot BLOCK を維持すること、proxy 再起動時は初回 settings 適用まで既存 state を操作せず LEASE は自然失効で drop、OFF は OFF のままであること、透過有効時だけ有効値で LEASE/OFF となること、健康前の無変更、更新失敗後の失効を単体テストで確認できる。
  - _Boundary: Gateway guard_
  - _Depends: 3.1_
  - _Requirements: 2.5, 2.8, 8.2_
- [x] 3.3 Gateway 通常停止で lease を先に失効させる
  - SIGTERM/SIGINT/SIGQUIT handler が lease 削除後に listener/server/controller を閉じる。削除失敗時も終了し、timeout に委ねる。
  - 観測できる完了条件: 単体テストで各 signal の lease 削除が close より先になり、OFF は停止時に drop を追加しない。
  - _Boundary: Gateway guard_
  - _Depends: 3.2_
  - _Requirements: 2.8, 8.2_
- [x] 3.4 API の通知直列キューを実装する
  - 起動時・10秒周期・`PUT /v1/connection/config` の3経路すべてが同じ API 所有の通知キューを通り、通知の順序を保証する。有効ガード値（`killSwitch && transparentGatewayEnabled`）変更は proxy 200 の後だけ永続化する。
  - 到達不能/503/5秒超の queue 待ち/timeout は保存せず 503 とする。Kill Switch を含む変更は `kill_switch_not_applied`、それ以外の有効値変更は `gateway_setting_not_applied`。有効値を変えない PUT は現行どおり通知失敗でも保存する。保存後の失敗は周期再通知で永続値へ戻す。
  - 観測できる完了条件: 単体・route test で3経路の順序と各成功/失敗時の保存値・HTTP status・最後に proxy に届く値を確認できる。
  - _Boundary: API 通知キュー_
  - _Requirements: 2.8_
- [x] 3.5 Gateway settings endpoint と Web Kill Switch 表示を接続する
  - proxy `POST /settings` は Gateway ruleset 適用後に guard を切替え、guard 失敗は 503 `guard_apply_failed` とする。
  - Web の Kill Switch 部品は `kill_switch_not_applied` または `gateway_setting_not_applied` で関係するトグルを元に戻す。Kill Switch は透過ゲートウェイのみ対象で、明示的プロキシのみでは停止時保証がない旨を表示する。
  - 観測できる完了条件: API・proxy・Web 統合テストで両設定の変更時に適用成功時のみ永続化され、失敗時は表示と永続値が旧値に戻ること、Kill Switch が透過ゲートウェイにのみ適用され明示プロキシのみで停止保証がない UI 表示を確認する。
  - _Boundary: Kill Switch 反映契約_
  - _Depends: 3.2, 3.4_
  - _Requirements: 2.8_

## 4. 通信 transport と認証
- [x] 4. Web/API/Gateway の通信 transport を切り替える
- [x] 4.1 Web HTTP/HTTPS listener と証明書検証を切り替える
  - `WEB_HTTPS_ENABLED` の strict boolean により HTTP を既定とし、HTTPS ON 時のみ cert/key を必須化する。不足・不正・鍵不一致は HTTP へ降格せず起動失敗。
  - 観測できる完了条件: 単体テストで OFF の証明書不要、ON の listener、異常証明書の fail closed を確認できる。
  - _Boundary: 通信 transport_
  - _Requirements: 3.1, 3.2, 3.3, 3.4_
- [x] 4.2 Web same-origin API proxy と API 内部 HTTP を構成する
  - Web→API を Compose 内 HTTP とし、ブラウザには `/api` を proxy して同一オリジンに見せる。API は host 公開せず、到達不能は 502、復旧後は証明書再生成なしで再利用する。
  - `web/package.json` にある Fastify 5 対応の最新互換 11.x（>=11.6.6）を使う。
  - 観測できる完了条件: 統合テストで `/api/v1` の prefix strip、API 不達時 502、復旧後の再要求を確認できる。
  - _Boundary: 通信 transport_
  - _Depends: 1.2, 2.1_
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
- [x] 4.3 Web HTTPS flag と Cookie Secure を連携する
  - API の session cookie Secure を `WEB_HTTPS_ENABLED` から決め、`trustProxy`/転送ヘッダーで推定しない。管理者登録・login/logout/session 認可を維持する。
  - 観測できる完了条件: 単体テストで flag true のみ Secure、X-Forwarded-Proto 単独では変化せず、既存認証シナリオが成立する。
  - _Boundary: 通信 transport_
  - _Requirements: 3.5, 3.6_
- [x] 4.4 Gateway UDS server と安全な socket ownership を実装する
  - `proxy/Dockerfile` の `USER vpngwgui` と `compose/gateway.yml` の `user: "10001:10001"` を削除し、entrypoint が root で UDS volume を整えてから `su-exec` で UID/GID 10001 へ降格する。Gateway 制御を `/run/vpngw-gateway/gateway.sock` の単一 owner に bind し、stale socket の安全な判定・除去、通常 close/unlink、再起動後の socket 再作成（proxy 側）を実装する。API 側の再接続（socket 消失・`ECONNREFUSED` を transport unavailable として報告し、指数 backoff で再接続）は API の UDS client を作る 4.5 が担当する。
  - entrypoint は root で volume を chown 10001:10001/chmod 0700 してから `su-exec` で降格し、socket mode は 0600 とする。
  - 観測できる完了条件: integration test で root entrypoint による初回 root-owned volume の初期化、`USER`/Compose `user` 削除後の起動、UID/GID 降格、権限、stale/active/不正 owner socket、socket の再作成（proxy 側）を確認できる。
  - _Boundary: 通信 transport_
  - _Depends: 1.2, 2.1_
  - _Requirements: 1.2, 5.7, 6.2, 6.7_
- [x] 4.5 API Gateway UDS HTTP/HTTPS client を実装する
  - `GATEWAY_TLS_ENABLED` 既定 OFF の HTTP over UDS と、ON 時の厳格な mTLS (CA/SAN/client cert) を実装する。誤設定・期限切れ・不一致時は降格しない。socket の消失・`ECONNREFUSED` は transport unavailable として報告し、指数 backoff で再接続する（4.4 が作る proxy 側の socket 再作成と組み合わせて、再作成後の reconnect を実 UDS で確認する）。
  - 観測できる完了条件: 単体テストで HTTP/HTTPS 選択、CA/SAN/client cert 検証、期限切れ・誤設定失敗を確認できる。TLS/保護モード不一致は専用エラーとしてログ・status・UI に区別して表示するテストを含める。
  - _Boundary: 通信 transport_
  - _Depends: 4.4_
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.8_
- [x] 4.6 Gateway listener と設定通知の lifecycle を接続する
  - Gateway（proxy）の TCP 8443 listener を除去し、UDS の HTTP/HTTPS listener と TLS options を接続する。
  - 観測できる完了条件: integration test で Gateway TCP port 不在、UDS 経由制御、保護方式不一致時の専用ログ/status/UI 表示と復旧を確認できる。
  - _Boundary: 通信 transport_
  - _Depends: 4.5, 3.2, 3.4_
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.7, 5.8, 8.1, 8.2, 8.8_

## 5. E2E と隣接テスト契約
- [x] 5. E2E と隣接テストを新しい通信契約へ追従させる
- [x] 5.1 共通 E2E API client を Web origin `/api` 契約へ更新する
  - HTTP/HTTPS scheme に応じて client を選び、HTTPS 時のみ任意 Web CA を使い、未指定時は標準 trust store を検証する。
  - 観測できる完了条件: client test が `/api/v1` を使い、API CA の必須依存を持たない。
  - _Boundary: E2E_
  - _Requirements: 4.4, 8.6_
- [x] 5.2 hosted provision/lifecycle と fixture を Compose 方式へ追従させる
  - 全 fixture lifecycle command に `-p vpngwgui` を付け、`COMPOSE_PROJECT_NAME`/`-p` の優先と他 project 名による volume 名変更を契約化する。installer fixture を Compose fixture に置換し、TLS matrix fragments、HTTP 既定、volume retention、vendor fragment の着脱を扱う。
  - 観測できる完了条件: fixture が config/up/down を実行し、`down` 後も volume が保持され、fragment 再選択で再利用される。
  - _Boundary: E2E_
  - _Depends: 2.1, 2.2, 4.1, 4.2, 4.4, 4.5, 4.6_
  - _Requirements: 1.1, 1.2, 6.1, 6.2, 6.3, 6.4, 6.7, 8.3, 8.5_
- [x] 5.3 hosted VPN 操作シナリオを新しい到達経路に更新する
  - hosted API 呼び出しを Web 公開 origin `/api` 経由にし、管理者認証、runner allowlist 拒否を維持する。mock VPN 操作としてベンダー切替、接続・切断、都市・サーバー選択、お気に入り、距離順を列挙して検証する。Gateway の通信経路・転送シナリオは 5.7 が所有する。
  - 実 VPN 資格情報を hosted CI の環境・secret・artifact に渡さない。
  - 観測できる完了条件: hosted E2E が default HTTP/no-cert 構成で login、上記の mock VPN 操作の各項目を完了し、Gateway 通信シナリオを重複して扱わず、結果が項目ごとに記録される。
  - _Boundary: E2E_
  - _Depends: 5.1, 5.2, 4.2, 4.6_
  - _Requirements: 8.1, 8.3, 8.7, 8.8_
- [x] 5.4 Web HTTPS × Gateway TLS の4構成と不正証明書を E2E 化する
  - OFF/OFF、ON/OFF、OFF/ON、ON/ON それぞれの起動と browser/API 操作を確認し、wrong CA、期限切れ、SAN 不一致、client cert 不足に加え、TLS ON/OFF mismatch を独立ケースとして fail closed とし、不一致専用ログ/status/UI 表示を確認する。
  - 観測できる完了条件: hosted browser matrix が全4行と個別の不正証明書ケースを通過し、HTTP 降格がない。
  - _Boundary: E2E_
  - _Depends: 5.2, 5.3, 4.1, 4.5_
  - _Requirements: 3.3, 3.4, 3.6, 5.3, 5.4, 5.6, 5.8, 8.4_
- [x] 5.5 hosted lifecycle と保存データ削除を E2E 化する
  - 資材更新相当・recreate・down・条件付き remove-orphans・down -v を検証し、通常操作でデータ保持、明示削除でのみ volume 削除を確認する。
  - remove-orphans は vendor fragment を先に外した結果 runner が orphan になった場合に限り、固定 project 配下の orphan であることと named volume が保持されることを確認して実行する。fragment 除外前に通常の down を行い、orphan 回復手順も確認する。
  - 観測できる完了条件: E2E が管理者/設定/favorite/audit/vendor state の保持と down -v による削除を確認する。
  - _Boundary: E2E_
  - _Depends: 5.2_
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.6, 8.5_
- [x] 5.6 vendor-live-e2e の URL/CA 前提を更新する
  - 手動実 VPN 試験は Web 公開 URL の `/api` 経由を使い、HTTPS 時のみ任意 Web CA を受け付ける。API CA 前提を除き、CI 起動拒否を保つ。
  - 観測できる完了条件: 設定・prepare・関連 test が新 URL 契約を検証し、実 VPN 資格情報は hosted CI に渡らない。
  - _Boundary: E2E_
  - _Depends: 5.1_
  - _Requirements: 8.6, 8.7_
- [x] 5.7 hosted Gateway 通信シナリオを検証する
  - 5.3 から分けた Gateway シナリオとして、透過ゲートウェイ、明示的プロキシ、DNS 中継、迂回の通常動作を列挙して hosted E2E で検証する。Kill Switch の UI は透過ゲートウェイのみを対象とし、明示的プロキシのみでは停止時保証がない旨を表示することも確認する。
  - 観測できる完了条件: 各 Gateway 通常動作と Kill Switch の対象モード表示が個別に検証され、項目ごとの結果が記録される。
  - _Boundary: E2E_
  - _Depends: 5.2, 4.6_
  - _Requirements: 2.8, 8.2_

## 6. 配布・文書・installer 撤去
- [x] 6. Compose 配布・文書へ移行し installer を撤去する
- [x] 6.1 配布 workflow を Compose bundle の公開・検査へ変更する
  - release/installer-check workflow を installer 配布から Compose 資材・`.env.example`・host-preparation 資材の配布/検査へ置換する。
  - 観測できる完了条件: workflow artifact に必要資材が含まれ、installer bootstrap が配布されない。
  - _Boundary: 配布・文書_
  - _Requirements: 7.4_
- [x] 6.2 README と steering の導入・通信契約を更新する
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
- [x] 6.3 installer の command 層・設定・bootstrap 生成・専用テストを撤去する
  - inventory.md の installer 境界に従い、installer/ 配下の setup/main/app/bootstrap/build/config command 層、設定、生成物、専用テストを削除する。root `package.json` の `test:install` を新しい host-preparation テスト runner へ変更し、`npm test` が installer 撤去後も実行できるようにする。
  - host-reboot の新しい実行経路（API→proxy→依頼ファイル→systemd）は 2.6・2.7 が所有し、本タスクは移管も実装も行わない。installer 配下の再起動関連の旧部品は、inventory.md に「旧部品と新しい所有タスク（2.6/2.7）」の対応を記録したうえで、他の installer 部品と同様に撤去だけを行う。
  - 旧 installer test を host-preparation の新テストに置き換え、対象 installer ファイルと bootstrap 生成物が存在せず、root `package.json` の `test:install` が置換後 runner を呼び、`npm test` 経由で新しい host-preparation 検査が実行されることを確認する。
  - 観測できる完了条件: installer/ の撤去対象一覧が不在で、root `package.json` の `test:install` が更新済みで、host-reboot の新経路のテストが通り、`rg` で残存 installer 参照を調査した結果が inventory.md に記録されている。
  - _Boundary: installer command・bootstrap_
  - _Depends: 1.1, 2.3, 2.5, 2.6, 2.7, 6.2_
  - _Requirements: 1.3, 1.4, 7.2_
- [x] 6.4 分離配置用 Compose fragment を撤去し root Compose へ統合する
  - inventory.md に列挙した compose/web.yml・compose/api.yml・compose/gateway.yml と関連する分離配置用設定・テストを削除し、必要な定義は root Compose に移管済みであることを確認する。
  - fragment 別検査を root Compose と vendor/TLS fragment の新しい config 検査へ置き換える。
  - 観測できる完了条件: 3つの旧 fragment と関連撤去対象が不在で、対象構成ごとの `docker compose -p vpngwgui config --quiet` が成功し、root Compose の service・volume・network・公開 port が契約どおりである。
  - _Boundary: Compose 構成_
  - _Depends: 1.1, 2.1, 2.2, 6.1, 6.2_
  - _Requirements: 1.3, 1.4, 7.2_
- [x] 6.5 遠隔配置・ペアリング・旧 PKI 経路を撤去する
  - inventory.md の remote deployment・role selection・pairing・旧 PKI 境界に基づき、該当コード、設定、証明書生成・配布経路を削除する。
  - 旧経路のテストと release-installer.yml・installer-check.yml の検査は 6.1 が所有する Compose bundle の配布・検査へ置換し、その workflow が新方式の対象資材を検査することを依存先として確認する。
  - 観測できる完了条件: inventory.md の対象ファイルが不在で、旧経路のテストが削除または新方式テストに置換され、置換後の workflow と関連 test suite が成功する。`rg` の現行参照調査結果も inventory.md に記録する。
  - _Boundary: remote deployment・pairing・旧 PKI_
  - _Depends: 1.1, 4.2, 4.5, 5.1, 5.2, 5.6, 6.1, 6.2_
  - _Requirements: 1.3, 1.4, 7.2_

## 7. Docker 導入対応とホスト準備の統合
- [x] 7. Docker/Compose 導入を含む host-preparation を実装し検証する
- [x] 7.1 CLI 引数と Docker 非依存の前提検査を分離する
  - `apply [--yes]` だけを受け付け、`--yes` は `apply` の後ろに限る。他の操作・位置・重複・余分な引数は usage error 2 とする。
  - `/dev/tty` から同意を取得し、stdin のリダイレクトを対話同意と誤認しない。tty がなく `--yes` もない場合は変更前に非0終了し `--yes` を案内する。
  - `common.sh` に OS/root/Docker 非依存コマンド/LAN_IFACE/nft 検査を集約し、Docker/Compose/version/rootful 検査を分離する。
  - 観測できる完了条件: CLI の引数表と tty の有無ごとの終了コード・出力がテストされ、Docker 未導入時も静的検査が Docker 検査と独立して実行される。
  - _Boundary: Host Preparation CLI, common preconditions_
  - _Requirements: 2.1, 2.13_
- [x] 7.2 Docker 配布元・版・Compose 状態を読み取り専用で判定する
  - Docker CE、OS 標準 docker.io、併存・その他・判定不能を区別し、daemon 稼働時と停止時の Engine 実効版、rootless/remote endpoint、Compose plugin を診断する。
  - Docker 未導入、対応する docker-ce 28 未満、対応配布元の Compose 欠落は apply 解消候補として check を合格扱いする。rootless、remote、曖昧な配布元、標準版28未満は不合格とする。
  - 観測できる完了条件: 判定 fixture の各組合せで check の終了コード、機械判定値、説明が要件どおりで、check はホスト状態を変更しない。
  - _Boundary: Docker Install read-only assessment_
  - _Depends: 7.1_
  - _Requirements: 2.1, 2.11, 2.12_
- [x] 7.3 同意後の Docker/Compose 導入・限定更新と再検査を実装する
  - 未導入時は HTTPS で公式 install script を取得し、URL/hash/副作用を表示して同意を得た後に実行する。curl、wget、どちらも無い場合の同意対象を設計どおりに扱う。
  - docker-ce 28 未満だけを更新対象とし、OS 標準版28未満や非対応配布元を自動更新しない。Compose 導入は Docker 公式、Ubuntu 標準 docker.io、Debian 12 標準 docker.io の3分岐とする。Debian repository 追加は apt simulation で Engine 削除・置換や docker-ce 導入を拒否する。
  - 導入後に rootful Engine、Compose plugin、Engine 28+ を再検査し、失敗時は Docker 以外のホスト変更へ進まず、rollback せず段階と手動確認を報告する。
  - 各導入分岐は curl/wget/sh/apt-get/dpkg-query/docker/tty をスタブ化して呼び出せるテスト可能な入口を持たせ、主要分岐の単体テストを本タスクで同時に追加する。
  - 観測できる完了条件: 成功時は再検査済みの版と導入経路が表示され、拒否・取得失敗・apt simulation 拒否・再検査失敗時は state/sysctl/guard/reboot/daemon.json が未変更である。各導入分岐を前記スタブで呼べる入口と主要分岐の単体テストが存在し、テスト runner から実行できる。
  - _Boundary: Docker Install_
  - _Depends: 7.2_
  - _Requirements: 2.10, 2.11, 2.12, 2.13, 2.14_
- [x] 7.4 apply の処理順と check/status/remove 表示を統合する
  - apply を静的検査 → Docker 判定/同意/導入 → Docker 再検査 → UID/GID 予約確認 → state 初期化 → sysctl → boot guard → reboot 基盤 → daemon forwarding の順にする。前段失敗時は後続変更へ進めない。
  - check/status は 7.2 の読み取り専用判定結果を統合して表示する。daemon.json の所有状態と実効 FORWARD policy は既存 `docker-forward.sh` の機能から取得して表示し、新たな判定ロジックを作らない。
  - remove は Docker、Compose plugin、追加 apt repository を撤去せず、Docker が残ることと必要なら手動撤去する案内を常に表示する。
  - 観測できる完了条件: PATH fixture で失敗段階ごとの後続未実行と check/status 表示が確認され、remove の出力に Docker 残置案内が含まれる。
  - _Boundary: Host Preparation CLI, Docker Install, Docker Forward, state orchestration_
  - _Depends: 7.3, 2.9_
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.9, 2.14, 2.15, 2.16, 6.5_
- [x] 7.5 README に Docker 前提・導入分岐・運用制約を反映する
  - README の記述だけを担当し、対応する Docker 配布元、Docker CE 28 未満だけの更新、標準版28未満は apply でも更新しないこと、Debian 12 の Compose 導入制約、Docker/Compose/追加 repository は remove で撤去しないこと、自動 rollback をしないことを導入手順と合わせて説明する。
  - 観測できる完了条件: README の新規導入手順と各制約が実装契約に整合し、文面レビューで運用者が手順と制約を正しく理解できる。README 契約検査の追加・更新・最終実行は 7.7 が担当する。
  - _Boundary: README documentation_
  - _Depends: 7.1, 7.2_
  - _Requirements: 7.1, 7.6_
- [x] 7.6 Docker 導入処理の網羅確認を行う
  - 7.3 で追加した分岐別単体テストを前提に、部分失敗時の停止位置と、未導入・同意拒否・tty 不在・取得/導入/再検査失敗で state や sysctl/guard/reboot/daemon.json などが未変更である保証を網羅的に確認する。
  - 全 host-preparation suite と ShellCheck を実行し、テスト runner への収録を確認する。7.3 のテスト可能入口や主要分岐の単体テストをこのタスクで新設しない。
  - 観測できる完了条件: 部分失敗・無変更保証の確認結果が揃い、`sh compose/host-preparation/tests/run.sh` と ShellCheck が成功する。
  - _Boundary: Docker Install verification_
  - _Depends: 7.3, 7.4_
  - _Requirements: 2.1, 2.10, 2.11, 2.12, 2.13, 2.14, 7.6_
- [x] 7.7 Compose bundle と README の配布検査を更新する
  - `scripts/bundle-manifest.txt` に Docker install/common 関連スクリプトと必要テスト実行資材を追加し、bundle 展開後にも apply が成立する構成を検査する。
  - `scripts/test-compose-bundle.sh` と `scripts/test-readme-contract.sh` を更新し、新規スクリプトの manifest 収録、実行権限/呼出関係、Docker 導入文書の契約を検査する。README 契約検査の最終実行も本タスクで行う。
  - 観測できる完了条件: `sh scripts/test-compose-bundle.sh` と `sh scripts/test-readme-contract.sh` が成功し、bundle 内で manifest 対象が欠落しない。
  - _Boundary: Compose bundle and static contract tests_
  - _Depends: 7.1, 7.5_
  - _Requirements: 7.4, 7.6_

## 8. 統合・受入
- [x] 8. 統合検証と実機受入を完了する
- [x] 8.1 実機受入環境を確認し手順書を作る
  - 検証サーバ `192.168.3.240` へ sshpass で接続できることと、sudo NOPASSWD を確認する。OS 種別・版が Debian 12+ または Ubuntu 22.04+ か、`nft --version` と root での `nft -c` 可否、Docker Engine と Compose v2 の有無・版、空きディスクを記録する。
  - LAN 側に使う interface と、LAN 端末役（network namespace 等）の準備・起動方法を確認する。受入資材を scp で配置する具体的な手順と配置先を記録する。
  - 受入前の初期状態を調べ、旧方式の残骸と既存の `vpngwgui` nft table・Compose volume がないことを確認する。存在する場合は影響を特定し、安全な片付け手順を記録する。
  - 検証のため新たに導入したアプリケーションは検証サーバの `~/claude-installed.md` に記録する。
  - 確認結果、実行コマンド、資材配置・初期化手順を `.kiro/specs/single-node-deployment/acceptance-env.md` にまとめる。
  - 観測できる完了条件: `acceptance-env.md` に接続、Debian 12+/Ubuntu 22.04+ の対応 OS、nftables と systemd boot guard 適用・確認可否、Docker/Compose、空き容量、LAN interface/端末役、scp、初期状態と必要時の片付け手順が具体的に記録され、8.x の実機受入タスクがこの文書の手順だけで開始できる。
  - _Boundary: 実機受入環境_
  - _Requirements: 8.3, 8.4, 8.5_
- [x] 8.2 Compose・host-preparation・通信を統合検証する
  - `scripts/deploy-verify.sh` を新構成に合わせ、Compose merge/config、固定名、公開ポート、TLS mount、UDS volume、host-preparation 実行前提を検査する。検証サーバ接続先・認証等は `acceptance-env.md` に記録された `VERIFY_HOST` 等の環境変数を使う。
  - unit/integration coverage を通し、GitHub-hosted runner 上の disposable/privileged 環境で hosted E2E を実資格情報なしで実行する。開発ホスト上では hosted E2E を実行しない。
  - _Boundary: 統合（Compose・host-preparation・通信・E2E）_
  - _Depends: 2.7, 2.8, 3.5, 4.6, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 6.3, 6.4, 6.5, 8.1, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_
  - 統合対象は次の3種類に固定し、実行したコマンドと件数を `acceptance-env.md` 隣の記録（`integration-report.md`）に列挙する: (a) `scripts/deploy-verify.sh`、(b) root `npm test`（置換後の `test:install` を含む）、api/web/proxy の各パッケージの `package.json` にある unit/integration テストスクリプト全部、(c) 5.3〜5.5 および 5.7 の GitHub-hosted runner 上の hosted E2E spec 全部（5.6 の vendor-live-e2e は実資格情報が要る手動試験のため対象外とし、その設定・prepare の関連 test は (b) に含める）。
  - 観測できる完了条件: `scripts/deploy-verify.sh`、root `npm test`（置換後 `test:install` を含む）、unit/integration テスト一式、GitHub-hosted runner 上の5.3〜5.5・5.7 の hosted E2E spec が通り、生成 API client は公式生成手順で更新されている。
  - _Requirements: 2.5, 2.6, 2.8, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_
- [x] 8.3 検証サーバで nft guard の構文・評価順・遮断経路を受け入れる
  - acceptance-env.md の手順で資材を配置し、Debian 12+ または Ubuntu 22.04+ の nft/kernel で batch を `nft -c` 検証後に適用する。
  - 同一の状態遷移 batch を対象 OS 上で繰り返し適用して成功することを確認する。timeout set の追加・更新・4秒自然失効、priority -1 return と priority 0 評価、DNAT 済み・DNS redirect 後・迂回・VPN 転送を含む遮断、Gateway table 再作成後の guard 維持を個別に確認し、コマンド・結果・時刻を記録する。
  - 観測できる完了条件: 構文検証成功、timeout/評価順の結果、各遮断経路の pass/fail と guard 維持が受入記録に残り、設計条件を満たす。
  - _Boundary: 統合受入（検証サーバ nft guard）_
  - _Depends: 8.1, 8.2, 7.7_
  - _Requirements: 2.5, 2.8, 8.2_
- [x] 8.4 検証サーバで Kill Switch 停止時の遮断と変更拒否を受け入れる
  - acceptance-env.md の手順で資材を配置し、Kill Switch true/false の各条件で SIGKILL・Gateway hang・通常停止を実施する。
  - 遮断時刻を測定し、透過ゲートウェイ有効かつ Kill Switch true は全停止経路で6秒以内、通常停止は Gateway 終了前に遮断されることを確認する。透過有効かつ Kill Switch false は停止後も guard が遮断しないことを確認する。
  - proxy 停止中の `killSwitch` / `transparentGatewayEnabled` PUT が effective 値を変える場合に503となり永続値不変であること、Kill Switch を含む場合の `kill_switch_not_applied`、proxy 再開後の再試行を記録する。
  - 観測できる完了条件: 透過ゲートウェイ有効時の各停止方式・Kill Switch 値の実測時刻、6秒上限と通常停止順序、proxy 停止中の有効値変更に対する503/永続値/再開後反映の結果が受入記録にあり、全条件を満たす。
  - _Boundary: 統合受入（検証サーバ Kill Switch）_
  - _Depends: 8.1, 8.2, 8.3, 7.7_
  - _Requirements: 2.8, 8.2_
- [x] 8.5 検証サーバで Compose lifecycle とホスト準備を受け入れる
  - acceptance-env.md の手順で資材を配置し、初回起動・更新・停止・再作成・`down -v` と vendor fragment の除外・再追加を実施する。
  - 管理者・設定・お気に入り・監査ログ・vendor state の保持、通常 down での volume 保持、`down -v` での明示削除を確認する。
  - Docker 導入済みの既存 `acc-vpngwgui` は導入済み環境の確認専用とし、Docker 導入処理の受入には使わない。検証サーバ上に Docker 未導入の Ubuntu LXD 新容器を作成し、初期状態を確認してクリーンスナップショットを取得する。導入試験の各独立 run はそのスナップショットへ戻して行い、準備方法・container 名・snapshot 名・Docker 未導入の確認結果を `acceptance-results.md` に記録する。
  - Docker 未導入環境で `apply` による Docker 導入から Engine/Compose/28+ 再検査、以降の host-preparation、boot guard まで受け入れる。結果には公式取得元 URL、取得したスクリプトの SHA-256 表示、対話同意または `--yes` の選択、導入後の Engine 版・Compose 状態・rootful 再検査結果、以降の各 host-preparation 段階の結果を記録する。既存 `acc-vpngwgui` の導入済み環境での比較確認結果も区別して記録する。
  - host-preparation の apply/status/remove の状態・所有差分と、boot guard が nftables 後かつ network-pre/Docker 前に BLOCK を適用する起動順を確認する。host-preparation `remove` は必ず `docker compose -p vpngwgui down` 後に実施する。
  - 観測できる完了条件: lifecycle ごとのデータ保持/削除、vendor fragment の再追加、Docker 未導入 snapshot からの導入結果と上記記録項目、導入後の apply/status/remove の結果、boot guard 起動順が受入記録にあり、製品外設定を変更しない。
  - _Boundary: 統合受入（検証サーバ Compose・host-preparation）_
  - _Depends: 8.1, 8.2, 5.5, 7.7_
  - _Requirements: 2.5, 2.7, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 8.3, 8.5, 8.9_
- [x] 8.6 検証サーバで Web HTTPS × Gateway TLS の4構成を受け入れる
  - acceptance-env.md の手順で資材を配置し、OFF/OFF、ON/OFF、OFF/ON、ON/ON の起動と管理画面/API 操作を行う。
  - wrong CA、期限切れ、SAN 不一致、client cert 不足を個別に与え、TLS 有効区間で接続が失敗し HTTP/平文へ降格しないことを確認する。
  - 観測できる完了条件: 4構成の起動・操作結果と各不正証明書ケースの失敗理由が受入記録にあり、無断降格がない。
  - _Boundary: 統合受入（検証サーバ TLS）_
  - _Depends: 8.1, 8.2, 5.4, 7.7_
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.1, 5.1, 5.2, 5.3, 5.4, 5.6, 5.7, 8.4_

## 設計へ戻す事項

- 現時点で、要件・design.md・research.md 2026-11-18 決定の間に、タスク計画を止める未解決の矛盾は見つからなかった。6秒上限、nft timeout 実効値、TLS 4構成は設計上の未実測リスクとして明示され、検証サーバ受入タスクに割り当てた。

## 要件網羅表

番号は 2026-11-19 の振り直し後の現行番号（要件・タスクとも）。各タスクの `_Requirements:` を逆引きした表。要件ID | タスク（本ファイルのタスク番号）。

| 要件ID | タスク |
|---|---|
| 1.1 | 2.1, 5.2, 6.2 |
| 1.2 | 2.1, 4.4, 5.2 |
| 1.3 | 1.1, 6.2, 6.3, 6.4, 6.5 |
| 1.4 | 1.1, 6.2, 6.3, 6.4, 6.5 |
| 1.5 | 2.1 |
| 2.1 | 2.3, 2.8, 7.1, 7.2, 7.4, 7.6 |
| 2.2 | 2.4, 7.4 |
| 2.3 | 2.3, 2.4, 2.8, 7.4 |
| 2.4 | 2.3, 2.4, 2.8, 7.4 |
| 2.5 | 2.5, 3.1, 3.2, 8.2, 8.3, 8.5 |
| 2.6 | 2.6, 2.7, 8.2 |
| 2.7 | 2.3, 2.4, 2.5, 2.6, 2.8, 8.5 |
| 2.8 | 1.2, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 5.7, 8.2, 8.3, 8.4 |
| 2.9 | 2.9, 7.4 |
| 2.10 | 7.3, 7.6 |
| 2.11 | 7.2, 7.3, 7.6 |
| 2.12 | 7.2, 7.3, 7.6 |
| 2.13 | 7.1, 7.3, 7.6 |
| 2.14 | 7.3, 7.4, 7.6 |
| 2.15 | 7.4 |
| 2.16 | 7.4 |
| 3.1 | 2.2, 4.1, 8.2, 8.6 |
| 3.2 | 2.2, 4.1, 8.2, 8.6 |
| 3.3 | 2.2, 4.1, 5.4, 8.2, 8.6 |
| 3.4 | 4.1, 5.4, 8.2, 8.6 |
| 3.5 | 4.3, 8.2 |
| 3.6 | 4.3, 5.4, 8.2 |
| 4.1 | 4.2, 8.2, 8.6 |
| 4.2 | 1.1, 4.2, 8.2 |
| 4.3 | 1.1, 2.1, 4.2, 8.2 |
| 4.4 | 1.1, 4.2, 5.1, 8.2 |
| 4.5 | 4.2, 8.2 |
| 4.6 | 4.2, 8.2 |
| 5.1 | 2.2, 4.5, 4.6, 8.2, 8.6 |
| 5.2 | 2.2, 4.5, 4.6, 8.2, 8.6 |
| 5.3 | 4.5, 4.6, 5.4, 8.2, 8.6 |
| 5.4 | 4.5, 4.6, 5.4, 8.2, 8.6 |
| 5.5 | 4.5, 4.6, 8.2 |
| 5.6 | 2.2, 4.5, 5.4, 8.2, 8.6 |
| 5.7 | 1.2, 2.1, 4.4, 4.6, 8.2, 8.6 |
| 5.8 | 2.2, 4.5, 4.6, 5.4, 8.2 |
| 6.1 | 5.2, 5.5, 6.2, 8.2, 8.5 |
| 6.2 | 2.1, 4.4, 5.2, 5.5, 8.2, 8.5 |
| 6.3 | 2.1, 5.2, 5.5, 8.2, 8.5 |
| 6.4 | 2.1, 5.2, 5.5, 6.2, 8.2, 8.5 |
| 6.5 | 2.3, 2.4, 2.8, 6.2, 7.4, 8.2, 8.5 |
| 6.6 | 2.4, 2.8, 5.5, 6.2, 8.2, 8.5 |
| 6.7 | 2.1, 4.4, 5.2, 8.2, 8.5 |
| 7.1 | 6.2, 7.5 |
| 7.2 | 1.1, 6.2, 6.3, 6.4, 6.5 |
| 7.3 | 6.2 |
| 7.4 | 6.1, 7.7 |
| 7.5 | 6.2 |
| 7.6 | 7.5, 7.6, 7.7 |
| 8.1 | 4.6, 5.3, 8.2 |
| 8.2 | 1.2, 2.5, 3.1, 3.2, 3.3, 4.6, 5.7, 8.2, 8.3, 8.4 |
| 8.3 | 5.2, 5.3, 8.1, 8.2, 8.5 |
| 8.4 | 5.4, 8.1, 8.2, 8.6 |
| 8.5 | 5.2, 5.5, 8.1, 8.2, 8.5 |
| 8.6 | 1.1, 5.1, 5.6, 8.2 |
| 8.7 | 5.3, 5.6, 8.2 |
| 8.8 | 4.6, 5.3, 8.2 |
| 8.9 | 8.5 |

## Implementation Notes
- 2.9: Docker forwarding handler は `/etc/docker/daemon.json` が存在しない場合のみ作成し、再起動後も policy が DROP なら pending state を残して失敗する。remove は再起動を行わない。実ホストへの systemctl/Docker 操作は実行せず、PATH fixture で検証する。
- 2.2: 設計表の API クライアント証明書の環境変数名（`GATEWAY_TLS_CLIENT_CERT_FILE`/`GATEWAY_TLS_CLIENT_KEY_FILE`）と、現行 API loader（`api/src/proxy-client/gateway-tls-options.ts`）の名前（`GATEWAY_TLS_CERT_FILE`/`GATEWAY_TLS_KEY_FILE`）が異なる。`compose/api-tls.yml` は両方を設定済み。4.5/4.6 で loader 側の名前を設計に統一し、統一後は片方の設定を外す。
- 実装補助: 開発ホストの対話シェルの `rg` は関数で、`sh` スクリプトからは使えない。リポジトリのスクリプトは `grep -F` などの POSIX 道具だけを使う。仕様文書（`.kiro/specs`）をテストが読まない。
- 2.3（host-preparation 共通方針）: 本番スクリプトに環境変数での検査回避・パス差し替えを作らない。パスは `compose/host-preparation/paths.sh`（本番値）に集約し、テストは CLI 一式を一時ディレクトリへコピーして `paths.sh` を書き換えて実行する。コマンドの差し替えは PATH の fixture だけで行う。状態ファイル・ディレクトリは symlink／通常ファイル以外を変更前に拒否し、新規作成は検証済みディレクトリ内の一時ファイルから `ln`（上書きしない）で配置する。`apply` が使うコマンドは `check` の必須コマンド一覧に含める。`apply` は boot guard（2.5）が入るまで状態初期化の後に非0で終わり、`status`/`remove` の実体は 2.8 が担当する。
- 2.5（boot guard）: state の `boot_guard` 記録は `interface` と、保留中だけ `previous_interface` を持ち、状態は `pending`→`applied`。`status`/`remove` の統合（2.8）はこの記録を読む。guard unit は `RequiredBy=docker.service` で Docker の必須依存にし、失敗時は Docker が起動しない。実機の nft の出力（`expires` の残り時間付き要素を含む）と systemd の挙動は 8.3/8.5 で確認する。`npm run test:e2e-unit` は古い作業ツリー（`.claude/worktrees/dev-add-branch-release-workflow`）の複製テストを拾いポート競合するため、`--maxWorkers=1` で実行するか作業ツリーを整理する。
- 3.2（Gateway guard）: `GatewayGuard.applySettings(next, applyGatewayRuleset)` は Gateway ruleset を先に適用し、その後に guard batch を適用する（両方向）。`ReconcileOutcome.succeeded`（適用と検証の成否。正常な撤去を含む）と `applied`（有効な ruleset の有無）を区別する。ruleset 適用結果は `GatewayControllerOptions.onReconcileResult` で guard の健康に反映される。`GET /net/status` に guard 状態が入り、API の `GatewayStatusSchema` を更新済み。Web の生成クライアントは 8.2 で公式手順により再生成する。3.3 は停止時の lease 削除、3.5 は `POST /settings` の 503 `guard_apply_failed` と Web 表示、4.6 は UDS listener の健康との接続を担当する。
- 3.3（停止時の遮断）: 停止処理は 新規 guard 作業の停止 → lease 失効（最後の guard 変更）→ 監視・明示プロキシ・DNS 中継の停止 → server close → exit の順で、全体 2 秒の期限を持つ。成功時の終了コードは 143/130/131（従来の既定のシグナル終了と同じ）、失敗・期限超過は 1。Gateway の nft ruleset は停止時に撤去しない（lease 失効後は Kill Switch 有効なら BLOCK、無効なら drop を足さない）。SIGKILL・hang は 8.4 の受入で確認する。
- 3.4（API 通知キュー）: 起動時・10 秒周期・PUT は `SettingsNotificationQueue`（api/src/settings/settings-notification-queue.ts）の1本の FIFO を通る。5 秒の待機上限は、`killSwitch`/`transparentGatewayEnabled` に触れる PUT のうち、見込み設定で有効ガード値が変わる、または先行の未完了のガード PUT がある場合にだけ付く（それ以外は上限なしで順番に保存）。通知するか先に保存するかの判断は、常にキュー先頭で実際の永続設定から取り直す。proxy 側の `POST /settings` の 503 `guard_apply_failed` と Web の表示は 3.5 が担当する。
- 3.5（settings endpoint と Web 表示）: proxy `POST /net/settings` の 200 応答は `succeeded`（適用と検証の成否。無効化の撤去を含む）と実効状態 `applied` を返し、API は HTTP status と `succeeded === false` で判断する（`applied` では判断しない。`succeeded` が無い旧 proxy の 200 は成功）。本文の読み取りは abort/close/error と 4 秒の期限で終わり、設定要求の待ち行列は失敗・切断のあとも進む。Web の SettingsDialog は `kill_switch_not_applied` と `gateway_setting_not_applied` でトグルを戻して表示する。Web の生成クライアントの再生成は 8.2。
- 4.1（Web listener）: `web/server/index.ts` の `startWebServer(env, listenOptions)` が listener を選ぶ。`WEB_HTTPS_ENABLED` 未設定/`false` は証明書なしの HTTP、`true` だけが証明書・鍵を必須にした HTTPS で、不正値・証明書の不備・鍵の不一致は HTTP に降格せず起動失敗にする。試験用の使い捨て証明書は `web/server/testdata/`（README に明記、本番経路は読まない）。Web→API の既定 upstream は HTTP（`/api` の proxy の挙動と 502 は 4.2）。
- 4.2（同一オリジン API 中継）: API の起動は `api/src/main.ts`（副作用あり）と `startApiServer`（`api/src/server.ts`、副作用なし）に分け、コンテナの `CMD` は `dist/main.js`。API は証明書なしの内部 HTTP（0.0.0.0:`PORT`）で、ホストには公開しない。API サーバ用の TLS loader（`api/src/tls-options.ts`）は削除済み。`compose/api.yml` は旧分離配置の部品で 6.4 が撤去する。
- 4.3（Cookie Secure）: API の session Cookie の `Secure` は `WEB_HTTPS_ENABLED` だけで決める（`api/src/web-https-options.ts` の `parseWebHttpsEnabled`。未設定/`false`/`true` のみ。それ以外は listen 前に起動失敗。Web サーバと同じ規則）。`trustProxy` や `X-Forwarded-Proto` では判断しない。
- 4.4（Gateway UDS）: `proxy/src/gateway-channel/server.ts` の `listenOnGatewaySocket(server, socketPath, expectedUid)` が UDS を umask 0177 で bind し（mode 0600）、stale 判定は connect の `ECONNREFUSED` のみ・削除前に dev/ino を再確認、`close()` は自分が作った inode だけを消す。`compose/gateway-entrypoint.sh` は root で `/run/vpngw-gateway` を検証（symlink・非ディレクトリ・root/10001 以外の owner は拒否）してから `chown 10001:10001`・`chmod 0700` し、`su-exec 10001:10001` へ `exec` する。実コンテナの検証は opt-in の `proxy/tests/gateway-entrypoint.docker.test.sh`（Docker が使える環境で実行。8.5 でも実施）。TCP 8443 listener と `GATEWAY_PORT` は 4.6 で除去済み。API 側の再接続（指数 backoff）は 4.5 の担当（tasks.md を更新済み）。`ctl-socket` の書き込み権限は `proxy/Dockerfile` の `/var/run/vpngw-ctl`（vpngwgui 所有）を空の名前付き volume が引き継ぐことに依存する。
- 4.5（API の Gateway UDS client）: `loadGatewayTransportOptions` が `GATEWAY_TLS_ENABLED` 既定 OFF の HTTP over UDS と、ON 時の厳格な mTLS（CA・SAN・クライアント証明書・期限。降格しない）を選ぶ。`requestGateway` は socket 消失・`ECONNREFUSED` を通信不可として扱い、上限つきの指数 backoff で再接続する。`notifySettings` は backoff・接続・headers・body を合わせた1つの 5 秒の総期限を持ち、期限切れは `ProxyTimeoutError`（504）。保護方式の不一致は、要求後に接続が切れたとき同じ UDS へ TLS の probe を送り、TLS と確認できたときだけ `GatewayProtectionMismatchError`（`gateway_protection_mismatch`、`protectionModeMismatch: true`）にして、ログ・API status・Web 表示で区別する。`api/openapi.json` と `web/src/generated` は git 管理外の生成物で、4.5 で `npm run generate:api-client` を実行して最新にした（8.2 でも再生成して確認する）。環境変数名は設計の名前（`GATEWAY_TLS_CLIENT_CERT_FILE` など）に統一済み。
- 4.6（Gateway listener の切替）: Gateway の TCP 8443 listener と `GATEWAY_PORT` は除去済みで、制御は UDS の listener（HTTP、または `GATEWAY_TLS_ENABLED=true` の strict mTLS）だけ。proxy の設定・status の本番ハンドラは `proxy/src/gateway-channel/gateway-routes.ts` の `createGatewayRequestHandler`（依存を注入）に切り出してあり、`proxy/src/server.ts` が本物のコントローラを渡す。guard の健康は「UDS listener が稼働」かつ「直近の ruleset 適用と検証が成功」の両方（`GatewayGuard.setListenerAvailable`）。listener が予期せず閉じたら guard を unhealthy にして非 0 で終了し、Compose の再起動に任せる。統合テストは `e2e/gateway-control.integration.test.ts`（実 UDS・実 API client で HTTP/mTLS、保護方式不一致の status とログと復旧）。`npx tsc -p web/tsconfig.json --noEmit` の `city`/`pingMs` に関する8件のエラーは、このスペック以前からあるもので触っていない。
- 2.7（再起動要求の配線）: proxy の `requestHostReboot()` は、同じディレクトリに隠し一時ファイル（`.reboot-request.tmp.<数字>.<32 桁の hex>`、`O_EXCL|O_NOFOLLOW`・mode 0600）へ固定内容を書いて fsync し、排他的なハードリンクで `reboot-request` として公開する（先に存在すれば already-requested）。proxy は自分の古い一時ファイル（60 秒超）を次の要求で片付ける。ホスト準備の precheck/remove/status は、この名前の形に完全一致する通常ファイル（所有者 10001・mode 0600）だけを製品所有の残骸として片付け可能と扱い、それ以外は競合のまま。root Compose の proxy だけが `/var/lib/vpngwgui-host-ctl` を `/var/run/vpngw-host-ctl` に mount する。`package.json` の `test:e2e-unit` は `.claude` と `node_modules` を除外する（古い作業ツリーの複製テストとのポート競合を避けるため）。実機の systemd・Docker 動作は 8.5。
- 5.1（E2E 共通 API client）: `e2e/common/api-client.ts` の `createApiClient` は Web origin（HTTP/HTTPS はスキームで選ぶ）の `/api/v1` に要求し、HTTPS の CA は任意の Web CA（未指定は標準 trust store。自己署名は拒否）。API CA への依存はない。既存の呼び出し側は、API の origin と API CA のパスを渡す旧い形のままで、5.2〜5.6 が移行する: `e2e/hosted/fixtures/stack.ts`・`e2e/hosted/specs/api/auth.spec.ts`・hosted の他の spec は 5.2/5.3/5.7（Web 公開 origin の `/api` 経由へ）、`e2e/vendor-live/lib/prepare.ts`・`config.ts` は 5.6。それまで hosted E2E は新旧の混在で動かない（5.2 が fixture を Compose 方式にするまでの途中状態）。
- 5.2（hosted の Compose fixture）: `e2e/hosted/fixtures/compose.ts` が全操作に `-p vpngwgui` を付け（`COMPOSE_PROJECT_NAME`/`-p` が `name:` より優先されること、別名では volume 名が変わることを `docker compose config` で契約テスト）、root-first の `-f` merge（vendor fragment、`compose/web-tls.yml`、`compose/api-tls.yml`）、既定 HTTP、up/down/`down -v` を提供する。起動は `e2e/hosted/fixtures/compose-cli.ts` を通る共通の経路（`provision.sh` もここを使う）で、注入した runner の引数をテストする。`e2e/hosted/lib/cleanup.sh` が EXIT/INT/TERM/HUP で固定 project の down（`-v` なし）と topology の後始末をする。volume 保持は実 Docker の統合テスト `e2e/hosted/fixtures/volume-retention.integration.test.ts`（既存の `vpngwgui*` 資源があれば skip。作った volume だけ後始末）で確認済み。実スタックの Playwright は hosted CI（と 8.x の実機受入）で実行する。hosted workflow のブランチ trigger は変えていない。
- 5.3（hosted VPN 操作）: `e2e/hosted/specs/api/{vpn,locations}.spec.ts` は Web origin `/api` の共通 client で、ベンダー切替・接続・切断・都市/サーバー選択・お気に入り・距離順を項目別のケースにした。接続のケースは `finally` で必ず切断する。runner の許可リストの拒否は、runner の制御 UDS へ許可コマンドと許可外コマンドを送り、200 と 403 `binary_not_allowed` を確認する独立ケース。hosted Playwright は開発ホストでは実行しておらず（型検査・`--list`・独立レビューのみ）、実行は hosted の CI で行う。
- 5.7（hosted Gateway 通信）: 透過ゲートウェイ・明示的プロキシ・DNS 中継・迂回は `e2e/hosted/specs/gateway/*.spec.ts` の独立したケースで、Web origin `/api` の共通 client を使う。Kill Switch の対象範囲の表示（透過ゲートウェイのみ。明示的プロキシのみでは停止時の遮断を保証しない）は `web/src/components/dashboard/SettingsDialog.tsx` にあり、`e2e/hosted/specs/ui/setup-settings.spec.ts` のケースで確認する（接続設定を保存し、`finally` で復元して API セッションを破棄する）。hosted の実行は CI。
- 5.4（hosted TLS matrix）: `e2e/hosted/specs/tls/tls-matrix.spec.ts`（Playwright の `tls` project）が Web HTTPS × Gateway TLS の4構成を、各行でログイン・Gateway 状態（`gatewayGuard` を含む正常応答＝TLS ON 行では実際の mTLS）・元に戻せる制御 PUT・Cookie の `Secure`（HTTPS 行のみ）で確認する。不正証明書のケースは、壊すのを1か所だけにする（別 CA ＝ proxy の server 証明書だけを無関係な CA 署名のものに差し替え、期限切れ、SAN 不一致、クライアント証明書なし＝API の client cert/key 設定だけを空）。各ケースは Compose の起動結果（終了コード・コンテナ状態・ログ）を `docker-compose-result.ts` で構造化して期限つきで確認し、API ログの原因コード（`gateway_tls_validation_failed`）と保護方式の不一致（専用 status・ログ・UI）も確認する。証明書は実行ごとに `e2e/hosted/lib/tls-matrix-certs.sh` で生成し、単体テスト `tls-certs.test.ts` で実 OpenSSL により検証済み。4.5 の追補として、API の TLS loader が不足した環境変数名（名前のみ）を示す変更と、`proxy-client` が TLS 検証失敗の原因コードを構造化して警告ログに出す変更を、別 commit で入れた。hosted の実行は CI。
- 5.5（hosted lifecycle）: `e2e/hosted/specs/lifecycle/lifecycle.spec.ts` は、実際の hosted スタックで 資材更新相当（build + up -d）・recreate・通常 down + up・ベンダー別ファイルの取り外し（Proton だけを外し、通常 down のあとで、孤立するのが Proton の runner だけであることを project/service ラベルで確認してから `up -d --remove-orphans`。AdGuard の runner と状態、全 named volume、アプリデータが残る）・再取り付け（状態と volume を再利用）・`down -v`（全 named volume が消え、次の up は初期状態）を `test.step` ごとに確認する。ベンダー別の mock Compose fragment は `e2e/hosted/vendors/{protonvpn,adguardvpn}/compose.yml`。`compose.ts` に `composeBuildAndUp`・`composeRecreate` を追加。hosted の実行は CI。
- 5.6（vendor-live）: `e2e/vendor-live/lib/config.ts` の `parseConfig` は `webBaseUrl`（Web の公開 URL。`/api` を付けない。HTTP/HTTPS）と任意の `webCaPath`（HTTPS で証明書がシステムに信頼されていないときだけ）を読み、旧キー `apiBaseUrl`/`caPath` は値を出さずに拒否して移行先を案内する。`probeApi` は 5.1 の共通 client（Web origin の `/api`）を使う。CI からの起動拒否は維持し、hosted の workflow には vendor-live の環境・資格情報を渡さない。作業者の手元の `e2e/vendor-live/config.local.json`（git 管理外）は旧キーのままなので、新しいキーへの書き換えが必要（README に手順）。
- 6.2（README と steering）: README は 導入（`.env` と `LAN_IFACE` → `host-preparation.sh check` → `apply` → `docker compose -p vpngwgui config --quiet` → `up -d --build`）・更新（新しい配布物の全体を展開し、`.env` と作業者が置いた証明書を残す → `apply` → `config --quiet` → `up -d --build`。`pull` は使わない）・停止削除（`docker compose -p vpngwgui down` の後に host-preparation `remove`。`down -v` は保存データを消す）を、全 Compose コマンドに `-p vpngwgui` を付けて書く。対応環境（Debian 12+/Ubuntu 22.04+、rootful のローカル Docker）、TLS の既定（Web HTTPS・API→Gateway TLS とも OFF）と有効化の手順、Kill Switch の対象（透過ゲートウェイのみ）、旧方式の移行は非対応、を記す。`scripts/test-readme-contract.sh` が節ごとに順序と事実を確認し、壊した README を拒否する自己検査を持つ。steering の roadmap は、完成後の姿（installer 撤去後）で書き、6.3 の撤去前は旧資材がチェックアウトに残ることを区別している。
- 6.3（installer 撤去）: `installer/` の8ファイル（setup/main/app/bootstrap の生成/config schema/専用テスト）を撤去済み。root `package.json` の `test:install` は `sh compose/host-preparation/tests/run.sh`（ホスト準備の6つのシェルテストを実行し、1つでも失敗すれば失敗）を呼び、`npm test` から実行される。`scripts/check-vendor-neutrality.mjs` の検査対象から `installer` を外した（`compose/` は引き続き対象）。撤去後の残存参照調査は `inventory.md` に実行した検索コマンドと範囲を含めて記録した。旧い再起動の部品は撤去のみで、新しい経路は 2.6/2.7 が担う。
- 6.4（分離配置用 Compose の撤去）: `compose/web.yml`・`compose/api.yml`・`compose/gateway.yml` を撤去済み。各定義は root `docker-compose.yml`（proxy の host network・`NET_ADMIN`・`init`・restart・socket volume・ホストの依頼用 bind mount・環境変数の既定）に引き継ぎ済みで、旧い installer 前提の設定（PKI の mount、TCP の制御ポート、役割ごとの分離）は引き継いでいない。`scripts/test-compose-contract.sh`・`scripts/test-compose-tls-contract.sh` は root と vendor/TLS 構成の組み合わせごとに `docker compose -p vpngwgui config --quiet` と、service・volume・network・公開 port の契約を確認する。
- 6.5（遠隔配置・ペアリング・旧 PKI の撤去）: 製品のコード・設定・スキーマ・生成スクリプト・テストに、遠隔配置・役割選択・ペアリング・旧 PKI の経路は残っていない（`api/src/server.test.ts` から旧 API TLS/PKI の環境名を除去。調査の検索コマンドと範囲は `inventory.md`）。`scripts/deploy-verify.sh` は旧い遠隔配置（SSH で作業ツリーを転送、素の `docker compose`）の流れが残っており、タスク 8.2 が配布物（Compose bundle）と host-preparation に基づく検証へ置き換え、8.2 の完了後に再調査して記録する。
- 8.1（実機受入環境） 受入は検証サーバ（192.168.3.240）上の LXD システムコンテナ `acc-vpngwgui`（利用者の決定。共有サーバの既定経路を変えずに、VPN 転送を含む全経路を確かめるため）で行う。作成済み（Ubuntu 24.04、入れ子の Docker・nftables・netns が動作）。手順・競合経路表（ホスト準備が使う固定経路と一時ファイルの名前）・読み取り専用の初期状態確認・8.3〜8.6 の試験手順は `acceptance-env.md`。サーバ本体の旧方式の導入（`vpngwgui` の Compose project など）は触らない。結果は `acceptance-results.md`（8.3〜8.6 で作る）に記録する。作業の終わりにはコンテナを削除する（`dir` の storage pool は容量を共有しないため）。

## 番号の振り直し（2026-11-19）

| 旧番号 | 新番号 |
|---|---|
| 7.1 | 8.1 |
| 7.2 | 8.2 |
| 7.3 | 8.3 |
| 7.4 | 8.4 |
| 7.5 | 8.5 |
| 7.6 | 8.6 |
| 8.1 | 7.1 |
| 8.2 | 7.2 |
| 8.3 | 7.3 |
| 8.4 | 7.4 |
| 8.5 | 7.5 |
| 8.6 | 7.6 |
| 8.7 | 7.7 |
