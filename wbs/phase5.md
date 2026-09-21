# Phase 5: Web UI完成（簡易機能版プロトタイプ向け・Phase 4より前に前倒し）

**【2026-09-21改訂】本フェーズは実施順序を前倒しし、Phase 3の次（Phase 4より前）に実施する。** 簡易機能版のプロトタイプとして早期に利用できる状態にするため、当初「Phase 3/4完了後に着手」としていたWeb UI整備を、Phase 3（実装完了）の直後へ移した。フェーズ番号は据え置き（他ファイル・コミット履歴からの参照を壊さないため）で、実施順は `1 → 2 → 3 → 5 → 8 → 4 → 6 → 7` となる。判断根拠は`README.md`「フェーズ分割の考え方」参照。

## 目的

webserver/requirements.mdで定義された画面のうち、未実装の「接続ログ」「トースト表示」「透過ゲートウェイ稼働状況表示」を実装し、最小限のスタイルを与えて、Phase 4（明示的プロキシ）未実装の段階でも「VPN接続操作＋透過ゲートウェイ運用」を通しで操作できるプロトタイプ状態に到達させる。

## 前提

- Phase2完了（ログイン代行APIが利用可能）。ログイン代行の簡易UI（`web/src/components/dashboard/VpnLoginButton.tsx`）と設定ダイアログ（`SettingsDialog.tsx`）は前倒し実装済み（`wbs/phase2.md`「Step 3」参照）。
- Phase3の**実装**が完了していること（`killSwitch`・`transparentGatewayEnabled`がAPI経由でproxyへ反映される。`POST /settings`）。実機検証（`phase3.md`「次フェーズへの申し送り」）は本フェーズと並行して進めてよいが、透過ゲートウェイ稼働状況表示の実機確認は検証環境が必要。
- **Phase4は未実施のまま着手する。** `explicitProxyEnabled`・`explicitProxyAllowedCidrs`は設定ダイアログで編集・永続化できるが、proxyへは反映されない（3proxy未実装）。この点をUI上で利用者に誤解させない配慮を本フェーズのタスクに含める。

## スコープ外

- 明示的プロキシの稼働状況表示（Phase 4で3proxy実装と合わせて実施。下記「暫定表示」参照）。
- `excludedDomains`の実処理（Phase 6）。設定編集UI自体は実装済みだが、反映されない旨は暫定表示で示す。
- 認証UI（ログイン画面等）、多言語対応、WebSocket通知（いずれもphase7.mdの将来課題。LAN限定・認証なしのプロトタイプ運用のため本フェーズでは扱わない）。

## 主要タスク

### 実装済み（前倒し済み）
- [x] 設定ダイアログ（モーダル）実装: `killSwitch`トグル、`excludedDomains`リスト編集、`defaultCountry`ドロップダウン、`transparentGatewayEnabled`トグル、`explicitProxyEnabled`トグル、`explicitProxyAllowedCidrs`リスト編集（`explicitProxyEnabled=false`時disabled連動）。**2026-09-14、phase2の未完了項目解消の一環として前倒し実装済み**（`web/src/components/dashboard/SettingsDialog.tsx`）。ヘッドレスChromiumで開閉・トグル連動・保存後の永続化を確認済み。
- [x] ダイアログ内保存ボタンによる一括`PUT /v1/connection/config`実装。（上記と同時に実装済み）

### 透過ゲートウェイ稼働状況の取得経路（proxy → api → web）
現状、APIは透過ゲートウェイ／Kill Switchの実際の適用状態を返すエンドポイントを持たない（`POST /settings`の応答`applied`は設定変更時の一回限りの結果）。ダッシュボードに稼働状況を表示するため、状態取得経路を新設する。
- [x] proxy: 内部エンドポイント`GET /status`（UDS上、`/exec`・`/settings`と同様OpenAPI非公開）を追加し、`GatewayController`の現在状態（適用中の設定・検出中のVPN IF名・nftables適用有無・Kill Switchによる遮断中か）を返す。詳細は`specs/proxyserver/design.md`「`GET /status`」参照。
- [x] api: `proxy-client.ts`に`fetchProxyStatus()`を追加し、`GET /v1/connection/gateway`（新規、TypeBoxスキーマ定義・OpenAPI公開）として中継する。proxy未応答は既存方針どおり502/504。詳細は`specs/apiserver/design.md`。
- [x] web: orval再生成（`web/src/generated/api/`）。
- [x] 上記の単体/統合テスト（`proxy-client.test.ts`、`routes/`配下のテスト）。

