# 実装タスク

## プロジェクトセットアップ

- [x] Vite + React（SPA）プロジェクト初期化
- [x] Fastify配信サーバセットアップ
- [x] Dockerfile作成（Webコンテナ）

## APIクライアント生成基盤

- [x] orval設定・`src/generated/api/` への生成確認
- [x] APIサーバのOpenAPI仕様変更時における再生成運用の整備（Dockerビルド内でapiビルド→openapi.json出力→orval生成を連結）

## リバースプロキシ

- [x] `@fastify/http-proxy` による `/api/*` → APIコンテナ（`http://api:3000`等）のリバースプロキシ実装

## 画面: 接続状態ダッシュボード

- [x] 接続状態（接続中/切断/エラー）・国表示実装（ベンダー表示は実装しない。設計方針上APIがベンダーを識別・選択可能にしないため、Web UIも1ベンダー運用を前提とし表示しない）
- [x] 透過ゲートウェイ稼働状況表示実装（`GET /v1/connection/gateway`。稼働中/停止/Kill Switch遮断中/未構成/ルール適用エラー。接続状態と1つの5秒ポーリングに合流。`GatewayStatusCard.tsx`・`useDashboardPolling.ts`。2026-09-21実装、実機E2E確認済み）
- [x] 明示的プロキシ稼働状況欄: 「未対応（Phase 6で対応予定）」暫定表示（2026-09-21実装）→ Phase 6で実状態表示（稼働中＋待ち受けポート/停止/未構成/起動失敗の繰り返し/設定ファイル生成エラー）へ置換済み（`GatewayStatusCard.tsx`）
- [x] 接続国表示（`GET /v1/connection`の`country`／`location`を表示。当初はクライアントのメモリ保持による暫定対応としたが、再読み込みで消える不具合のため、API側の永続化（apiserver/tasks.md）へ移行しクライアント保持は撤去。2026-09-21）
- [x] 最小限のスタイル適用（`styles.css`。レイアウト・状態の色分け・ボタンの視認性のみ。2026-09-21実装）
- [x] 設定ダイアログ起動ボタン実装（2026-09-14: 設定ダイアログ本体と合わせて実装。下記「画面: 設定ダイアログ」参照）
- [x] ログイン代行ボタン実装（`POST /v1/session`呼び出し・返却されたログインURL/メッセージの表示。Phase2で前倒し実装。ログイン完了後の状態反映は既存の接続状態ポーリングに委ね、待機処理は持たない）

## 画面: 接続操作

- [x] 接続国ドロップダウン実装（プロファイル定義の選択肢のみ、自由入力不可。**Phase 5で接続先リストへ置換**）。ベンダー選択UIは実装しない（1サーバー1ベンダーの設計方針、apiserver/requirements.md参照）
- [x] 接続/切断ボタン実装（二重送信防止・ローディング表示）

## 画面: 接続操作の刷新 (Phase 5)

設計は`design.md`「接続先リストの実装方針（Phase 5）」。

- [x] orval再生成（`GET /v1/connection/locations`・`PUT/DELETE .../favorite`・`PUT /v1/connection`の`locationId`反映）
- [x] `useLocations`フック（取得・再取得・★の楽観的更新・`lastConnected`のローカル更新）
- [x] 接続先リスト（`LocationList`／`LocationRow`。タブ「すべて」「お気に入り」、絞り込み、ping表示、選択、★、「接続中」「前回」バッジ、再計測、取得失敗のインライン表示）
- [x] 接続／切断／「接続先を変更」ボタン（`ConnectionActions`）。`ConnectDisconnectButton`・`CountrySelect`を置換・削除
- [x] 設定ダイアログから`defaultCountry`を削除
- [x] 接続ログの接続先表示を`locationId`対応にする
- [x] コンポーネントテスト

検証: コンポーネントテストと、実ブラウザ（`e2e/phase14/webgui-phase14.mjs`）で設定の入力・保存前チェック・保持・稼働状況の表示を確認。
- [x] 実VPNでのE2E（`e2e/phase5/`。2026-09-21実施、46項目PASS）

