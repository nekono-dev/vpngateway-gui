# 単一ノード構成への統一: discovery 記録

## 確定した利用者の意思（2026-11-11）

- これまでの作業を `dev/multihop-backend` にコミットした。コミットは `5ab7d2b`。
- そのコミットから新規作業ブランチ `dev/single-node-deployment` を作成した。
- Web・API・ゲートウェイ等を複数ホストへ分離する製品サポートを廃止し、全コンテナを Docker Compose で1ノードへ導入する構成だけをサポートする。
- discovery の方針は、新規仕様 `single-node-deployment` 1本にまとめる案を利用者が選択済み。既存 E2E・多段接続仕様への影響も確認する。
- LAN 内の利用を前提とし、Web の HTTPS は既定 OFF。SSL 保護を既定無効とし、Web→API は同じサーバ内の信頼されたローカル通信として扱う。証明書で API 疎通が壊れる構成を解消したい。
- main へのマージは行っていない。

## 現行コード調査で判明した主要点

- root docker-compose.yml は services:{} のアンカーで、installer/setup.sh が役割別・ベンダー別 fragment を COMPOSE_FILE に組み合わせる構成。
- インストーラは分離構成以外にもホストの IP 転送・起動時の Kill Switch・再起動処理・導入更新削除を担っている。

## 採用方式

利用者が「Compose 直接導入＋最小限のホスト準備」を選択した。

- root Compose から1ノード分の全サービスを定義できる構成へ変更する。
- ホストの IP 転送・起動時 Kill Switch 等、Compose だけでは完結しない必要処理は補助スクリプトへ整理する。
- 既存インストーラを単一ノード専用として維持する案は採用しない。

## 通信区間の確定事項

- Web の HTTPS は既定 OFF。
- Web→API は同じノード内の信頼されたローカル HTTP として扱い、必須の証明書/CA を撤去する。
- API→Gateway は SSL/TLS の有効・無効を選択可能にする。既定は SSL/TLS 無効（利用者が曖昧な回答を訂正し、明示的に決定）。
- TLS の任意有効化を別ホスト配置の再サポートとはしない。具体的な通信方式・証明書設定・待受範囲は要件/設計で定める。

## Discovery の完了

独立の実現性調査で採用方式に技術的な阻害要因は見つからなかった。ホスト準備、host network と bridge の到達経路、任意 HTTPS 時の Cookie は設計上の制約として残す。新構成の実機起動検証は未実施。

正式な引き継ぎ先は `.kiro/specs/single-node-deployment/brief.md`。既存仕様の承認フラグと製品コードは変更していない。

## 要件生成時の追加決定（2026-11-11）

利用者が次のとおり明示回答した。

1. Web HTTPS の任意有効化は残す。既定 OFF は維持する。
2. この製品は未リリースのため、旧方式からの移行・互換対応・データの引き継ぎは考慮不要。

新方式で運用を開始した後の通常の更新・停止・再作成によるデータ保持は、旧方式からの移行とは分けて扱う。brief へ反映済み。確認待ちの事項は解消した。

## 設計時に判明した確認事項（2026-11-12・回答待ち）

`kiro-spec-design single-node-deployment -y` により要件を承認した。設計調査で、現 Gateway は host network の nft ルールをプロセス終了後も残し、停止処理も未実装であることを確認した。

要件2.8を満たすため、異常終了/強制終了時に最大6秒以内の検知・遮断を許容するか、停止直後からの遮断を要求するかを利用者へ質問中。通常停止は終了前に遮断する案。許容窓は利用者向けの停止時挙動であるため、設計側で推測しない。

調査結果と統合方針は `.kiro/specs/single-node-deployment/research.md` に保存。design.md は確認とレビューゲート通過まで作成しない。新構成の実機試験は未実施。

## 追補（2026-11-19）: ホスト準備に Docker 導入を含める

- 経緯: hosted E2E（実 GitHub ランナー）で、Docker が転送の既定を DROP にするため LAN 転送が落ちることを検出した。旧 installer が担っていた Docker 側の初期設定（daemon.json）が、installer 撤去後は誰にも引き継がれていなかった。実機の導入手順の再考が必要と判断した。
- 決定（利用者）:
  1. ホスト準備 `apply` が `/etc/docker/daemon.json` の作成（`ip-forward-no-drop`）と Docker 再起動を行う（実装済み・未レビュー）。
  2. ホスト準備 `apply` に Docker 導入も含める。新しい常設の installer は作らず、CLI は `check|apply|status|remove` のままとする。
  3. Docker の導入は公式の導入スクリプトを使い、取得元と内容の要約を表示して同意（`--yes` で省略可）を得てから実行する。Docker が既に導入済みなら導入には触れない。
  4. 進め方は「仕様（要件・設計・タスク）を更新・再承認 → 実装 → hosted E2E と LXD ラボでの実機受入（7.3〜7.6）を導入処理込みで実施」。
- 行わないこと: 更新・アンインストールの常設コマンド、導入済み Docker の更新、旧 installer 層の復活。
- 影響する決定の更新: 旧「Docker 自動導入は行わない」（research.md 論点10、design.md Docker 判断、README、roadmap Phase 5）。
- 決定事項（2026-11-19）:
  - Docker 未導入時は公式スクリプトを HTTPS で `https://get.docker.com` から取得し、取得元・内容の要約・取得内容の SHA-256 を表示して同意後に実行する。`--yes` では問い合わせを省くが表示し、製品側でハッシュを固定照合しない。
  - Docker 28 未満の場合は更新内容を表示し、同意（`--yes` 可）後に公式スクリプトで更新する。28 以上なら導入・更新に触れない。
  - Docker があり Compose plugin がない場合は、Debian 12+/Ubuntu 22.04+ に限り導入内容を表示し、同意（`--yes` 可）後に OS のパッケージ管理で導入する。
  - Docker 関連の確認・同意は `apply` の最初に行う。同意しない場合、または対話端末がなく `--yes` もない場合は Docker 以外のホスト設定も変更せず非0で中止し、`--yes` を案内する。
  - Docker が導入済みでも Compose plugin が欠落していれば導入する。対応 OS 外および rootless Docker は従来どおり非対応とし、導入・更新を行わない。
  - `check` は Docker 未導入・28 未満・Compose plugin 欠落を不合格にせず、`apply` が同意を得て導入または更新する旨を表示する。`apply` でも解消できない条件は不合格とする。
  - `remove` は Docker Engine と Compose plugin を撤去せず、製品固有の設定だけを解除し、Docker が残ることと必要な場合の手動撤去を案内する。
  - LXD ラボに Docker 未導入の新しい対応 OS コンテナを追加して導入を含む検証を行い、既存コンテナ `acc-vpngwgui` は導入済み環境の確認用に残す。
