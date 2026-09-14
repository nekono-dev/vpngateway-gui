# Phase 5: Web UI完成（設定ダイアログ・接続ログ）

## 目的

webserver/requirements.mdで定義された画面のうち、Phase1で先送りした「設定ダイアログ」「接続ログ」を実装し、Web UIを仕様上の全画面構成に到達させる。

## 前提

- Phase2完了（ログイン代行APIが利用可能）。ログイン代行の簡易UI（ダッシュボードの「VPNベンダーへログイン」ボタン、`web/src/components/dashboard/VpnLoginButton.tsx`）自体はPhase2で前倒し実装済みのため、本フェーズで新規実装する必要はない（wbs/phase2.md「Step 3: web — 簡易ログインUIの前倒し実装」参照）。
- Phase3/4完了（`killSwitch`・`excludedDomains`・`transparentGatewayEnabled`・`explicitProxyEnabled`・`explicitProxyAllowedCidrs`がAPI経由で実際にproxyへ反映される状態）。

## スコープ外

- 認証UI（ログイン画面等）は対象外（phase7.mdの将来課題）。
- 多言語対応は対象外。

## 主要タスク

- [x] 設定ダイアログ（モーダル）実装: `killSwitch`トグル、`excludedDomains`リスト編集、`defaultCountry`ドロップダウン、`transparentGatewayEnabled`トグル、`explicitProxyEnabled`トグル、`explicitProxyAllowedCidrs`リスト編集（`explicitProxyEnabled=false`時disabled連動）。**2026-09-14、phase2の未完了項目解消の一環として前倒し実装済み**（`web/src/components/dashboard/SettingsDialog.tsx`）。ヘッドレスChromiumで開閉・トグル連動・保存後の永続化を確認済み。
- [x] ダイアログ内保存ボタンによる一括`PUT /v1/connection/config`実装。（上記と同時に実装済み）
- [ ] 接続ログ画面実装（`GET /v1/connection/log`の履歴表示）。
- [ ] APIエラーレスポンスのトースト表示実装（詳細は折りたたみ表示、stderr等の生ログは要約のみを通常表示）。
- [ ] 画面単位のコンポーネントテスト追加。

## 完了基準

- 設定ダイアログから全項目を変更し保存すると、`GET /v1/connection/config`が更新後の値を返すことを確認する。
- `explicitProxyEnabled`をOFFにすると、`explicitProxyAllowedCidrs`入力欄が視覚的にdisabledになることを確認する。
- 接続ログ画面に過去の接続/切断/エラー操作が時系列で表示されることを確認する。
- 意図的にプロキシ未応答（502）・実行失敗（422）を発生させ、トーストにエラー要約が表示され、詳細（stderr）は折りたたみ内に表示されることを確認する。

## 次フェーズへの申し送り

- （Phase3/4完了後に実装しながら追記する）
