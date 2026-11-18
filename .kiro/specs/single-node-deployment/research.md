# Research & Design Decisions

## Summary
- **Feature**: single-node-deployment
- **Discovery Scope**: Complex Integration / full discovery。既存の導入・内部通信・ホスト制御と E2E の契約をまとめて変更する。
- **Consulted Skills**: kiro-spec-design の design-principles / design-discovery-full / design-synthesis / design-review-gate、既存 discovery/requirements の記録。
- **Key Findings**:
  - root Compose は services:{}。vendor fragment は runner だけでなく API の cache mount を追加するため、単純な Compose include では同名サービスの衝突が起きる。
  - API/proxy は UID/GID 10001。専用の filesystem UDS を共有すれば、HTTP と HTTPS/mTLS の両方で host/bridge の差を吸収できる。既存 Undici/Node の契約で可能。
  - 現在の Gateway に停止ハンドラーはなく、host network 上の nft 規則はプロセス終了後も残り得る。要件2.8には独立した停止検知と遮断の契約が必要。
  - Web HTTPS の設定を API の Cookie 判定にも渡せば、転送ヘッダーへの新しい信頼を追加せず内部 HTTP 化できる。
- **Validation Scope**: コード・型定義・公式資料の読み取り。新構成の実機起動・通信試験は未実施。

## Research Log

### 既存の導入・永続化
- **Context**: 旧インストーラの役割分離を廃止し、Compose を直接使う。
- **Sources Consulted**: docker-compose.yml、compose/*.yml、vendors/*/compose.yml・entrypoint.sh、installer/setup.sh・main.sh、e2e/hosted/lib/provision.sh。
- **Findings**: root は空のアンカーで、setup が role/vendor の COMPOSE_FILE を生成する。vendor の API cache volume 追加は通常の複数 Compose ファイルの merge を前提とする。runner は host network のまま machine-id とログイン用 volume を保存している。
- **Implications**: root へ Web/API/proxy の定義を集め、役割別 fragment を撤去する。vendor fragment は宣言境界に残し、運用者が標準の -f または COMPOSE_FILE で選択する。インストーラによる生成は不要。固定 project 名で更新時の volume 別環境化を防ぐ。runner の bridge 化や MAC 設計は多段接続側へ残す。

