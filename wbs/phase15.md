# Phase 15: 運用強化・将来課題

## 目的

specs各ファイルの「将来課題」節に列挙された、初回リリースの必須要件ではないが本番運用に向けて必要になる項目に対応する。

## 前提

- Phase1・2・3・4・6・14完了（機能面ではspecsの最終形に到達している）。Web UI本体（接続ログ・トースト等）はPhase4で前倒し実施済み（実施順は`wbs/README.md`参照）のため、本フェーズの「Web UI強化」は認証UI・多言語対応・WebSocket通知のみを対象とする。

## 主要タスク（specsの「将来課題」節からの集約）

### 認証・認可（specs/tasks.md, apiserver/tasks.md, webserver/tasks.md）

**【2026-09-22追記】本節はPhase25（`wbs/phase25.md`）へ前倒し・吸収した。Phase25完了後、本節は除去する。**

- [ ] セッション認証（Cookieベース等）の追加。Web⇄API間は既に同一オリジン構成のため、ドメイン分離に起因する問題を避けつつ追加できる。
- [ ] Fastifyの`preHandler`フックへのセッション検証挿入。
- [ ] 認証UI（ログイン画面等）の追加。

### API運用強化（apiserver/tasks.md）
- [ ] レート制限（接続操作の連続実行を防ぐ）。
- [ ] 監査ログの長期保存・ローテーション方針の確定・実装。

### プロキシ運用強化（proxyserver/tasks.md）
- [ ] 明示的プロキシ（3proxy）へのKill Switch適用。現状のKill Switchは`forward`チェーンのみのため、VPN未接続の間、`killSwitch=true`でも明示的プロキシ経由の通信は実回線から直接出る（Phase 6の実機検証で実測。`proxyserver/design.md`「Kill Switchの対象外」）。3proxy専用のUIDで起動し、`inet vpngwgui`の`output`チェーンでそのUIDのVPN未接続時の発信をdropする案がある（現状は同一UID`vpngwgui`で起動しているため要分離）。
- [ ] 明示的プロキシのユーザ名・パスワード認証（現状は送信元IPのCIDRのみ）。
- [ ] 設定変更時の3proxy再起動（SIGTERMから終了まで約5秒応答が途切れる）の短縮。3proxyの設定再読み込み（SIGUSR1）で無停止化できるか検討する。
- [ ] IPv6対応（現行設計はIPv4のNAT/FORWARDのみを前提としているため、必要性を再評価の上対応）。
- [ ] 複数VPNベンダー・複数トンネルの同時稼働可否の検討。

### Web UI強化（webserver/tasks.md）
- [ ] 多言語対応。
- [ ] WebSocket等によるリアルタイム状態通知への切替（ポーリング間隔・サーバ負荷が問題になった場合に再検討）。

### インストーラ・実機検証（Phase 11からの申し送り）
- [ ] Raspberry Pi OSの32bit（armhf・`ID=raspbian`）と、実際のRaspberry Pi機（QEMUエミュレーションではない実機）でのインストーラ検証。arm64については実機ハードウェア（Debian 13）でKill Switchの実通信を含め検証済み（`wbs/phase11.md`「追加の検証結果」）だが、Raspberry Pi実機・armhfは2026-09-22時点で未検証のまま最終フェーズへ申し送る。

### テスト・品質
- [ ] E2Eテストの拡充（Phase1・2・3・4・6・14で個別に確認した手順の自動化）。Phase 5で「接続国」セレクトが廃止された結果、`e2e/phase4/webgui-dashboard.mjs`のうち`flow`・`error-422`・`error-502`が旧UIを前提に失敗している（Phase 6の検証中に判明）。Phase 5の接続先リストに合わせて更新すること。
- [ ] Phase1で許容した設定ストアの単純read-modify-write方式（同時書き込み競合を考慮しない）の見直し要否の判断。

## 完了基準

各タスクは独立性が高いため、着手時に個別のPull Requestまたは作業単位で完了基準を都度定義する。

## 次フェーズへの申し送り

- 本フェーズが完了した時点で、`specs/tasks.md`および各サービスの`tasks.md`の「将来課題」節を更新し、対応済み項目を実装済みとして反映すること。
