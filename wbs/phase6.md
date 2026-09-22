# Phase 6: 明示的プロキシモード（3proxy）

## 目的

3proxyを用いたSOCKS5/HTTPプロキシモードを実装し、`explicitProxyEnabled`・`explicitProxyAllowedCidrs`のユーザ向け設定をproxyコンテナへ反映できるようにする。

## 前提

- Phase2完了（実VPNベンダーCLIによる接続・切断が動作確認済み）。
- Phase3完了（proxyコンテナが`network_mode: host`で稼働しており、LANインターフェースへ直接bindできる状態）。
- **【2026-09-21】Phase4（Web UI）はPhase6より前に実施する（`wbs/README.md`参照）。** 本フェーズ着手時点でダッシュボード・設定ダイアログ・`GET /v1/connection/gateway`・proxy `GET /status`が存在する前提とする。
- Phase3で追加した内部プロトコル`POST /settings`（設定反映エンドポイント）が利用可能であること。

## スコープ外

（なし。実VPNベンダーCLIへの置換はPhase2で完了済み）

## 主要タスク

- [x] 3proxy設定ファイルのテンプレート作成（SOCKS5:1080, HTTP:3128。HTTPをWeb UIの8080と衝突しない3128にした。`proxy/src/explicit-proxy/config-builder.ts`）。
- [x] `POST /settings`受信時、`explicitProxyAllowedCidrs`から3proxy設定ファイルを再生成する処理（`ExplicitProxyController.applySettings()`）。
- [x] `child_process.spawn`による3proxy起動・監視・異常終了時再起動（指数バックオフ）実装（`explicit-proxy-controller.ts`）。
- [x] `explicitProxyEnabled`切替による3proxyプロセスの起動/停止。
- [x] VPN接続状態変化時は3proxyを再起動しない（ルーティングに自動追従するため。design.md記載の通り、独立して機能することを実機で確認した）。
- [x] `GET /status`（proxy内部）・`GET /v1/connection/gateway`（api）のレスポンスへ`explicitProxy`（有効/実稼働/クラッシュループ状態）を追加する。
- [x] ダッシュボードの明示的プロキシ稼働状況欄・設定ダイアログの「未対応」暫定表示（Phase4で追加）を、実稼働状況表示へ置き換える。
- [x] 3proxyクラッシュループ検知時のAPIサーバへのエラー状態通知。proxy→apiのpush経路は新設せず、既存の`GET /status`→`GET /v1/connection/gateway`の中継（pull）で`crashLoop`を利用者へ届ける方式とした（理由: `proxyserver/design.md`「`GET /status`」）。
- [x] （計画外・必要となったもの）3proxyのDockerイメージへの同梱。Alpineの安定版リポジトリにパッケージが無いため、`proxy/Dockerfile`の専用ビルドステージでソースからビルドする。
- [x] （計画外・必要となったもの）`explicitProxyAllowedCidrs`のIPv4 CIDR形式検証（API・proxyの両方）。CIDRは3proxyの設定ファイルの行へ埋め込まれるため、改行による設定行の注入で許可範囲が拡大するのを防ぐ。

## 完了基準

- クライアント端末から本ホストのSOCKS5/HTTPポートへプロキシ設定し、`explicitProxyAllowedCidrs`に含まれるCIDRからのみ接続を許可、それ以外を拒否することを確認する。
- `explicitProxyEnabled=false`にするとプロセスが停止し、ポートが閉じることを確認する。
- 3proxyを強制終了（`kill`）した際、監視処理が自動再起動することを確認する。
- Phase3で検証したnftables連携と、実際のトンネルインターフェース名（Phase2で統合済みの実CLIが確立するもの）の下で3proxyが独立して問題なく動作することを確認する。

## 検証手法（2026-09-21）

- 環境: Phase 3と同じ実機ゲートウェイ（Ubuntu 24.04・単一NIC・実LAN。`GW_MODE=ssh`）。LAN端末役は開発ホスト上のmacvlan LXCコンテナ（実LANのIPv4を持つ）。実VPN（AdGuard VPN CLI、ログイン済み）。
- 実行: `GW_MODE=ssh bash e2e/lxc/sync.sh`（転送・3proxyのソースビルドを含むイメージビルド・起動）→ `GW_MODE=ssh bash e2e/phase6/proxy-scenarios.sh`。Web UI操作は`e2e/phase6/webgui-explicit-proxy.mjs`（Playwright）。詳細は`e2e/README.md`。
- 単体・コンポーネントテスト: proxy 87件・api 107件・web 64件がすべて成功（`npx vitest run`）。3proxyの実プロセスは単体テストでは使わず、`ExplicitProxyController`へspawn・書き込み・時計のスタブを注入して検証した（実プロセスの挙動は下記のE2Eで確認）。

## 検証結果（2026-09-21）

`proxy-scenarios.sh`が**全項目PASS（FAIL 0件）**。