### Web UI
- [x] ダッシュボードに透過ゲートウェイ稼働状況表示を追加（稼働中/停止/Kill Switchにより遮断中/未構成（`LAN_IFACE`未設定））。既存の5秒ポーリング（`useConnectionPolling`）に合流させる。
- [x] 暫定表示: 明示的プロキシ・`excludedDomains`は「未対応（Phase 4/6で対応予定）」である旨を設定ダイアログの該当項目と、ダッシュボードの明示的プロキシ稼働状況欄に表示する（設定値が保存されても反映されないことの明示）。Phase 4で3proxyが実装された時点で、この暫定表示を実稼働状況表示へ置き換える（`phase4.md`のタスク）。
- [x] 接続ログ画面実装（`GET /v1/connection/log`の履歴を時系列表示。ダッシュボードからのモーダルまたは折りたたみセクション）。
- [x] APIエラーレスポンスのトースト表示実装（詳細は折りたたみ表示、stderr等の生ログは要約のみを通常表示）。現状の`role="alert"`によるインライン表示（`App.tsx`の`actionError`、`VpnLoginButton`等）をトーストへ集約する。
- [x] 接続先国の表示補完: 実CLIは国コードを出力せず`ConnectionStatus.country`が常に`undefined`（`phase2.md`「次フェーズへの申し送り」）だった。当初はクライアントのメモリで保持する暫定対応としたが、**再読み込みで消える不具合**（下記「申し送り」）のため、APIサーバ側で接続時に要求した国を永続化して`GET /v1/connection`が返す方式へ改めた（2026-09-21）。
- [x] 最小限のスタイル適用（現状は無スタイル）。レイアウト・状態の色分け（接続中/切断/エラー）・操作ボタンの視認性のみ。デザインシステム導入等は行わない。
- [x] 画面単位のコンポーネントテスト追加（vitest。`web/package.json`にvitestは導入済みだがテストファイルは未作成）。

## 完了基準

- 設定ダイアログから全項目を変更し保存すると、`GET /v1/connection/config`が更新後の値を返すことを確認する。（実施済み）
- `explicitProxyEnabled`をOFFにすると、`explicitProxyAllowedCidrs`入力欄が視覚的にdisabledになることを確認する。（実施済み）
- 接続ログ画面に過去の接続/切断/エラー操作が時系列で表示されることを確認する。（実施済み）
- 意図的にプロキシ未応答（502）・実行失敗（422）を発生させ、トーストにエラー要約が表示され、詳細（stderr）は折りたたみ内に表示されることを確認する。（実施済み）
- `transparentGatewayEnabled`のON/OFF、VPN接続/切断、`killSwitch`切替に応じて、ダッシュボードの透過ゲートウェイ稼働状況表示が、次回ポーリング（5秒以内）で実際の状態に追従することを確認する。（実機で実施済み）
- Web UIのみで「ログイン→国選択→接続→透過ゲートウェイON→状態確認→切断」まで操作でき、プロトタイプとして通し利用できることを確認する。（実施済み）

## 次フェーズへの申し送り