### Compose merge と include
- **Sources Consulted**: [Merge Compose files](https://docs.docker.com/compose/how-tos/multiple-compose-files/merge/)、[Compose include](https://docs.docker.com/reference/compose-file/include/)。
- **Findings**: -f/COMPOSE_FILE は同一モデルへ merge し、相対パスは先頭ファイル基準。include は独立モデルのリソースを取り込み、同名リソースを従来の -f のようには merge しない。
- **Implications**: 新しい generator や vendor 固有コード分岐を設けず、既存 bundle の API mount も通常の merge で維持する。複数ファイルは同じノードのベンダー選択であり、役割の別ホスト配置ではない。

### API→Gateway の UDS と TLS
- **Sources Consulted**: api/src/proxy-client/proxy-client.ts、gateway-tls-options.ts、proxy/src/server.ts・gateway-channel/tls-options.ts、local node_modules/undici/types/connector.d.ts・lib/core/connect.js、[Undici Connector](https://undici.nodejs.org/api/Connector)、[Node 22 TLS](https://nodejs.org/docs/latest-v22.x/api/tls.html#tlsconnectpath-options-callback)、[Node IPC lifecycle](https://nodejs.org/docs/latest-v22.x/api/net.html#identifying-paths-for-ipc-connections)。
- **Findings**: Undici connect.socketPath は Node net/tls.connect の path に渡される。HTTP/HTTPS の origin は論理名とし、接続先は filesystem UDS に固定できる。TLS の servername は SAN と一致させる必要がある。通常 close では UDS は削除されるが異常終了時の stale socket は残る。
- **Implications**: API/proxy のみ専用 volume を共有し、runner の ctl-socket と分離する。Gateway TCP 制御口は TLS ON でも公開しない。UID 10001 の親0700/socket0600を基準に、重複起動・stale cleanup・再接続を設計する。

### Web HTTPS、Cookie と proxy 依存
- **Sources Consulted**: web/server/index.ts・tls-options.ts、api/src/routes/operator.ts・operator-session.ts、auth/session-store.ts、[Fastify trustProxy](https://fastify.dev/docs/latest/Reference/Server/#trustproxy)、[Fastify advisory](https://github.com/fastify/fastify/security/advisories/GHSA-444r-cwp2-x5xf)。
- **Findings**: 現 Cookie は request.protocol で Secure を決める。内部 API を HTTP にすると公開側 HTTPS を別に識別する必要がある。
- **Implications**: 同一 Compose 設定の Web HTTPS フラグを API に渡して Cookie を生成する。任意の X-Forwarded-Proto を信頼しない。API の認証フックを保持し、prefix rewrite を認証境界としない。
- **Dependency finding**: local @fastify/http-proxy 10.0.2 は公式 prefix escape advisory の影響範囲。通信 adapter 変更と併せてFastify 5 と互換の最新 11.x（11.6.6 以上、`npm view` 確認時点で 11.6.9）へ `web/package.json` と lockfile で限定更新する。実際の依存宣言は `web/package.json` にあり、`api/package.json` にはない。現 Undici は7.29.1、Fastify は5.12.3。広い依存更新は本変更に含めない。
- **Sources**: [URL encoding advisory](https://github.com/fastify/fastify-http-proxy/security/advisories/GHSA-mx7v-qhg9-2mvv)、[backslash advisory](https://github.com/fastify/fastify-http-proxy/security/advisories/GHSA-qv33-689p-2xq5)、[11.6.2 source](https://raw.githubusercontent.com/fastify/fastify-http-proxy/v11.6.2/index.js)、[package](https://raw.githubusercontent.com/fastify/fastify-http-proxy/v11.6.2/package.json)。

### ホスト準備と停止時の遮断
- **Sources Consulted**: installer/setup.sh の setup_sysctl/setup_boot_guard/setup_host_reboot/uninstall_sysctl、proxy/src/server.ts、network/gateway-controller.ts・ruleset.ts、host-control/host-reboot.ts。
- **Findings**: boot guard は Docker 起動前の遮断を設定する。Gateway は既存ルールを起動時に消さない。一方、通常/異常停止の遮断処理は存在せず、host network なので規則が残る。既存解除は sysctl を一律値へ戻すため、準備前の元値の記録も新規に必要。
- **Implications**: ホスト準備を check/apply/status/remove に絞り、元値と所有ファイルの変更履歴を保存する。guard の独立所有者を設け、Gateway runtime の table 再構成で遮断が解除されないようにする。
- **Requirement clarification（2026-11-17 の旧記録、後段の2026-11-18決定で更新）**: 停止遮断の対象条件と watcher の扱いは後段「Guard の切替主体を proxy に一本化し watcher を廃止」を参照する。

## Architecture Pattern Evaluation

| Option | Strengths | Risks / Limitations | Decision |
|---|---|---|---|
| Compose core＋vendor merge、最小ホスト準備、制御UDS | 既存宣言と責務を維持し、別ホスト設定とTCP制御公開を除去できる | ホスト guard の停止契約が必要 | 基本方式として選択 |
| root include で全 vendor を取り込む | root 起動モデルへまとめやすい | vendor の API mount と root API が衝突し、bundle 契約の再設計が必要 | 不採用 |
| Gateway TCP を継続してTLSだけ任意化 | 現クライアント差分が小さい | host network でLANからの制御到達を防ぐ設定が複雑 | 不採用 |
| Web/API を同一プロセスへ統合 | 内部通信自体を減らせる | 利用者の対象外、API/UIの責務を崩す | 不採用 |

## Design Decisions

### Generalization
- 通信保護は区間ごとに2値で表現する。Web と Gateway の TLS を独立に選び、同じ既存プロトコル処理を listener/client の選択で利用する。複数ホスト用の汎用接続先管理は復活させない。
- ライフサイクルは Compose 操作とホスト準備へ分ける。状態/データを管理する新しい installer/controller を重ねない。

### Build vs. Adopt
- HTTP/HTTPS・UDS・mTLS は既存 Node/Undici、Web proxy は既存 Fastify adapter、複数宣言の合成は標準 Compose merge を採用する。新しい通信ライブラリは追加しない。
- 製品固有のホスト設定・変更の復元・停止 guard のみを小さな管理処理として実装する。

### Simplification
- 役割の配置先・SSH/SCP・ペアリング・API HTTPS と CA を撤去。vendor bundle と管理者認証・runner の許可コマンド境界は維持する。
- 旧方式からの移行/互換対応は未リリースのため対象外。slot worker や多段のネットワーク実装も追加しない。

## Risks & Mitigations
- Gateway 異常終了時の転送残存 — 利用者の遮断基準を確定してから設計を最終化し、強制停止を実測する。
- UDS stale/権限/再接続 — 専用 volume と単一 owner、型付き transport 設定、kill/recreate の検証。
- Web TLS と Cookie の不一致 — 同一 Compose フラグ、転送ヘッダー非依存、4通りの実ブラウザ検証。
- ホスト設定の外部編集/解除時の巻き込み — 初回元値と所有対象を記録し、不一致時は差を報告して停止。

## References
- [Docker merge](https://docs.docker.com/compose/how-tos/multiple-compose-files/merge/)
- [Docker include](https://docs.docker.com/reference/compose-file/include/)
- [Docker host networking](https://docs.docker.com/engine/network/drivers/host/)
- [Node TLS](https://nodejs.org/docs/latest-v22.x/api/tls.html#tlsconnectpath-options-callback)
- [Undici Connector](https://undici.nodejs.org/api/Connector)
- [Fastify proxy advisory](https://github.com/fastify/fastify-http-proxy/security/advisories/GHSA-mx7v-qhg9-2mvv)

---

# ギャップ分析（/kiro-validate-gap、2026-11-15）

- 対象: requirements.md（8領域・53件、承認済み）と現行コード（dev/single-node-deployment、5ab7d2b 基点）の差。
- 方法: コードの読み取り調査（Codex 委譲・読み取り専用の2本）。新構成の実機起動・通信試験は未実施。上の「Research & Design Decisions」は設計着手前の下調べで、本節はそれと整合する形でコード側の差を整理したもの。

## 1. 現状の要点

| 区間 | 現状 | 要件との差 |
|---|---|---|
| ブラウザ→Web | 証明書必須の HTTPS（`web/server/index.ts:11,16`）。公開ポート既定443 | HTTP 既定・HTTPS 任意へ（要件3） |
| Web→API | `https://api:3000`。Web が API CA を読んで検証（`web/server/index.ts:18-29`）。API は常に HTTPS で待受（`api/src/server.ts:14-19`）、ホストの3000番も公開（`compose/api.yml:9-16`） | 内部 HTTP・API 非公開へ（要件4） |
| API→Gateway | mTLS の HTTPS 固定。Gateway は host network の `0.0.0.0:8443`（`proxy/src/server.ts:37-40,231,309`）。API は bridge のため `host.docker.internal:8443` 経由 | TLS 任意・既定 OFF、かつ LAN へ制御口を露出しない（要件5） |
| Gateway→runner | UDS 上の HTTP。許可バイナリ完全一致のみ実行、不許可は403 | 変更不要（要件8.8 は現状で満たす見込み） |

## 2. 要件→現行資産の対応（Missing / Unknown / Constraint）

| 要件 | 現行資産 | 判定 |
|---|---|---|
| 1 単一ノード直接導入 | root `docker-compose.yml` は `services: {}` のみ。Web/API/proxy は `compose/{web,api,gateway}.yml` の fragment で、`installer/setup.sh:692` が `COMPOSE_FILE` を生成 | **Missing**: root 単独で Web/API/proxy が起動しない。ベンダー fragment の API mount（Proton の cache）は merge 前提で、`include` に置換すると衝突する（Constraint） |
| 1.3/1.4 役割選択・遠隔導入の撤去 | `--web/--api/--gateway`、SSH/SCP、`TOPOLOGY_*`、ペアリング再生成が `setup.sh` に集中（27・499・583・720・828・907行付近） | 撤去対象。単一ノードでも必要な処理と同一ファイルに混在（Constraint） |
| 2.1〜2.4, 2.7 ホスト準備 | preflight・sysctl・boot guard・host-reboot の生成は `setup.sh` 内に存在（180・275・342・373行付近）。単独実行できる check/apply/status/remove はない | **Missing**: 切り出し。sysctl の適用前の値を記録しておらず、解除は `ip_forward=0` 等の固定値へ戻す（元値の復元ではない）。成功済み変更の一覧もない |
| 2.5 再起動中の遮断 | 現行 boot guard は `inet vpngwgui` 内で `ct status dnat accept` を行う（`setup.sh:337-358`） | **決定済み 2026-11-17**: 新設計では独立 `inet vpngwgui_guard` priority -1 に置換し、DNAT 済みを含め LAN 転送を遮断。新 guard 確認後に旧 chain を撤去する |
| 2.6 再起動依頼 | API→proxy→ホストの依頼ファイル→systemd path/service（`gateway-reboot.ts`、`setup.sh:373`） | 現行機能。ホスト準備側へ残す（Missing は切り出しのみ） |
| 2.8 Gateway 停止中の遮断 | Gateway に停止時処理がなく、nft 規則は最後に適用した状態で残る（`proxy/src/server.ts:302` は起動時に消さない設計） | **決定済み**: 通常停止の即時失効と異常停止の4秒期限付き健康 lease、独立 guard による最大6秒遮断。実機の nft timeout 検証は受入リスク |
| 3 Web HTTP 既定・任意 HTTPS | TLS 設定は常に証明書を読む実装。切り替えフラグなし。Web コンテナは証明書の有無にかかわらず PKI を mount | **Missing**: 有効化フラグと不足時の起動失敗（3.4）。`compose/web.yml` の既定ポートと mount 条件 |
| 3.6 Cookie の Secure | `request.protocol === "https"` で判定（`operator-session.ts:26-41,54-61`、`operator.ts:43-47`）。`trustProxy` の設定なし | **Constraint**: 内部 HTTP 化すると Web が HTTPS でも Secure が付かない。転送ヘッダー信頼ではなく、同一 Compose の Web HTTPS フラグを API に渡す案が研究記録にある |
| 4 Web→API HTTP・API 非公開 | `compose/api.yml` が3000番を公開。API 証明書の mount は Gateway mTLS 用の PKI と同じ場所 | **Missing**: 公開の撤去、Web 側の CA 読み込みを条件付きに。mount は用途別に分離が必要（全削除は不可） |
| 4.5/4.6 到達不能表示・復旧 | 現行コードの挙動は未確認 | **Unknown**: 到達不能時の画面とエラー、API 復旧後の自動再開 |
| 5 API→Gateway TLS 任意 | API・Gateway の両側が証明書読み込み固定 | **Missing**: 両側に有効/無効の分岐。区間ごとの設定は独立に選べる必要（5.6） |
| 5.7 LAN から制御口へ直接届かない | host network のため `ports` で範囲を絞れない。`127.0.0.1` 待受は bridge の API から届かない | **Constraint（設計の中心）**: 下記の選択肢 |
| 5.4/5.5 TLS 検証失敗・設定不一致の報告 | 検証失敗時の降格はしない設計だが、不一致の見せ方は未整備 | **Missing**: 運用者が確認できる表示 |
| 6.1 更新手順 | `installer/main.sh` の `update`/`uninstall`/`status`、`bootstrap.sh.tmpl`、`app.sh` が常設コマンド | **Missing**: Compose 中心の更新手順（pull/build と再作成）。常設コマンド層を残すかは未決 |
| 6.2〜6.6 保存データ | API は `api-data`（管理者・設定・お気に入り・監査ログ）。ベンダーは `adguard-data`、`proton-config`/`proton-keyrings`（Proton の cache は API へ read-only mount）。`down` は volume を残し、`uninstall --purge` が `down --volumes` | 保持は現状で成立。**Unknown**: ベンダー fragment を外して再度有効化したとき、project 名が変わらず volume を再利用できるか。研究記録は固定 project 名を想定 |
| 7 文書・配布 | README は curl 導入・`vpngwgui-ctl update`・分離配置・SSH・証明書ペアリング・HTTPS 既定を案内。`release-installer.yml` と `installer-check.yml` は installer の shellcheck/配布が前提。`installer/tests/run.sh` は旧挙動（SSH・トポロジー・COMPOSE_FILE・PKI）を検査 | **Missing**: 全面更新。配布物の形（installer を残すか Compose 資材を配るか）は未決 |
| 8.3〜8.6 検証 | `e2e/common/api-client.ts` は `node:https` 固定で CA 必須。`e2e/hosted/fixtures/stack.ts` は `https://127.0.0.1:3000` と `api-ca.crt`。`provision.sh` は本番 installer と証明書生成が前提。`e2e/vendor-live/lib/config.ts` は `https://` 以外を拒否し `caPath` 必須 | **Missing**: 共通クライアントの HTTP 対応と CA の任意化、4通りの構成を起動する仕組み（現状は単一の HTTPS+mTLS 構成） |
| 8.7 資格情報を hosted CI へ渡さない | vendor-live は手動実行の前提 | 現状維持で成立 |

## 3. API→Gateway の制御経路の選択肢（5.7 への対応）

| 案 | 内容 | 利点 | 懸念 |
|---|---|---|---|
| A. 専用 UDS を共有 volume で API と Gateway が共有（研究記録の推奨） | Gateway は TCP 待受を持たず、ファイル権限で保護。TLS ON/OFF は UDS 上の HTTP/HTTPS の違いに | 5.7 を構造で満たす。host/bridge の差を吸収 | 過去に廃止された経路の再導入。UID（API/proxy は 10001）、親0700・socket0600、stale ファイル、再接続の設計。runner の UDS とは分離が必要 |
| B. Gateway を `127.0.0.1` で待受 | 現行 TCP を維持 | 実装差分が小さい | API は bridge のため到達できない。API も host network にすると Web→API の分離が崩れる |
| C. 0.0.0.0:8443 のまま FW で到達元を絞る | 現行コメントの推奨 | 現行構成に近い | bridge 上の API の送信元アドレス・Docker 転送経路との整合が複雑。設定ミスで制御口が LAN へ露出する |

→ 判断は設計で行う。調査上は案 A が要件と最も整合する。

## 4. 実装アプローチ

- **Option A（既存の拡張）**: `setup.sh` を単一ノード専用へ縮小し、Compose 生成を残す。差分は小さいが、要件1.3（インストーラの合成を前提にしない）と brief の「インストーラ縮小案は不採用」に反する。
- **Option B（新規）**: root Compose を直接定義し、ホスト準備ツールと通信切り替えを新規に作る。責務は明確だが、既存ロジックの再実装が多い。
- **Option C（ハイブリッド・推奨）**: Web/API/proxy の定義を root へ集約し、ベンダー fragment は標準の `-f`/`COMPOSE_FILE` で merge。ホスト準備は `setup.sh` から sysctl・boot guard・host-reboot の既存処理だけを小さなスクリプトへ移して check/apply/status/remove にまとめる。通信は既存のプロトコル処理を listener/client の選択で再利用する。旧 installer・PKI・トポロジー・SSH は撤去。段階は「通信契約 → Compose/ホスト準備 → E2E・配布・文書」。

## 5. 工数とリスク

- **工数: L〜XL**。導入定義、ホスト準備、通信（3区間）、E2E 基盤、配布・文書にまたがる。実装前に2.8 の停止契約と制御経路の判断が要る。
- **リスク: High**。Gateway 停止時の遮断（2.8）と制御口の露出防止（5.7）は、設計を誤るとセキュリティ上の後退になる。host network の挙動は実機でしか確かめられない。

## 6. 設計へ持ち越す事項（当時の記録・2026-11-18時点で再確認が必要なものは後段に記載）

1. ~~2.8 の許容窓（2026-11-17旧決定、2026-11-18 superseded）~~: 当時の記録。現行条件は後段の2026-11-18決定を参照。
2. **制御経路**: 案 A の UDS を採る場合の権限・stale 処理・再接続。強制停止・再作成の実測。
3. ~~2.5 の遮断範囲~~: 2026-11-17 時点の記録。適用順の実機確認は受入タスクに残る。
4. **Cookie の Secure**: Web HTTPS フラグの API への渡し方と、`trustProxy` を使わないことの確認。4通りの実ブラウザ検証。
5. **到達不能・復旧（4.5/4.6）**: 現行の Web プロキシが API 不在時に返すエラーと、復旧後の再開。
6. **volume の再利用**: ベンダー fragment の着脱と固定 project 名での保持（6.3）。
7. **Compose の mount 分離**: API の PKI mount を Gateway TLS 用だけに限定する方法（TLS 無効時に不要）。
8. **配布物の形（7.4）**: `installer/main.sh` の常設コマンド層を廃止するか、ホスト準備と独立した配布手段として残すか。
9. **E2E**: 4通りの組み合わせの起動方式。`certs.sh` は ISP/DoH 模擬サーバの証明書にも使われており、API/Web 用 CA の廃止時に巻き込まない。
10. ~~ホスト準備の対象 OS・Docker 自動導入の継続可否~~: Debian 12+/Ubuntu 22.04+ を対象とし、Docker 自動導入は行わず `daemon.json` は変更しない。
11. **`@fastify/http-proxy`**: 10.0.2 は公式 advisory の影響範囲。Fastify 5 対応の 11.6.6 以上へ限定更新し、確認時点の latest 11.6.9 を使用する（上の記録のとおり）。
12. **参照の洗い出し**: `:3000` への直接接続（E2E・診断・手動ツール）と、steering（tech.md の HTTPS 必須・PKI 自動配置の記述）の更新。
13. **隣接仕様**: multihop-backend の API→Gateway の HTTPS 前提と slot worker の配布元・依頼ディレクトリの再確認（既存承認は自動変更しない）。

---

## 利用者の決定（2026-11-15、ギャップ分析後の確認）

> **履歴上の記録**: 次の2026-11-15/17停止 guard 方針にある watcher/設定不明時の fail-closed 案は、2026-11-18 decision で superseded。現在有効な条件は後段の 2026-11-18 節。

> 以下の停止 guard に関する2026-11-15/17案は2026-11-18決定で一部 superseded。現在の条件・既定値・PUT 契約は下記「Guard の切替主体を proxy に一本化…」を正とする。

1. **Gateway 停止時の遮断（要件2.8、2026-11-18 更新）**: 2026-11-17 の watcher 解釈は superseded。透過ゲートウェイ有効時のみ、proxy が適用中の `killSwitch && transparentGatewayEnabled` に従い4秒 lease を1秒ごと更新し、異常停止時は最大6秒で遮断する。明示的プロキシのみでは停止時保証をしない。
2. **常設コマンドの廃止（要件6.1・7.4）**: `installer/main.sh` の `update`/`uninstall`/`status` 等の常設コマンド層は廃止する。
   - 設計への含意: 更新・停止・削除は Compose の標準操作と文書化した手順で行い、ホスト準備ツールは check/apply/status/remove だけを担う。`installer/main.sh`・`bootstrap.sh.tmpl`・`app.sh` と、それを配布する `release-installer.yml`・検査用の `installer/tests/run.sh` は撤去または新しい配布物（Compose 資材とホスト準備）へ置き換える。持ち越し事項の2.8の許容窓と8（配布物の形）はこれで解消。

## 利用者の決定（2026-11-18、host-reboot 依頼の専用 ID と検証）

- proxy image の `vpngwgui` と Compose の実行 UID/GID `10001:10001` を host-reboot 用の製品専用予約 ID として維持する。host-preparation はホストに同 UID/GID の passwd/group account が存在しないことを `check` と `apply` の両方で検査し、衝突時は非0で失敗する。ホスト依頼 directory を `10001:10001` / 0700 とし、他のホスト UID/GID に書き込み権限を与えない。
- systemd は request file が symlink でない通常ファイルであること、owner UID 10001、mode 0600、内容が `vpngwgui-host-reboot-v1\n` と完全一致することを実行直前に検証する。無効依頼は実行せず記録し、適合依頼は削除後に固定の `systemctl reboot` だけを実行する。
- この決定により、以前の root:10001 / 0730 directory 契約を廃止する。依頼 directory は root 所有ではなく予約された proxy UID/GID の所有とする。


## 設計の合成結果（2026-11-15、watcher-era guard 方針は2026-11-18に superseded）

設計前調査と当日付のギャップ分析・利用者決定を統合し、以下の責務・契約に一般化した。既存コードのファイル単位の差分は設計書の File Structure Plan として具体化し、ここでは判断の根拠を保持する。

- **一般化**: 通信保護を Web HTTPS と API→Gateway TLS の独立した2設定へまとめた。API→Gateway は dedicated filesystem UDS を唯一の経路とし、HTTP/HTTPS は UDS 上の protocol 選択として扱う。LAN 制御口の公開、任意転送ヘッダーの信頼、複数ホスト用 endpoint abstraction を作らない。
- **Build vs. Adopt**: Compose の標準 `-f`/`COMPOSE_FILE` merge、Node/Undici の socketPath/TLS、Fastify proxy adapter を採用し、専用 Compose generator・新 transport library は作らない。ホスト固有の所有状態記録、boot guard、reboot unit、nft guard を製品コードとして実装する。当時案に含まれた設定・起動回復 watcher は2026-11-18に廃止を決定した。Docker/Compose 自動導入は行わず、既存 `/etc/docker/daemon.json` を変更しない。ホスト準備対象を Debian 12+/Ubuntu 22.04+ としたのは、systemd・nftables・sysctl の既知契約に絞り、配布元の Docker 設定を破壊しないため。
- **簡素化**: installer の role selection、SSH/SCP、pairing、PKI 配布、常設 update/uninstall/status を撤去し、Compose の標準操作へ寄せる。ホスト準備 CLI は `check/apply/status/remove` の4操作に限定。vendor fragment は残し、固定 project 名で runner volume を再利用する。旧方式互換・データ移行、Web/API 統合、多段接続実装を追加しない。
- **停止遮断の合成（2026-11-17 旧案、2026-11-18 superseded）**: 当時は watcher を含む方針を記録した。現在有効な条件は後段の「Guard の切替主体を proxy に一本化し watcher を廃止（2026-11-18 決定）」だけを参照する。
- **参照した設計ルール**: `.claude/skills/kiro-spec-design/rules/design-principles.md`、`design-synthesis.md`、`design-review-gate.md`。原則に沿って責務境界と所有者を明示し、build/adopt と簡素化の判断を記録した。review gate の要件ID網羅、boundary/file alignment、placeholder と未解決事項を自己点検した。

設計書・本合成追記は、現行構成の読み取りと設計整理に基づく。新構成の Compose 起動、TLS matrix、UDS 権限、停止時間の実測は未実施であり、Testing Strategy の受入検証で行う。

## Gateway 停止遮断の watcher 非依存化（2026-11-17 旧案、2026-11-18 superseded）

> **旧案・現在は不採用**: この節の設定値・watcher 遷移は2026-11-18 decision で置き換えられた。最新の guard 条件と保証範囲は後段を参照。

### 決定

採用案は **proxy 更新の期限付き健康 lease を使う fail-closed guard**。Kill Switch が true または設定不明のとき、host 所有の独立 nft table は LAN forward を既定 drop とし、proxy が UDS health・設定適用・runtime・LAN ruleset の成功を条件に1秒ごと timeout set `healthy_lease4` の要素を更新する。要素期限は4秒。guard は `type ifname` set に LAN interface 名を要素として持ち、`iifname @healthy_lease4 return` で priority -1 chain から抜けた後、既存 priority 0 Gateway chain に転送許可判断を委ねる。要素がなければ LAN 入りを drop する。これは既存 ruleset が gateway-approved conntrack mark を VPN 転送に付けないためで、mark による許可は採用しない。更新失敗・遅延は成功とみなさず、期限切れ後は次の成功更新まで drop。通常停止対象は SIGTERM/SIGINT/SIGQUIT handler で、lease 失効後に server/controller を閉じる。watcher は設定読取・異常診断・boot recovery を調停し、lease 更新主体にはしない。最大時間配賦は `4.00 + 0.50 + 0.50 = 5.00秒 <= 6.00秒` とする。

false と確定した設定では停止遮断用 lease/guard を使わず、watcher/Gateway 停止による遮断をしない。設定不在・破損・読取不能は true と同じ fail-closed 扱い。boot guard は要件2.5に従い設定値にかかわらず Docker 起動前から適用し、制御可能状態の検査が終わるまで保持する。現行 setup.sh の guard は Gateway table 内で DNAT 済み通信を accept しており、新設計では独立 table に移して全 LAN 転送を drop する。

boot guard は `boot_block` set の LAN interface element で表し、lease set より先に評価する。boot 中は watcher が API 設定・API→Gateway 反映・Gateway health・期待 ruleset を確認してから `boot_block` を解除する。初回 Gateway 健康後の稼働中 watcher 再起動では guard 状態を変更せず、false の解除済み状態も true の lease 状態も維持する。状態取得不能時は新しい boot guard を適用せず既存状態を維持し、永続設定が不明と確定した後に true 遷移として drop する。nft batch の構文、`return` 後の別 base chain 評価、DNAT を含む経路は対象 nft/kernel 上で受入検証する。

### 根拠と現行資産

`installer/setup.sh` はホストに `nftables` を依存パッケージとして要求し、既存の systemd boot guard をホスト側 unit として設置する方式を既に持つ。`proxy/src/network/ruleset.ts` は timeout flag の set、期限付き element、`add element`/`update` を組み立て、`bypass-set.ts` は TTL を管理している。`proxy/src/verification/test-fixtures.ts` は nft 1.0.9 の `flags timeout`、`expires` 表記を記録している。したがって timeout set はプロジェクトの現行 nftables 前提・構文資産と整合し、新規監視 daemon や Docker socket mount は不要と判断した。

ただし、これらは Gateway table 内の迂回/記録 set に関する実装・fixture である。host の独立 table に lease を設置した場合の Debian 12/Ubuntu 22.04 それぞれの nft/kernel 組合せ、要素更新競合、実時間での期限処理、異なる base chain 間の verdict と DNAT 済み転送挙動は未実測である。コード読解だけで期限精度や6秒達成を証明できないため、実機受入の必須条件とする。

### 却下案

- **systemd WatchdogSec と watcher 相互監視**: watchdog の通知・再起動は systemd のスケジューリング、watcher 自身の応答、監視関係の起動順に依存し、相互停止や共通障害を単純に解決しない。監視プロセスが止まった時点から別主体が遮断する経路も必要となり、二重化で複雑さが増す。短期限 lease は watchdog/restart の遅れに依存しないので採用しない。
- **watcher の Restart=always / 1秒 polling だけで保証**: watcher が停止した時間は必ず未監視窓になる。再起動設定は復旧性を上げるだけで6秒上限を担保しない。
- **Gateway が永続 guard を明示的に挿入・削除するだけ**: SIGKILL で cleanup が走らず、停止後も許可状態が残る。watcher を追加しても watcher 自身の停止穴が残る。
- **Docker socket mount とコンテナ内監視**: Docker daemon/API への強権限境界をコンテナへ持ち込み、要件の「Docker socket を mount しない」を破る。lease は nft kernel timer で成立するため不要。

### 保証範囲と残余リスク

設計上の時間配賦は異常停止起点から `4.00秒 lease + 0.50秒 nft 失効誤差 + 0.50秒 packet verdict = 5.00秒 <= 6.00秒`。watcher が停止・kill された状態を含む。通常停止は指定 signal handler が lease を先に失効させる。Kill Switch false は停止に伴う遮断の対象外、不明は true 扱い。

実測が必要な受入リスクは、対象ホストでの timeout set 作成/更新/再更新/自然失効、4秒境界と6秒上限の測定、priority -1 独立 guard の `return` が後続 priority 0 chain へ進むこと、lease 不在時に DNAT 済み・DNS redirect 後・迂回・VPN 転送が遮断されること、Gateway `inet vpngwgui` 再構成・削除後も guard が残ること、設定 false/true/不明切替時に fail-open/closed 方針が一致すること。timeout または chain の実測が不合格なら6秒保証をリリース条件として満たさないため、実装方式を再評価する。

（旧案・superseded）保証外はホスト停止、極端な CPU 飢餓やカーネル timer の進行不能、Docker/systemd/nftables/カーネル自身が停止・拒否した場合、guard table が外部から消された場合、製品 LAN 経路を迂回する外部ルール/経路がある場合。watcher 単体の停止・異常終了は保証外ではない。

## Guard 状態の簡素化（2026-11-17 旧案、2026-11-18 superseded）

> **旧案・現在は不採用**: 本節の watcher、設定不明の fail-closed 解釈、boot_block 解除方式は、2026-11-18 の owner decision により置き換えられた。現行契約は次節だけを参照する。

guard は `BLOCK`（boot 時の無条件 drop）、`LEASE`（有効 lease の間だけ通し、失効時 drop）、`OFF`（独立 guard の drop を全て無効化）の排他的3状態に整理する。以前の「最後の `iifname "<LAN_IFACE>" drop` を常設し、lease 要素の有無で遮断する」形では、Kill Switch false の `OFF` 状態でもその drop が残り、lease 不在時に LAN 転送を遮断して false 契約に反する。このため `OFF` は guard table を削除するか drop ルールを含まない空 chain とし、実ルールと契約を一致させる。

不明・失敗の判断は「直前に確認済みの実状態を保つ。ただし設定ファイル不在/破損・型不正などにより false を確認できないことが明白なら fail-closed の `BLOCK` を先に確保し、確認後 `LEASE` にする」とする。したがって `OFF` 確認後の一時的な読取失敗や watcher 再起動だけでは遮断側に戻さず、利用者が確定した「設定不明は有効扱い」の方針を維持しながら、確認済み false を transient I/O 障害だけで覆さない。これは恒久的に false を確認不能な破損状態と一時的な情報取得失敗を分ける唯一の判定軸であり、boot 中の未確定状態は初期 `BLOCK` を維持する。

nft batch の失敗は transaction の原子性を前提に直前状態を維持し、失敗記録後に次周期で再試行する。drop への遷移に失敗した場合は既存 `BLOCK` を保持する。watcher 再起動では稼働中に新しい boot block を作らず guard 実状態を照合する。遷移順を一つの表へ集約し、false→true は `BLOCK` を先に確保、true→false は永続設定・API反映・Gateway false ruleset/health の確認後に最後の drop を除く順とした。

## Guard の切替主体を proxy に一本化し watcher を廃止（2026-11-18 決定）

上の2節（2026-11-17）の watcher 前提の記述は、本節で置き換える。6秒停止遮断の対象は透過ゲートウェイ有効時のみとする追加決定も本節で定める。

### 経緯

独立レビューを5回まわしても NO-GO が続いた。原因は、ホストの watcher が API コンテナの `settings.json` を Docker CLI で読み、proxy とは別に guard を切り替える構成にあった。切替主体が3者（boot unit・watcher・proxy）になり、「設定不明」「一時的な読取失敗」「watcher 再起動」の組み合わせごとに遷移を決める必要が生じ、穴が繰り返し見つかった。

### 決定

- 起動後の guard 切替は proxy だけが行う。proxy は既に host network・`NET_ADMIN`・`sudo nft` でホストの nftables を操作しており、新しい権限は要らない。boot unit はホスト起動時の初期 `BLOCK` だけを担う。watcher（常駐 service、Docker CLI による設定読取）は作らない。
- effective guard setting は `killSwitch && transparentGatewayEnabled`。guard は proxy が適用済みの値に従う。現行 `proxy/src/network/gateway-controller.ts` の `DEFAULT_SETTINGS` は `transparentGatewayEnabled=false, killSwitch=true` である。ただしこの内部既定値は API 通知前に適用せず、healthy 判定にも使わない。API settings 初回受信・適用までは boot `BLOCK` を保持する。6秒保証は透過ゲートウェイ有効時だけであり、明示的プロキシのみでは停止時保証を設けない。
- boot unit の bootstrap と proxy の状態遷移 batch を分離する。bootstrap が table/set/chain を一度作成し、遷移 batch は既存 chain/set の flush と rules/elements のみを行い、table/set/chain を再宣言しない。`LEASE` への切替は、lease 要素と drop 規則を同じ batch で入れるため、隙間が生じない。
- `killSwitch` または `transparentGatewayEnabled` の変更で effective guard setting が変わる PUT は候補全体を proxy に先に通知し、200 の適用確認後だけ保存する。失敗時は保存せず 503 とし、Kill Switch を含む変更には `kill_switch_not_applied` を維持する。透過設定だけの変更には一般化した `gateway_setting_not_applied` を使う。現行実装 `api/src/routes/connection-config.ts` は保存後に通知しており、この契約への変更対象である。

### 効果

- 透過ゲートウェイ有効時の6秒遮断は常駐監視 service に依存しない。明示的プロキシのみのモードには停止時保証を設けない。
- Docker CLI・Docker socket を guard 判定に使わない。

### 却下案

- watcher を残して遷移表を精緻化する案: 切替主体が3者のままで、不明・読取失敗・再起動の組み合わせが残る。レビューで穴が繰り返し見つかったため却下。
- 停止中の変更を保存し、Gateway 再開時に反映する案: 要件 2.8 の文言変更と要件の再承認が必要になり、停止中に利用者が Kill Switch を有効にしても遮断されない。利用者が却下。

### 同時に直した不整合（要件と設計の点検）

- Traceability の 2.4（ホスト準備の失敗報告）に watcher と guard の遷移が割り当てられていたため、ホスト準備だけに戻した。
- 更新手順に `docker compose pull` があったが、現行 Compose は全サービスが `build:` だけで公開 image を持たない（GHCR 等への公開は範囲外）。資材の置き換え → `apply` → `docker compose -p vpngwgui config --quiet` → `docker compose -p vpngwgui up -d --build` に改めた。

## ホスト準備の LAN interface の取得元（2026-11-18 追記）

タスク計画の独立レビューで、boot guard の `<LAN_IFACE>` をホスト準備がどこから得るかが設計にないと指摘された。旧インストーラは引数、`.env`、既定ルートからの自動検出の順で決め、`.env` に書き戻していた（`installer/setup.sh` の `setup_lan_iface`）。新方式では、Compose と同じ `.env` の `LAN_IFACE` を唯一の取得元とし、ホスト準備は `.env` を書き換えない。自動検出した値は候補として表示するだけにとどめ、黙って使わない。これにより proxy（Compose 経由）と boot guard（ホスト準備経由）の値の出どころが1つになる。食い違いは `status` が drifted として報告する。導入手順は `.env` の用意を `check`/`apply` より前に置く順に改めた。


## 2026-11-18 再レビュー訂正（現行契約）

- `proxy/src/network/gateway-controller.ts` の `DEFAULT_SETTINGS` は `transparentGatewayEnabled=false` だが、API から受け取る前の内部初期値である。これを適用済み設定・healthy 判定として扱わない。API settings を初回受信・適用するまで boot `BLOCK` を保持する。proxy 再起動では既存状態を変更せず、`LEASE` は lease 自然失効による drop、`OFF` は OFF を維持し、初回 settings 適用後に切り替える。
- nft は boot bootstrap（table/set/chain を一度作成）と transition batch（既存 chain/set flush と rules/elements のみ）に分ける。同一 transition batch の反復適用を対象 Debian/Ubuntu で受け入れ確認する。
- `check` は静的・読み取り専用の prerequisite 検査、guard の実適用・確認は `apply` の責務。rootless Docker は非対応。
- rootful Docker、root entrypoint と `su-exec` 降格を前提とする。`proxy/Dockerfile` の `USER vpngwgui` と `compose/gateway.yml` の `user: "10001:10001"` は削除対象。
- 全 Compose lifecycle command は `-p vpngwgui` を付け、root Compose は top-level `name: vpngwgui` を持つ。`COMPOSE_PROJECT_NAME`/`-p` は `name:` より優先され、他名は volume 名を変えるため非対応。
