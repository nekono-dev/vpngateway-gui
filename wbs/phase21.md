# Phase 21: ダッシュボードのカード構成・レイアウトの整理

## 目的

利用者からの指摘（ログインフォームの配置、「稼働状況」カードの独立、「ログインしてください」の重複表示、画面の縦幅がビューポートに収まらない）を受け、ダッシュボードのカード構成・レイアウトを整理する。機能追加は行わず、既存の表示・操作の配置のみを変更する。

## 前提

- Phase 16（接続/切断ボタンの配置改善）・Phase 12（参考一覧）までが完了していること。

## スコープ外

- API・データモデルの変更（本フェーズはWeb UIの表示配置のみ）。
- 稼働状況・接続状態の判定ロジック自体の変更（表示位置のみ変更する）。

## 主要タスク

- [x] `specs/webserver/requirements.md`「ダッシュボードのカード構成・レイアウトの整理（Phase 21）」に要件を追記
- [x] `specs/webserver/design.md`に実装方針を追記
- [x] `SessionCard.tsx`から`disconnectAction`・`connectAction`のprops・受け渡しを削除し、ログイン導線のみの責務へ戻す
- [x] `ConnectionStatusCard.tsx`・`GatewayStatusCard.tsx`から外枠（`.card`）を取り除き、`App.tsx`側で1枚のカードにまとめる（枠色判定は`connectionCardClassName`として切り出す）
- [x] `App.tsx`の組み立てを変更（VPNベンダーカードにログイン導線、接続状態カードに接続状態・接続/切断ボタン・稼働状況、接続操作カードは接続先リストのみ）
- [x] `LocationList.tsx`の制限表示に固定id（`location-list-restriction`）を付与、`ConnectButton.tsx`が同じ理由のときは自身の理由表示を省略して`aria-describedby`のみ向ける
- [x] `styles.css`をビューポート高さに収まるレイアウトへ変更（`main`を`100dvh`・`overflow: hidden`、接続先リストの内部スクロールへ残り高さを吸収させる）
- [x] 既存コンポーネントテスト（`App.test.tsx`・`App.provider.test.tsx`・`App.providers.test.tsx`・`SessionCard.test.tsx`・`GatewayStatusCard.test.tsx`）の回帰確認・必要な追従修正
- [x] 「ログインしてください」等の理由文が画面上に重複表示されないことのテストを追加
- [x] **【2026-09-22追記・実機検証で発見した不具合】** 「接続できる国（参考）」一覧（`AvailableLocations.tsx`）表示時、ページ全体がビューポートを超えて表示される不具合を修正（`LocationList.tsx`のunavailableReason分岐を`.location-list`で囲み、`.available-locations`にflexの縦積みを追加）。回帰防止のコンポーネントテスト・実機E2E（`e2e/phase21/webgui-phase21.mjs`）を追加
- [x] `e2e/phase16/webgui-phase16.mjs`のクラス名参照（`.session-top-row`→`.status-top-row`）をPhase21の改称に追従

## 完了基準

- `web`のユニット/コンポーネントテスト（`npm test`）がFAIL 0であること。
- 検証環境（`ubuntu@192.168.3.240`）のブラウザで、①ログインフォームがVPNベンダーカードの隣に表示されること、②稼働状況が接続状態・接続/切断ボタンと同じカードに表示されること、③「ログインしてください」が画面上に1箇所しか表示されないこと、④一般的なブラウザの表示領域（1280x800程度）でページ全体がスクロールしないこと（接続先リストのみ内部スクロールすること）を確認する。

## 検証手法

`web`のユニット/コンポーネントテスト（`npm test`。回帰テストに加え、「ログインしてください」が1回しか表示されないことを確認するテストを追加）、`npm run build`・`tsc`（型チェック）、`scripts/check-vendor-neutrality.mjs`を実行した。実機は検証環境（`ubuntu@192.168.3.240`、GW_MODE=ssh、既存のPhase16スタック）の`web`コンテナのみを本フェーズの資材で再ビルド・再起動し（`api`・`proxy`・`runner-*`は変更していないため未再ビルド）、Playwright（開発ホストのグローバルインストール、`npm root -g`）で`http://192.168.3.240:8080`をヘッドレスChromiumで開き、複数のビューポート（1280x800・400x800・1280x600）で`document.documentElement.scrollHeight`と`clientHeight`の一致（ページ全体がスクロールしないこと）、「ログインしてください」のテキスト出現回数、コンソールエラーの有無をスクリプトで確認した。

## 検証結果（2026-09-22、検証環境ubuntu@192.168.3.240）