- 本フェーズはPhase 4より前に実施するため、明示的プロキシの稼働状況は「未対応」の暫定表示となる。Phase 4完了時に暫定表示を実状態へ置き換えること（`phase4.md`に対応タスクを追加済み）。
- `GET /v1/connection/gateway`のレスポンスには、Phase 4で`explicitProxy`側の状態を追加できるよう拡張余地を残す（`specs/apiserver/design.md`参照）。
- 【2026-09-21実施】proxy `GET /status`・api `GET /v1/connection/gateway`の`state`は、仕様の3値（`active`/`stopped`/`unconfigured`）に加えて`error`（有効設定だが直近のnft適用が失敗、または再構成の完了前）を追加した。`explicitProxy`はPhase 4で同レスポンスへ追加する（`transparentGateway`と並列のキーとして拡張可能な形にしてある）。
- 【2026-09-21 Phase 4で置換済み】下記の暫定表示のうち明示的プロキシ分は、Phase 4で実状態表示へ置換した（`wbs/phase4.md`参照）。
- Phase 4完了時に置換すべき暫定表示は2か所: `GatewayStatusCard.tsx`の「明示的プロキシ」欄と、`SettingsDialog.tsx`の`.unsupported`表示（Phase 4対象は明示的プロキシ、Phase 6対象は`excludedDomains`）。`web/src/App.test.tsx`・`GatewayStatusCard.test.tsx`にも暫定表示の文言を検証するテストがあるため同時に更新すること。
- 【E2Eで判明した既存不具合】実VPN CLIはエラーメッセージを**stdout**へ出力するため、422応答の`stderr`が空になり、トーストの詳細に何も出ない不具合があった（Phase 2実装由来。例: 接続中でない時の`disconnect`は`Failed to disconnect. Process is not running`をstdoutへ出し exit code 14）。`api/src/lib/failure-output.ts`（stderrが空ならstdoutを返す）を追加して修正した。
- 【設計上の判断】ポーリングは接続状態と稼働状況で成否を分離した。当初は「接続状態の取得失敗＝全体の失敗」とし古い値を保持していたため、proxy停止中も稼働状況が「稼働中」のまま残る問題をE2Eで発見し、部分ごとに成否を持つ形へ改めた（`specs/webserver/design.md`「状態管理の実装方針」）。
- 接続ログ画面は、プロキシへ到達せずCLIを実行しなかった操作（502/504）を記録しない（apiserverの監査ログ仕様）。Web UI側のトーストでのみ確認できる。必要になれば監査ログへの失敗記録追加を検討する。
- 【不具合と修正（2026-09-21）】接続国を「接続操作時にクライアントのメモリへ保持」する暫定対応にしていたため、ブラウザの再読み込み・別端末・別ブラウザで「（接続国: XX）」が表示されなかった（プロトタイプ段階の許容としていたが、通常操作で頻繁に遭遇するため不具合と判断）。原因は、国コードの唯一の保持先がクライアントの状態で、APIが国を返せなかったこと（実CLIの`status`は都市名しか出力しない）。修正として、APIが接続成功時に要求した国と接続先の都市名を`api-data`ボリュームへ永続化し、`GET /v1/connection`で返す（`specs/apiserver/design.md`「接続先国の永続化」）。都市名が保存時と異なる場合（API外での再接続）は古い国を返さない。クライアント側の保持は撤去した。
- 最初のE2E（24項目PASS）は再読み込みを検証していなかったため、この不具合を検出できなかった。E2E `flow`に再読み込み後の表示確認を追加した。
- 設定ダイアログ・接続ログダイアログ内のエラーはトーストではなくダイアログ内のインライン表示（モーダルではダイアログ外のトーストを操作できないため）。

## 検証手法（2026-09-21）

Phase 3の実機検証環境（`GW_MODE=ssh`。Ubuntu 24.04・単一NIC・実LAN・実VPN（AdGuard VPN CLI、ログイン済み））で、Web UIをPlaywrightで操作して確認した。手順は`e2e/phase5/`に残してある。

```sh
GW_MODE=ssh bash e2e/lxc/sync.sh                       # 転送・ビルド・起動
GW_MODE=ssh bash e2e/phase5/dashboard-scenarios.sh jp  # 全シナリオ（引数は接続国）
```

単体・コンポーネントテスト: proxy 49件（うち`getStatus`7件）、api 48件、web 35件（vitest＋jsdom＋Testing Library）がすべて成功。

## 検証結果（2026-09-21）

`dashboard-scenarios.sh`が**25項目すべてPASS**（再読み込み確認の追加後。追加前は24項目）（FAIL 0件）。

| シナリオ | 確認内容 |
|---|---|
| initial | 明示的プロキシ欄・設定ダイアログの「未対応」暫定表示 |
| flow | ログイン→国選択→接続→成功トースト→選択国の表示→**再読み込み後も接続国が表示**→透過GW「稼働中」（VPN IF名併記）→設定で透過GW OFF→「停止」→ON→「稼働中」→切断→接続国表示の消去→「Kill Switchにより遮断中」。稼働状況は次回ポーリング（5秒）以内に追従 |
| log | 接続ログが新しい順に表示され、接続操作の行に接続国が出る |
| ks-off | Kill Switch OFF＋VPN未接続＝遮断中にならず「稼働中」、ONへ戻すと「遮断中」 |
| error-422 | 実CLIの異常終了（`disconnect`が「Process is not running」で exit 14）で、トースト要約に「exit code」、詳細は折りたたみ内にstderr、要約にはstderrを含めない |
| error-502 | proxyコンテナ停止中の接続操作で「プロキシサーバに接続できません」トースト、稼働状況欄は取得失敗表示 |

- E2E実行で上記「E2Eで判明した既存不具合」（422のstderr空）と「proxy障害時に稼働状況が古い値のまま」の2件を発見し、修正後に再実行して全PASSを確認した。
- 未検証: 実際にブラウザ認証を伴う初回ログイン（検証環境は既にログイン済みのため「ログインボタン」はログイン済みメッセージの確認のみ。認証URL表示自体はPhase 2・3で確認済み）、複数ブラウザ・スマートフォン幅での表示。
