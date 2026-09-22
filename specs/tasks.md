# ベンダー非依存化（Phase 10）

- [x] 中立性の検査（`scripts/check-vendor-neutrality.mjs`・`scripts/vendor-neutrality.words`）をルートの`npm test`へ組み込む
- [ ] AGENTS.mdへ「ベンダー非依存」の規則を追記（完了。Phase 10の設計時）
- 詳細は`apiserver/tasks.md`・`runner/tasks.md`・`proxyserver/tasks.md`の各節と`../wbs/phase10.md`

# インストーラ（Phase 11）

- 詳細は`proxyserver/tasks.md`「ベンダー非依存化・インストーラ」と`../wbs/phase11.md`


# 将来課題

- 認証・認可の追加（Web⇄API間は同一オリジン構成のため、ドメイン分離に起因する問題を避けつつセッション認証等を追加できる）。
