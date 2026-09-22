# Phase 13: AdGuard VPN無料版への対応

（2026-09-22追加: 利用者から「AdGuard VPNの無料版に対応したい。無料版でできる操作を確認し、ベンダー分岐ではなく機能制限の分岐のバリエーションとして抽象化した形を保ちながら検討・開発計画を実施してほしい」という依頼があり、実機調査（検証環境・実際に無料アカウントでログイン）を行ったうえで、Phase 12の後に起票する。）

## 目的

AdGuard VPN無料版の実際のCLI挙動を確認し、既存のプロバイダ抽象化（`specs/requirements.md`「プロバイダごとの機能差・プラン制限への対応」「プランで接続できる接続先の参考表示」）の枠組みの中で、無料版固有の性質を表現する。要件は`specs/requirements.md`「プラン制限のバリエーション：候補の絞り込みと補足情報の参考表示」、設計は`specs/apiserver/design.md`「プランの補足情報の参考表示」・`specs/webserver/design.md`「プランの補足情報の参考表示の実装方針」。

## 前提

- Phase 7（プロバイダ抽象化基盤）・Phase 10（ベンダー非依存化）完了。
- 検証環境（`192.168.3.240`、`runner-adguardvpn`コンテナ）で、実際の無料アカウント（`na7c@proton.me`）にログインし、`license`・`list-locations`・`connect`・`site-exclusions`の実出力を確認した（下記「次フェーズへの申し送り」）。調査後、元のPREMIUMアカウント（`na7c@icloud.com`）へ復帰させた。

## スコープ外

- 同時接続デバイス数の制限（無料2台・有料10台）。本システムはランナー1つにつきCLIプロセス1つのみを使うため、このアプリのユースケースでは意味を持たない情報であり、表示・制御の対象にしない。
- データ通信量超過後の速度低下そのものの検知・警告（CLIの出力からは分からず、実際の通信品質の計測が必要になるため対象外。参考表示するのは「残量」のみ）。
- 無料版で一覧に無い接続先を指定した場合の専用エラー分類（`restrictedPattern`化）。理由は`specs/apiserver/design.md`「検討し、採用しなかった案」。
- Proton VPNの`availableLocations`（Phase 12）と同種の「接続先を選べない」制限の追加。AdGuard VPN無料版は接続先を選べるため対象外（下記調査結果）。

## 主要タスク

### 設計・仕様（実装前）
- [x] 実機調査（検証環境・AdGuard VPN無料アカウント）。詳細は「次フェーズへの申し送り」。
- [x] 要件・設計の記述（`specs/requirements.md`・`specs/apiserver/`・`specs/webserver/`）。既存のプラン制限（`restricts`）の枠組みを流用せず、新しい種類の情報（`usageNote`）として設計した（下記「調査結果のまとめ」参照）。

### api（`specs/apiserver/tasks.md`「プランの補足情報の参考表示（Phase 13）」）
- [ ] `PlanDefSchema`へ`usageNote`（省略可）を追加
- [ ] `session-probe.ts`（`evaluateAccountOutput`）の拡張
- [ ] `GET /v1/session`の応答拡張
- [ ] `vendors/adguardvpn/profile.json`の`free`プランへ`usageNote.pattern`を追加
- [ ] `vendors/adguardvpn/samples.json`へ無料版の実出力サンプルを追加
- [ ] 単体テスト

### web（`specs/webserver/tasks.md`「プランの補足情報の参考表示（Phase 13）」）
- [ ] orval再生成・`SessionCard.tsx`への併記・コンポーネントテスト

### 検証
- [ ] 実機（検証環境・AdGuard VPN無料アカウント）で、Web UIのアカウント状態に補足情報（残りデータ通信量）が表示されることを確認。
- [ ] 実機で、無料版でも接続先の選択・接続・切断・分割トンネル（`site-exclusions`）が制限なく動作すること（既存機構のままで対応できていることの回帰確認。コード変更をしないため新規テストは不要だが、実装後の一括確認に含める）。

## 完了基準

