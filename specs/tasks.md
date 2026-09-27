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
| ドメイン迂回（split-tunnel）とDNS中継 | proxy, api, web | 複数NIC構成・Raspberry Pi実機は未検証 |
| デプロイメント構成の分離（ロール別配置・認証・mTLS） | api, proxy, web | 未着手の残作業は下記「デプロイメント構成の分離」参照 |
| 設定の動作検証（構成監査・ゲートウェイ内の通信確認・この端末からの確認） | proxy, api, web | 下記「設定の動作検証の検証結果」参照 |

未着手の機能は「未着手の機能」を参照。

## 設定の動作検証の検証結果（Phase 27）

- LXDラボ（`e2e/phase14/lab.sh`＋`e2e/phase27/prepare.sh`。モックVPN・モックDNS）: `e2e/phase27/scenarios.sh`の全シナリオ（A〜I、66項目）がPASS（全項目OK、対象外、VPN未接続、故障の注入〔forward末尾の遮断ルール・迂回の印のルールの削除、上流の停止〕でのNG検出、ゲートウェイを経由しない端末、53番リダイレクトの4区分、409・監査ログ・404・400）。LAN端末役のブラウザ（`e2e/phase27/webgui-phase27.mjs`）で、全項目OK・NGの表示・スマートフォン幅（390px）を確認。
- 実機（検証サーバ・AdGuard VPN・実AdGuard Home）: 迂回ドメイン・53番リダイレクト・明示的プロキシを一時的に有効にし、実LAN端末（開発ホスト上のmacvlanコンテナ、デフォルトゲートウェイ＝検証サーバ）のブラウザで全13項目OK。トンネルへの束縛（`tun0`）、自宅DNSサーバへの`vpngw-selfcheck`での転送、ブラウザの名前解決の誘導を確認。検証後、設定を元に戻した。
- 既知の制約: 「この端末の出口IP」は出口IPの一致で判定するため、同じVPNの出口IPを共有する別の経路（別のVPNゲートウェイ等）を通る端末は区別できない（実機で、別ゲートウェイ経由の開発ホストの出口IPが一致することを確認）。

# 未着手の機能

## デプロイメント構成の分離（残作業）

単一ホスト構成・3台分離構成とも主要な動作（利用者アカウント作成・ログイン・接続・稼働状況取得・mTLSの拒否確認）は実機検証済み（詳細は[apiserver/tasks.md](apiserver/tasks.md)・[proxyserver/tasks.md](proxyserver/tasks.md)・[webserver/tasks.md](webserver/tasks.md)の「デプロイメント構成の分離」節）。残る作業は以下。

- [x] Web UI利用者認証の専用E2E（初回設定画面、正誤ログイン、ログアウト、セッション切れ、アカウント変更）
- [ ] 3台分離構成での実VPN接続操作（接続・切断・国変更）の検証
- [x] `--rotate-pairing`の実機での再配布確認
- [ ] 既存E2E（phase1〜24相当）の網羅的な再実行によるリグレッション確認

# システム全体に関わる将来課題

- 証明書の失効・自動ローテーション（現状は`--rotate-pairing`による手動再発行のみ）。
- 外部認証局（Let's Encrypt等）との連携（現状は自己署名証明書のみ）。
- 複数ゲートウェイの同時管理（現状はAPIサーバ1つに対しゲートウェイ1組の1対1のみ）。
- Raspberry Pi OSの32bit（armhf）・実際のRaspberry Pi機（QEMUエミュレーションではない実物）でのインストーラ検証（arm64は実機ハードウェアで検証済み）。

各アプリケーション固有の将来課題は、[apiserver/tasks.md](apiserver/tasks.md)・[proxyserver/tasks.md](proxyserver/tasks.md)・[webserver/tasks.md](webserver/tasks.md)・[runner/tasks.md](runner/tasks.md)の「将来課題」節を参照。
