# ベンダー非依存化（Phase 10）

- [x] 中立性の検査（`scripts/check-vendor-neutrality.mjs`・`scripts/vendor-neutrality.words`）をルートの`npm test`へ組み込む
- [ ] AGENTS.mdへ「ベンダー非依存」の規則を追記（完了。Phase 10の設計時）
- 詳細は`apiserver/tasks.md`・`runner/tasks.md`・`proxyserver/tasks.md`の各節と`../wbs/phase10.md`

# インストーラ（Phase 11）

- 詳細は`proxyserver/tasks.md`「ベンダー非依存化・インストーラ」と`../wbs/phase11.md`

# インストーラの`--providers`省略時のall化（Phase 17）

- 詳細は`../wbs/phase17.md`


# デプロイメント構成の分離（Phase 25）

- 詳細は`apiserver/tasks.md`・`proxyserver/tasks.md`・`webserver/tasks.md`の各節と`../wbs/phase25.md`。

# 将来課題

- 証明書の失効・自動ローテーション（現状は`--rotate-pairing`による手動再発行のみ、Phase 25）。
- 外部認証局（Let's Encrypt等）との連携（現状は自己署名証明書のみ、Phase 25）。
- 複数ゲートウェイの同時管理（現状はAPIサーバ1つに対しゲートウェイ1組の1対1のみ、Phase 25）。
- Web UIからのパスワード変更機能（現状はインストーラの再実行でのみ変更可能、Phase 25）。