## 画面: 設定ダイアログ (Phase 2で前倒し実装済み)

2026-09-14実装。`SettingsDialog.tsx`（ネイティブ`<dialog>`要素によるモーダル）を追加し、`GET`/`PUT /v1/connection/config`と接続した。ヘッドレスChromium（Playwright）でダイアログの開閉・トグル連動・保存後の永続化と再読込での反映を確認済み。

- [x] `killSwitch` トグルスイッチ実装
- [x] `excludedDomains` リスト編集UI実装（複数行入力→配列変換。`LineListEditor.tsx`として`explicitProxyAllowedCidrs`と共通化）
- [x] ~~`defaultCountry` ドロップダウン~~（**Phase 5で廃止**。下記参照）実装（ダッシュボードの接続国選択と同じ`GET /v1/connection/countries`の一覧を再利用。1サーバー1ベンダー運用のため`GET /v1/vendors/{vendor}/countries`は実装しない）
- [x] `transparentGatewayEnabled` トグルスイッチ実装
- [x] `explicitProxyEnabled` トグルスイッチ実装
- [x] `explicitProxyAllowedCidrs` リスト編集UI実装（`explicitProxyEnabled` OFF時disabled連動）
- [x] ダイアログ内保存ボタンによる一括 `PUT` 実装
- [x] 明示的プロキシ／`excludedDomains`項目への「未対応（反映されません）」暫定表示（2026-09-21追加）。明示的プロキシ分はPhase 6で除去済み。`excludedDomains`分はPhase 14で除去する（webserver/requirements.md「未実装機能の暫定表示」参照）

## 画面: 接続ログ (Phase 4)

- [x] 監査ログ取得・履歴表示実装（`ConnectionLogDialog.tsx`。モーダルで新しい順に日時・操作・接続国・結果を表示。2026-09-21実装）
  - 履歴に残るのは「プロキシまで到達しCLIを実行した操作」のみ（`POST /v1/session`と`PUT /v1/connection`）。プロキシ未応答（502/504）で実行に至らなかった操作は記録されない（apiserver側の仕様）。

## 状態管理・エラー表示

- [x] 状態のポーリング実装（デフォルト5秒間隔・画面表示中のみ）
- [x] APIエラーレスポンスのトースト表示実装（要約を通常表示、詳細（stderr等）は`<details>`折りたたみ。エラーは手動で閉じるまで残し、成功通知は4秒で消える。`notifications/`。2026-09-21実装）
  - 例外: 設定ダイアログ・接続ログダイアログ内の操作エラーは、モーダル表示中はダイアログ外のトーストが操作不能になるため、ダイアログ内のインライン表示（`role="alert"`）に留める。

## テスト

- [x] 画面単位のコンポーネントテスト（vitest＋jsdom＋Testing Library。`App.test.tsx`等。2026-09-21実装）
- [x] Web⇄API（実API・実VPN）でのE2E動作確認（`e2e/phase4/`。2026-09-21実施、25項目PASS）

## 操作の制限表示（Phase 7）

- [x] orval再生成（`capabilities`・`session`）
- [x] `capabilities/capability-state.ts`と単体テスト
- [x] `useDashboardPolling`へ`capabilities`・`session`を追加（独立した成否・取得失敗時は制限なし）
- [x] `SessionCard`・`LoginForm`・`RestrictionNote`の実装とコンポーネントテスト（`deviceUrl`／`credentials`の切替、秘密の欄の消去、ログアウト）
- [x] `LocationList`・`ConnectionActions`の`capabilities`対応（無効化＋理由、`connectAuto`の［接続］、リスト全体の理由表示）と`useLocations`の`enabled`
- [x] `403 operation_restricted`／`501`のトースト文言（`describe-api-error.ts`）と、403後の`capabilities`再取得
- [x] Web⇄API（モックプロバイダCLI）でのE2E（`e2e/phase7/`。Playwright。36項目PASS。2026-09-21）