- `npm test`（web）: FAIL 0（103件PASS。重複表示なしのテスト、参考一覧が`.location-list`に囲まれていることの構造テストを含む）。
- `tsc -p tsconfig.json`・`npm run build`: エラー無し。
- `scripts/check-vendor-neutrality.mjs`: OK。
- 実機ブラウザ（Playwright、AdGuard VPN未ログイン状態）:
  - VPNベンダーカードに「VPNベンダーへログイン」ボタンが、ベンダー選択の直下に表示されることを確認（ログイン導線の配置）。
  - 接続状態のカードに、［接続］ボタン・接続状態表示（「切断（AdGuard VPN）」）・稼働状況（透過ゲートウェイ・明示的プロキシ）が1枚のカードにまとまって表示されることを確認（稼働状況カードの統合）。
  - 「ログインしてください」がDOM上に1箇所のみ（接続先リストのカード）表示されることを確認（1280x800・400x800・1280x600の全ビューポートで`loginTexts=1`）。
  - 1280x800・400x800の各ビューポートで`document.documentElement.scrollHeight`と`clientHeight`が一致し、ページ全体のスクロールが発生しないことを確認。1280x600（通常のブラウザでは起こりにくい極端に低い高さ）では接続先リストのカードの一部が画面外に収まらず、ページ全体のスクロールもしないため到達できない状態になることを確認した（既知の制約として下記に記載）。
  - コンソールエラー無し。
- **不具合の発見・修正（2026-09-22、利用者からのスクリーンショット指摘）**: ログイン済みでプラン制限により接続先リストが使えないベンダー（実機: Proton VPN無料アカウント、国数10）で、「接続できる国（参考）」一覧の高さがビューポートの制約を受けずページ全体を突き破って表示される不具合を発見。原因は、`LocationList.tsx`のunavailableReason分岐が通常時と異なりFragmentを返しており、`.location-list`が持つflexの縦積み・`min-height: 0`の連鎖から外れていたため。`LocationList.tsx`の当該分岐を`.location-list`で囲み、`.available-locations`にも同じflexの縦積みを与えて修正した。
- 修正の実機再検証: 検証環境の実アカウント（Proton VPN、Free、ログイン済み、国数10）で再現・修正を確認したうえで、恒久的なE2Eスクリプト（`e2e/phase21/webgui-phase21.mjs`）を新設して自動検証した。①初期表示・②「接続できる国（参考）」表示時（不具合の再現条件）・③未ログインのベンダー（AdGuard VPN）へ切り替えた直後、の3状態でいずれも`document.documentElement.scrollHeight <= clientHeight`（ページ全体がスクロールしない）ことと、「ログインしてください」が1箇所しか表示されないことを確認（全項目PASS）。検証はベンダー切替を伴うため、検証後に元のベンダー（Proton VPN）へ戻して環境の状態を変えないようにした。
- 既存の`e2e/phase16/webgui-phase16.mjs`はPhase21のクラス名改称（`.session-top-row`→`.status-top-row`）に合わせて追従修正し、再実行してFAIL 0（実際に接続/切断ボタンの切替を1往復させて確認）。
- ログイン済み状態（Proton VPN等）でのカード表示・重複表示なし・ページ全体のスクロール無しは、上記のとおり`e2e/phase21/webgui-phase21.mjs`で実機確認済み。

## 次フェーズへの申し送り

- **既知の制約**: 画面の縦幅をビューポートに収める実装（`main { overflow: hidden }`）は、極端に低いビューポート高さ（1280x600程度。通常のデスクトップ・タブレットブラウザでは起こりにくい）では、接続先リストのカードの一部がページ内にもページ外スクロールにも到達できなくなる。より低い高さでの利用を想定する場合は、末尾のカードだけページ内スクロールを許容する等の追加対応を検討する。
- 検証環境（`ubuntu@192.168.3.240`）の`web`コンテナは本フェーズの資材で更新済みのまま残している（`api`・`proxy`・`runner-*`はPhase16時点のまま）。選択中のベンダーはPhase21開始前と同じProton VPNへ戻して放置した。次セッションが別内容で検証する場合は、必要に応じて`e2e/lxc/sync.sh`等で資材を転送し直すこと。
- jsdomでのコンポーネントテストはCSSレイアウト（実際の高さ・オーバーフロー）を計算しないため、今回のような「要素は存在するが高さの制約が外れている」不具合は検知できない。画面の縦幅・スクロールに関わる変更をする際は、コンポーネントテストに加えて`e2e/phase21/webgui-phase21.mjs`のような実ブラウザでの`scrollHeight`/`clientHeight`比較を併用すること。
