# タスク一覧について

タスクは、アプリケーションごとの`tasks.md`（[apiserver/tasks.md](apiserver/tasks.md)・[proxyserver/tasks.md](proxyserver/tasks.md)・[webserver/tasks.md](webserver/tasks.md)・[runner/tasks.md](runner/tasks.md)）に、機能実装の単位で記載する。本ファイル（`specs/tasks.md`）は、複数アプリケーションにまたがる機能の索引と、システム全体に関わるタスク・将来課題のみを扱う（各アプリケーション固有の詳細はそれぞれの`tasks.md`が一次情報）。

# 実装済み機能の索引

すべて実装・検証が完了している（個別の未検証事項があるものは備考に記載）。

| 機能 | 対応アプリ | 備考 |
|---|---|---|
| 骨格検証（モックCLI・最小Web・疎通確認） | api, web, proxy, runner | |
| 実VPNベンダーCLI統合・ログイン代行 | runner, api, web | |
| ネットワーク基盤移行＋透過ゲートウェイモード | proxy | IPv6は対象外、複数NICは未検証 |
| Web UI完成（簡易機能版プロトタイプ） | web, api | |
| 接続先選択UIの刷新（ping順リスト・お気に入り） | api, web | |
| 明示的プロキシモード（3proxy） | proxy, api, web | Kill Switch対象外（将来課題） |
| プロバイダ抽象化基盤（実行可否・プラン制限） | api, web | |
| Web UIからのベンダー選択（ネットワーク制御とCLI実行の分離） | proxy, runner, api, web | |
| Proton VPN対応 | runner, api | 有料版の挙動は未検証 |
| ベンダー非依存化（ベンダーバンドル・プロファイル明示化） | api, runner, proxy | |
| インストーラと頒布（1コマンド導入） | proxy | Raspberry Pi実機・armhfは未検証 |
| プランで接続できる接続先の参考表示 | api, web | |
| プランの補足情報の参考表示（AdGuard VPN無料版対応） | api, web | |
| 起動時の接続状態の復元 | api | ホスト全体再起動時の挙動は未検証 |
| 接続/切断ボタンの配置・参考一覧での現在の接続先表示 | web | |
| インストーラの`--providers`省略時のall化 | proxy | |
| インストーラのアンインストール機能 | proxy | |
| インストーラのWeb UIポート指定機能 | proxy | |
| アンインストールの頒布URL対応・取得先ディレクトリの削除 | proxy | |
| ダッシュボードのカード構成・レイアウトの整理 | web | |
| モバイル表示・入力欄の視認性改善 | web | |
| ベンダー選択のプルダウン化・PWA対応 | web | PWAはHTTPS化まで完全動作しない（既知の制約） |
| ログインボタンの配置・枠線色の調整 | web | |
| デプロイメント構成の分離（ロール別配置・認証・mTLS） | api, proxy, web | 未着手の残作業は下記「デプロイメント構成の分離」参照 |

未着手の機能は「未着手の機能」を参照。

# 未着手の機能

## ドメイン迂回（split-tunnel）とDNS中継（Phase 14）

`excludedDomains`を透過ゲートウェイ・明示的プロキシの双方で実際に機能させ、名前解決を自宅DNSサーバ（AdGuard Home想定）へ中継する。設計は[design.md](design.md)「ドメイン単位の迂回とDNS中継の設計方針」、実装タスクは各アプリの`tasks.md`の「ドメイン迂回とDNS中継」節（[proxyserver](proxyserver/tasks.md)・[apiserver](apiserver/tasks.md)・[webserver](webserver/tasks.md)）が一次情報。

- [x] 要件・設計の確定（本節の起票時点）
- [ ] 各アプリの実装（proxy → api → web）
- [ ] 実機検証（検証サーバのテスト用AdGuard Home・モックVPN、続いて実VPN）
- [ ] READMEへのDNS中継・迂回ドメインの導入・設定・制約（暗号化DNS・IPv6・手動DNS指定端末）の追記

完了基準: `excludedDomains`のドメイン宛の通信がVPNを経由せず直接ルートで疎通し、DNSのTTL満了後もIPの変化に追従すること。名前解決が自宅DNSサーバへ転送され、クライアントごとに区別されて履歴へ記録されること（透過ゲートウェイ・明示的プロキシ双方。明示的プロキシは`explicit-proxy`固定）。
## デプロイメント構成の分離（残作業）

単一ホスト構成・3台分離構成とも主要な動作（利用者アカウント作成・ログイン・接続・稼働状況取得・mTLSの拒否確認）は実機検証済み（詳細は[apiserver/tasks.md](apiserver/tasks.md)・[proxyserver/tasks.md](proxyserver/tasks.md)・[webserver/tasks.md](webserver/tasks.md)の「デプロイメント構成の分離」節）。残る作業は以下。

- [ ] Web UI利用者認証の専用E2E（初回設定画面、正誤ログイン、ログアウト、セッション切れ、アカウント変更）
- [ ] 3台分離構成での実VPN接続操作（接続・切断・国変更）の検証
- [ ] `--rotate-pairing`の実機での再配布確認（現状は単体テストのみ）
- [ ] 既存E2E（phase1〜24相当）の網羅的な再実行によるリグレッション確認

# システム全体に関わる将来課題

- 証明書の失効・自動ローテーション（現状は`--rotate-pairing`による手動再発行のみ）。
- 外部認証局（Let's Encrypt等）との連携（現状は自己署名証明書のみ）。
- 複数ゲートウェイの同時管理（現状はAPIサーバ1つに対しゲートウェイ1組の1対1のみ）。
- Raspberry Pi OSの32bit（armhf）・実際のRaspberry Pi機（QEMUエミュレーションではない実物）でのインストーラ検証（arm64は実機ハードウェアで検証済み）。

各アプリケーション固有の将来課題は、[apiserver/tasks.md](apiserver/tasks.md)・[proxyserver/tasks.md](proxyserver/tasks.md)・[webserver/tasks.md](webserver/tasks.md)・[runner/tasks.md](runner/tasks.md)の「将来課題」節を参照。