## ベンダーの選択（Phase 8）

- [x] orval再生成（`providers`）
- [x] `useDashboardPolling`へ`providers`を追加（独立した成否・取得失敗時は選択部品なし）
- [x] `ProviderSelector`（1つのときは名前のみ・利用不可の無効化＋理由・接続中の確認ダイアログ・送信中の無効化）とコンポーネントテスト
- [x] ベンダー切替時の状態の入れ替え（`key`による再マウント・`useLocations`の再取得・`selectedId`の消去）
- [x] `ConnectionStatusCard`へのベンダー名の表示、`409`のトースト文言（`describe-api-error.ts`）
- [x] Web⇄API（AdGuard VPN＋モックプロバイダ）でのE2E（`e2e/phase8/`。Playwright。27項目PASS。2026-09-21）

## プランで接続できる接続先の参考表示（Phase 12）

- [x] orval再生成（`GET /v1/connection/available-locations`）
- [x] `useAvailableLocations`（取得・世代管理・失敗時は表示なし）と単体テスト
- [x] `AvailableLocations`と`LocationList`への組み込み、コンポーネントテスト
- [ ] Web⇄API（Proton VPN相当のモック）でのE2E（コンポーネントテストで代替。実機のブラウザ表示は利用者の目視待ち）

## プランの補足情報の参考表示（Phase 13、検証完了）

- [x] orval再生成（`GET /v1/session`の`plan.usageNote`）
- [x] `SessionCard.tsx`へ、プラン名への`usageNote`の併記を実装（無ければ何も追加しない）
- [x] コンポーネントテスト（`usageNote`あり/なし）
- [x] 実機（検証環境・AdGuard VPN無料アカウント）でのブラウザ表示確認

## 接続・切断ボタンの配置・強調（Phase 16、検証完了）

- [x] `DisconnectButton.tsx`を切り出し、`ConnectionActions.tsx`からは切断ボタンを除去（当初は接続／接続先を変更のみ残した）
- [x] `SessionCard.tsx`が`disconnectAction`（`ReactNode`）を受け取り、アカウント状態表示の左（`session-top-row`）に描く。ログイン状態の判定に表示を左右させない
- [x] `App.tsx`から接続中のみ`DisconnectButton`を渡すよう配線
- [x] `styles.css`に`button.danger`（`--danger`を背景色に使う強調色）を追加
- [x] 既存コンポーネントテスト（`App.test.tsx`等）の回帰確認
- [x] 検証環境（実機）のブラウザ（Playwright）での配置・配色の確認（`e2e/phase16/webgui-phase16.mjs`）
- [x] **【2026-09-22追記】** 実機確認で、接続先リストが多数のとき［接続］ボタンが依然リストの下に取り残される不具合を発見。`ConnectButton.tsx`を同様に切り出し、`SessionCard.tsx`の`connectAction`として同じ位置へ配置。`ConnectionActions.tsx`は［接続先を変更］のみを扱うよう更新し、単体テスト（`current-available-location.test.ts`は影響なし、既存コンポーネントテストの回帰確認）と実機（Playwright）で接続⇄切断のたびに正しい一方だけが表示されることを確認

## 参考一覧での現在の接続先の表示（Phase 16、検証完了）

- [x] `locations/current-available-location.ts`（`findCurrentAvailableLocation`）と、接続先リストと同じ行形式への`AvailableLocations.tsx`の書き換え（選択・お気に入りは常に無効化）
- [x] `capabilities/capability-state.ts`に`supportsLocationPing`を追加（`pingMeasurement`の`reason`が`"unsupported"`のときだけping列を出さない。プラン制限からの継承とプロバイダ非対応を区別）
- [x] `LocationList.tsx`・`App.tsx`への組み込み（`currentAvailableLocation`・`availableLocationsShowPing`の配線）
- [x] コンポーネントテスト（`App.provider.test.tsx`: 現在の接続先のバッジ表示、選択・お気に入り操作ができないことの確認、ping非対応時に列が出ないことの確認）
- [x] 検証環境（実機。Proton VPN無料アカウント）での接続中の表示確認（`e2e/phase16/webgui-phase16.mjs`）。検証中に判定ロジックの不具合（CLIの複合表記に一致しない）を発見・修正（`current-available-location.test.ts`追加）