- AdGuard VPN無料アカウントでログインしたとき、Web UIのアカウント状態表示に「Free」に加え、残りデータ通信量の参考情報が表示される。
- 有料版、または補足情報が得られないプロバイダ・プランでは、追加表示が何も出ない（エラーにもしない）。
- 無料版でも、接続先を指定した接続・一覧取得・分割トンネルが、既存の実装のまま（コード変更なしで）制限されずに動作する。

## 調査結果のまとめ（2026-09-22、検証環境・実機）

無料アカウント（`na7c@proton.me`）でログインし、`runner-adguardvpn`コンテナで直接CLIを実行して確認した。

| コマンド | 実際の出力・挙動 |
|---|---|
| `adguardvpn-cli license` | `Logged in as na7c@proton.me` / `You are using the FREE version` / `Up to 2 devices simultaneously` / `You have 3.00 GB left for this month` / `Upgrade at https://agrd.io/vpn_cli to get more locations and higher speeds`。既存プロファイルの`plans[].pattern`（`"using the FREE version"`）は実出力と一致し、変更不要。 |
| `adguardvpn-cli list-locations` | エラーにならず実行できる。ただし**10件**に絞り込まれた一覧が返る（US×3・GB・DE・PL・NL・IT・FR・FI）。有料版は公式サイトによれば70件以上（本セッションでは未確認）。出力末尾に常に「FREE version」の注記が付く（**成功時にも出るため、この注記自体はプラン制限の判定に使えない**）。 |
| `adguardvpn-cli connect -l 'Dallas'`（一覧内） | 成功する。無料版でも接続先を指定した接続ができる。 |
| `adguardvpn-cli connect -l 'Tokyo'`（一覧外） | 失敗する（`Failed to start the VPN service in the background: Disconnected`、exit code 13）。Proton VPNの`not available on the free plan`のような、プラン制限固有の文言は無い。 |
| `adguardvpn-cli site-exclusions add/show/clear` | 無料版でも制限なく利用できる（分割トンネル、Phase 14で実装予定の`excludedDomains`相当）。 |

**結論**: AdGuard VPN無料版の制限は、Proton VPN無料版（「接続先を選ぶ操作自体ができない」）とは性質が異なり、「操作はすべて実行できるが、`list-locations`が返す候補の数が絞り込まれる」というものだった。既存の接続先選択の仕組み（`listLocations`の結果からのみ選ばせるWeb UI）は、この絞り込みをコード変更なしにそのまま反映する。したがって、`vendors/adguardvpn/profile.json`の`plans[].restricts`は現状の空配列（`[]`）のままで実態と一致しており、Proton VPNの`availableLocations`（接続先を選べないプラン向けの参考一覧）に相当する仕組みも不要と判断した。

新たに見つかったギャップは、`license`の出力にのみ現れる「残りデータ通信量」という、既存のどの抽象化にも当てはまらない付加情報だった。これを`plans[].restricts`（実行可否）や`plans[].availableLocations`（接続先の参考一覧）とは別の、プラン単位の任意の文字列情報（`usageNote`）として抽象化する（`specs/apiserver/design.md`「プランの補足情報の参考表示」）。ベンダーの文言・単位をそのままキャプチャして表示するだけとし、数値としての解釈・警告判定はしない（将来、他ベンダーが日次上限・時間制限等の異なる性質の制限を持っていても、同じ仕組み（正規表現1つで表示文言を抜き出す）で表現できる）。

## 次フェーズへの申し送り

- 実機調査は、検証環境の`runner-adguardvpn`コンテナで、既存のPREMIUMログイン（`na7c@icloud.com`）を一時的にログアウトし、無料アカウント（`na7c@proton.me`）でログインして行った。調査後、PREMIUMアカウントへ復帰させている（`~/claude-installed.md`は今回アプリの追加インストールが無いため更新不要）。
- `usageNote.pattern`の具体的な正規表現は、上記の実出力例（`You have 3.00 GB left for this month`）をもとに実装時に定める。数値部分・月内リセットの前提（`this month`）はAdGuard固有の性質だが、`pattern`のキャプチャ全体をそのまま表示するため、コード側はこれを解釈しない。
- 有料版の`list-locations`が実際に何件返すか（公式サイトの「70+」の裏取り）は本調査では確認していない（PREMIUMアカウントへの復帰を優先したため）。完了基準には影響しないため、実装時に余裕があれば確認する。