| シナリオ | 確認内容 |
|---|---|
| A | 有効化でSOCKS5(1080)・HTTP(3128)がホストのLAN側でlisten。許可CIDR内のLAN端末からSOCKS5・HTTP CONNECT(HTTPS)・平文HTTPで通信でき、許可CIDR外は3種すべて拒否（出口IPが返らない）。CIDRを許可外→許可へ戻すと通信が回復する |
| B | 無効化でプロセスが停止しポートが閉じる（状態`stopped`）。再有効化で再びlisten。有効でも許可CIDRが空なら起動せず`unconfigured`。不正なCIDR（設定行の注入を含む・プレフィックス長なし）のPUTは400で拒否され保存されない |
| C | `kill -9`後に自動再起動（別PID・再listen・通信回復・`restartCount`+1）、1回では`crashLoop`にならない。短時間の連続kill（バックオフ1→2→4→8秒）で`crashLoop`を報告（Web UIに危険色で表示、監査ログに`explicit_proxy_crash_loop`）。再起動は試み続け、安定稼働30秒後に`active`へ回復 |
| D | VPN接続中はSOCKS5・HTTP CONNECTの出口IPがVPN側（直接212.102.42.196→Tokyo 156.146.34.246）。接続・国変更（再接続）・切断のいずれでも3proxyのPIDは不変（再起動されない）。透過ゲートウェイのnftテーブルと同居して稼働 |
| E | APIの設定定期再通知（10秒周期を複数回またぐ）、Kill Switch・透過ゲートウェイの設定変更、同一CIDRでのPUTのいずれでも3proxyが再起動されない |
| F | Web UIで有効化・許可CIDR保存→稼働状況が「稼働中」＋ポート併記、再読み込み後も設定が保持、不正CIDRはダイアログ内エラーで閉じない、空CIDRは「未構成」、無効化で「停止」・CIDR欄disabled・ポートが閉じる |
| H | proxyコンテナ再起動後、APIの設定再通知で3proxyが自動的に復帰し、LAN端末から通信できる（`restartCount`は0に戻る） |
| G（INFO） | VPN未接続・Kill Switch ONでも、明示的プロキシ経由の通信は実回線から直接出る（下記「既知の制約」） |

- Phase 4のE2E（`e2e/phase4/webgui-dashboard.mjs`）の`initial`（明示的プロキシ欄が実状態表示・暫定表示の消失）・`ks-off`は本フェーズ後も通る。
- 検証中に発見・修正した不具合:
  1. **`dd`要素の`aria-labelledby`が実ブラウザで機能しない**: 稼働状況カードの各行を`getByRole("definition", { name })`で特定していたが、単体テスト（jsdom）では通る一方、実ブラウザ（Chromium）のE2Eでは名前が計算されず要素を見つけられなかった（ARIA上`definition`はアクセシブルネームを付けられない）。`data-testid`での特定へ変更した。jsdomのアクセシビリティ計算が実ブラウザと異なることによる。
  2. **3proxyのSIGTERMからの終了に約5秒かかる**: 当初のSIGKILL切替猶予（5秒）と衝突しうるため、猶予を10秒へ延ばした（実測は`docker run`で確認）。
  3. E2E側の不備: プロキシが拒否時に返す403エラーページ本文を「通信成功」と誤判定していた（拒否の判定を出口IPかどうかにした）。LAN端末役自身の直接通信は透過GW+KS ONで遮断されるため、「直接の出口IP」はGW自身の外部IPで代用するよう改めた。
- 未検証: 透過ゲートウェイと明示的プロキシを同時に有効にした状態での長時間・高負荷の安定性、多数の同時接続、ホスト再起動を伴う復帰（コンテナ再起動は確認済み）、複数NIC構成（bindは全インターフェースのため許可CIDRのみに依存する）、IPv6クライアント（対象外）、HTTPプロキシでのFTP・WebSocket等の特殊なプロトコル。

## 次フェーズへの申し送り

- **【重要・既知の制約】明示的プロキシはKill Switchの対象外**: Kill Switchは`forward`チェーンのみを制御するため、VPN未接続の間は`killSwitch=true`でも明示的プロキシ経由の通信が実回線から直接出る（実測、シナリオG）。利用者にはVPN接続時のみプロキシを使うよう案内が必要。対処案（3proxy専用UIDに対する`output`チェーンのdrop）は`phase15.md`に追加した。
- 3proxyはホストの全インターフェースへbindし、接続の可否は許可CIDRのみで決まる。複数NIC構成（LAN以外に外向けNICがある場合）では、許可CIDRを実際にLAN側に限る運用とすること。認証はIPのみ（ユーザ名・パスワード認証は未実装。`phase15.md`）。
- 設定変更（CIDR変更等）では3proxyの終了待ち（約5秒）のあいだプロキシが応答しない。無停止化（SIGUSR1による設定再読み込み）は`phase15.md`の課題に追加した。
- 3proxyのバージョンは`proxy/Dockerfile`の`THREEPROXY_VERSION`（0.9.5）で固定し、ソースをビルドする（ビルド時にGitHubへのアクセスが必要）。更新時は実機で`proxy-scenarios.sh`を再実行すること。
- `explicitProxy`の追加により、`GET /status`のレスポンス形状が変わった。api・proxyは同時にデプロイすること（旧proxyが`explicitProxy`を含まない応答を返すと、APIは形状不一致として502相当になる）。
- `excludedDomains`（Phase 14）は3proxy側の除外設定も対象になる。`config-builder.ts`にドメイン除外の生成を追加する形で実装できる（設定ファイルは`allow`/`deny`のACL方式のため、宛先ドメインのACLで表現できるかはPhase 14で確認すること）。ただし3proxy自身はルーティングを制御しないため、VPN迂回の実現にはOS側のポリシールーティングが必要になる。
- `e2e/phase4/webgui-dashboard.mjs`のうち`flow`・`error-422`・`error-502`はPhase 5の「接続国」セレクト廃止により失敗している（既存の陳腐化。`phase15.md`に記載）。