## ダッシュボードのカード構成・レイアウトの整理（Phase 21、不具合修正・再検証完了）

- [x] `SessionCard.tsx`から`disconnectAction`・`connectAction`を削除し、ログイン導線のみの責務へ戻す
- [x] `ConnectionStatusCard.tsx`・`GatewayStatusCard.tsx`から外枠（`.card`）を除去し、`connectionCardClassName`を切り出す
- [x] `App.tsx`の組み立てを変更（VPNベンダーカードにログイン導線、接続状態カードに接続状態・接続/切断ボタン・稼働状況を統合、接続操作カードは接続先リストのみ）
- [x] `LocationList.tsx`に固定id（`location-list-restriction`）、`ConnectButton.tsx`で同じ理由のときの重複表示回避
- [x] `styles.css`を`100dvh`・flexの連鎖でビューポートに収まるレイアウトへ変更
- [x] 既存コンポーネントテストの回帰確認、重複表示なしの新規テスト追加
- [x] 検証環境（実機）のブラウザ（Playwright）でのカード配置・重複表示なし・画面が1画面に収まることの確認
- [x] 【不具合修正】「接続できる国（参考）」一覧がページ全体を突き破る不具合を修正（`.location-list`の外枠漏れ）。回帰防止のコンポーネントテスト・実機E2E（`e2e/phase21/webgui-phase21.mjs`）を追加

## モバイル表示・入力欄の視認性改善（Phase 22、実装完了・検証完了）

- [x] `specs/webserver/requirements.md`「モバイル表示・入力欄の視認性改善（Phase 22）」に要件を追記
- [x] `specs/webserver/design.md`に実装方針を追記
- [x] `styles.css`の入力欄スタイルを`input`全体へ拡大し、`--input-border`・`font-size: 1rem`・`padding`拡大を適用
- [x] `SessionCard.tsx`の「アカウント: 未ログイン」表示を削除し、ログイン済み時は`badge badge-ok`で色分け表示
- [x] `App.tsx`に`.controls`の展開判定（`controls-expanded`）を追加し、`styles.css`の`.controls`既定を`flex: 0 0 auto`へ変更
- [x] `components/icons/GithubIcon.tsx`（インラインSVG）とフッター（`App.tsx`・`styles.css`）を追加
- [x] 既存コンポーネントテスト（`App.provider.test.tsx`）の回帰確認・追従修正
- [x] 検証環境（実機）のブラウザ（Playwright）で、①入力欄の見た目（枠線色・文字サイズ・padding）、②「アカウント: 未ログイン」が表示されないこと、③ログイン済み時の色分け表示、④接続先が0件・制限時に接続操作カードが余分な高さを取らないこと、⑤フッターのGitHubリンクを確認（`e2e/phase22/webgui-phase22.mjs`）

## ベンダー選択のプルダウン化・PWA対応・モバイル表示の改善（Phase 23、検証完了）

- [x] `specs/webserver/requirements.md`「ベンダー選択のプルダウン化・PWA対応・モバイル表示の改善（Phase 23）」に要件を追記
- [x] `specs/webserver/design.md`に実装方針を追記
- [x] `ProviderSelector.tsx`をラジオボタンの並びからプルダウン（`<select>`）へ変更
- [x] `SessionCard.tsx`を`Fragment`化し、単発ボタン（ログアウト／URL提示型ログイン）を`session-action`、それ以外（状態表示・フォーム・制限理由）を`session-extra`として分離
- [x] `styles.css`に`.provider-card`（CSS Grid）・プルダウンのテキストボックス風装飾（`appearance: none`＋自前の矢印）・`--input-border`のグレー化・モバイル幅での余白詰め・縦積み・`overscroll-behavior-y: none`を追加
- [x] PWA資材（`web/public/manifest.webmanifest`・`sw.js`・アイコン一式）を追加し、`index.html`・`main.tsx`から参照・登録
- [x] 既存コンポーネントテスト（`App.providers.test.tsx`）をプルダウン操作へ追従修正
- [x] 検証環境（実機）のブラウザ（Playwright、デスクトップ幅・モバイル幅）で、プルダウン化・装飾・行内配置・枠線色・レイアウト崩れなし・PWA資材の配信を確認（`e2e/phase23/webgui-phase23.mjs`）。**既知の制約**: PWAのService Workerは、配信がHTTP（`window.isSecureContext`が`false`）のセキュアコンテキスト要件により実機では有効化されない。配信のHTTPS化は本機能のスコープ外（manifest・アイコンによる基本的な識別は機能する）

## ログインボタンの配置・入力欄の枠線色の調整（Phase 24、検証完了）

- [x] `specs/webserver/requirements.md`「ログインボタンもプルダウンの隣へ・入力欄の枠線色をボタン同等の薄さへ（Phase 24）」に要件を追記
- [x] `specs/webserver/design.md`に実装方針を追記
- [x] `SessionCard.tsx`に`showCredentialsForm`状態を追加し、資格情報入力型ログインも「ログイン」ボタンをプルダウンの隣（`session-action`）に表示、押すまでフォームを表示しないよう変更
- [x] `styles.css`の`--input-border`をボタンの枠線色（`--border`、`#d0d7de`）と同じ値へ変更
- [x] 既存コンポーネントテスト（`App.provider.test.tsx`）を「ログイン」ボタンのクリックを挟むよう追従修正
- [x] 検証環境（実機）のブラウザ（Playwright）で、資格情報入力型ログインのボタン化・クリック前後のフォーム表示切替・枠線色（`rgb(208, 215, 222)`）を確認（`e2e/phase24/webgui-phase24.mjs`）

## デプロイメント構成の分離（Phase 25）

- [x] ログイン画面（`components/auth/LoginPage.tsx`）・認証状態コンテキスト（`AuthContext.tsx`）・401時の遷移
- [x] `API_ORIGIN`のHTTPS対応（CA証明書の検証設定。`web/server/tls-options.ts`の`loadApiCaCertificate()`）
- [x] Webサーバ自身のHTTPS化（Fastifyの`https`オプション。`web/server/tls-options.ts`）
- [x] 実機検証: 単一ホスト構成で、既存の実ブラウザE2E（phase21・phase22）が認証ゲートを自動突破してPASSすることを確認（Playwrightの共通ヘルパーが初期設定・ログインを自動で済ませる）。分離構成でも、Web UI（`https://<webのIP>`）からのアカウント作成・ログイン・ベンダー一覧取得・ゲートウェイ稼働状況取得をcurlで確認
- [ ] Web UI利用者認証専用のE2Eシナリオ（未ログイン時の遷移、ログイン・ログアウト、セッション切れ、アカウント変更）は未作成（手動でのブラウザ確認は実施済み）
- [ ] 既存E2E（phase1〜24相当）の網羅的な再実行によるリグレッション確認は未実施

## ドメイン迂回とDNS中継の設定UI（Phase 14）

設計は`design.md`・`requirements.md`「設定ダイアログの入力項目」。

- [x] 設定ダイアログへ「DNS中継」グループを追加（トグル・URL・PEM・ラジオ・リスト編集）と無効化条件
- [x] `excludedDomains`の「未対応」暫定表示の除去と、DNS中継OFF時の注意表示への置換
- [x] 稼働状況欄へ`dnsRelay`（状態・上流の疎通・迂回IP数）を表示
- [x] コンポーネントテスト

# 将来課題

- 多言語対応。
- WebSocket等によるリアルタイム状態通知への切替（ポーリング間隔・サーバ負荷が問題になった場合）。
