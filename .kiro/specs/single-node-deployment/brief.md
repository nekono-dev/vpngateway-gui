# Brief: single-node-deployment

## Problem

LAN 内で VPN ゲートウェイを運用する利用者にとって、Web・API・ゲートウェイを別ホストへ配置する仕組みが導入と保守を複雑にしている。証明書の生成・配布・検証に起因して Web から API へ疎通できない事象が繰り返し発生している。

利用者は製品としての分離配置対応を廃止し、全コンテナを Docker Compose で1台の Linux サーバへ導入する構成だけをサポートしたい。

## Current State

- npm workspaces の web・api・proxy とベンダー runner は別コンテナであり、単一ノードでも動作する。
- root docker-compose.yml は services:{} のアンカー。installer/setup.sh が役割別とベンダー別の Compose fragment を COMPOSE_FILE に組み合わせてサービス一式を構成する。
- インストーラは --web/--api/--gateway、SSH/SCP による配置、トポロジー保存と固定、役割ごとの PKI 生成・配布を持つ。
- Web は証明書必須の HTTPS、Web→API は専用 CA による HTTPS 検証、API→gateway は相互 TLS。API はホストの3000番、host network の gateway は 0.0.0.0:8443 で公開される。
- gateway→runner は共有 volume 上の UDS。管理者認証・セッション・実行可能コマンドの制限は分離配置専用の機能ではない。
- インストーラは IP 転送等のホスト設定、起動時 Kill Switch、再起動依頼処理、導入・更新・削除も担うため、分離機能だけを削って Compose を実行しても同等の運用にはならない。
- 直前の都市選択完了までの作業は dev/multihop-backend の 5ab7d2b にコミット済み。本作業ブランチはそこから作成した dev/single-node-deployment。

## Desired Outcome

- 全サービスを同じ Linux ノードの Docker Compose で導入・起動・更新・停止できる。別ホストの役割・接続先・ペアリングを選ぶ仕組みを製品から撤去する。
- root Compose と文書化された設定から製品一式を定義でき、旧インストーラによる役割 fragment 合成を通常起動の前提にしない。
- Compose だけでは担えない必要最小限のホスト準備を補助スクリプトへ整理する。既存の本格的なインストーラを単一ノード専用に残す案は採用しない。
- LAN 利用を前提に、ブラウザ向け Web HTTPS は既定 OFF。HTTPS を任意に有効化する機能は残し、内部 API の証明書管理と切り離す（利用者の追加決定）。
- Web→API は同じノードの信頼された内部 HTTP 通信とし、API 証明書・CA の必須依存をなくす。API のホスト公開は通常構成で不要とする。
- **API→gateway は SSL/TLS の有効・無効を利用者が選択でき、既定は無効とする**（2026-11-11 の利用者の明示決定）。TLS を無効にした通常構成で証明書生成・配布を必要としない。TLS 有効時の認証方式と証明書の指定方法は設計で具体化する。
- 透過ゲートウェイ・Kill Switch・DNS 中継・管理者認証・ベンダー操作・新方式の運用開始後の保存データとログイン状態の扱いを、配置方式の簡略化と分けて維持する。未リリースの旧方式からの移行・互換対応・データ引き継ぎは考慮不要と利用者が決定した。

## Approach

**採用: Compose 直接導入＋最小限のホスト準備。** 利用者が新規仕様1本の方針と、この導入方式を選択した。

Compose を通常のライフサイクルの入口とし、ホストの IP 転送・起動時の遮断・必要な常駐処理等は補助処理へ切り出す。分離配置・遠隔実行・ホスト間のペアリングと必須 PKI を取り除き、Web/API/proxy/runner の責務分離は維持する。

通信の暗号化設定は接続区間ごとに扱う。Web→API はローカル HTTP、API→gateway は TLS 任意で既定 OFF とする。既存 gateway の host network と API の bridge network の違いを踏まえ、ローカル限定の到達経路・待受範囲・認証境界を設計する。API コンテナ内の localhost を gateway と見なさない。

比較した案:
- 既存インストーラを単一ノード専用へ縮小: 従来の導入コマンドを維持しやすいが、Compose 合成やインストーラ保守が残るため不採用。
- Compose 直接導入でホスト準備まで全面廃止: 現在の IP 転送・起動時ガード等を代替できないため採らない。

規模は中〜大。実装タスクは1仕様内で導入定義・ホスト準備・通信・検証の境界ごとに分ける。既存分離構成の自動移行まで加えて範囲を拡大しない。

## Scope

- **In**:
  - 単一ノードの Compose 定義と設定、ベンダー選択、永続 volume と既定公開ポートの整理。
  - 旧分離トポロジー・遠隔導入・ペアリングの設定、コード、文書の撤去。
  - 必要最小限のホスト準備と、その確認・解除手順。起動時 Kill Switch や再起動依頼等の既存機能を何が担うかを明確にする。
  - Web の HTTP 既定、Web→API の内部 HTTP と API 非公開化、API→gateway の TLS 切り替えと既定 OFF。
  - 既存インストーラ経由の導入・更新・停止・削除・配布手順を Compose 中心へ置き換える。
  - 新方式の設定/データ配置と、その方式内での更新・再起動・削除時の保存データの扱い。
  - hosted E2E、vendor-live 共通クライアント、配布/検査 workflow、README、steering の関連契約更新。
- **Out**:
  - 複数ノードの配置、遠隔デプロイ、分離構成の継続サポート。未リリースの旧方式（単一ノード・分離構成の両方）からの移行・互換対応・データ引き継ぎ。
  - Web/API のプロセス統合、VPN 機能・都市選択・距離計算・多段接続本体の新規実装。
  - 公開インターネット向け運用、外部リバースプロキシ製品との自動連携、証明書の自動取得・更新サービス。

## Boundary Candidates

- **導入契約**: Compose エントリポイント、設定、volume、ベンダー選択、起動・更新・停止・削除。
- **ホスト準備**: sysctl、起動時ガード、必要な systemd/依頼処理。Compose のサービス定義と責務を分ける。
- **ローカル通信**: Web HTTP/任意 HTTPS、内部 API、API→gateway の TLS 設定、runner UDS と認証の既存境界。
- **検証と契約更新**: Compose 経由の lifecycle、HTTP/TLS の組み合わせ、既存 E2E/配布/多段接続の参照先。

## Out of Boundary

- 都市の一覧取得・お気に入り・座標・距離順の意味は変えない。
- 多段接続の段計画・選択・中継規則・状態モデルを本仕様へ吸収しない。
- LAN 内 HTTP を採用することを、管理者認証や runner の許可コマンド制限を撤去する指示とは解釈しない。
- TLS の任意有効化を、別ホストへの製品配置サポートの再導入としない。

## Upstream / Downstream

- **Upstream**: 現行の単一ホスト動作、ベンダーの profile/Compose 宣言、ホストの nftables/ルーティング、既存認証・永続化。
- **Downstream**: e2e-tests の provision/lifecycle、vendor-live-e2e の接続先/CA 設定、インストーラ配布 workflow、multihop-backend のローカル制御/常駐処理/コンテナ定義。
- 作業順: 導入・通信契約を確定 → Compose/ホスト準備と通信実装 → E2E/配布/文書を追従 → 多段接続の未実装タスクに対して新しい前提を再確認する。

## Existing Spec Touchpoints

- **Extends**: 現在の既存仕様に本変更全体の適切な所有先はないため、新規仕様で扱う。
- **Adjacent**:
  - e2e-tests: 旧インストーラの lifecycle、本番起動経路、API 直結 HTTPS/CA 前提を見直す。
  - vendor-live-e2e: 共通 API クライアントの HTTPS 必須・CA 必須設定と接続経路を見直す。実 VPN 試験を hosted CI へ移さない。
  - multihop-backend: API→gateway の HTTPS 前提、slot worker の配布元と依頼ディレクトリ、Compose 定義との整合を再確認する。既存承認を自動で変更しない。
  - location-city-selection/location-distance-sort: 機能の意味は変えず、新導入・通信経路で回帰確認する。

## Constraints

- 新しいランタイム/フレームワーク/ライブラリの導入を前提としない。利用者が対応方式を選んだ後、独立調査で技術的な阻害要因・新たなライセンス競合は見つからなかった。新構成の実機起動は未実施。
- 全コンテナは1 Linux ノード。Compose の sysctls ではホスト全体の準備を代替できないため、必要なホスト処理は残す。
- gateway が host network の場合、ports 指定では公開範囲を制限できない。証明書なしで既存 0.0.0.0:8443 の制御口をそのまま露出させない。到達経路・待受とアクセス制御は設計事項。
- TLS 有効時は適切な証明書検証を行い、検証エラー時に無断で HTTP へ降格しない。既定 OFF の経路は証明書なしで成立させる。
- 任意 Web HTTPS と内部 HTTP を組み合わせる場合、Cookie の Secure 属性と信頼する転送情報の扱いを明確にする。
- 本製品は未リリースであり、旧方式の設定・データ・ベンダーログイン状態からの移行や互換性は保証しない。新方式で運用を開始した後の通常の更新・再起動に対する保存データの保持とは区別する（利用者の追加決定）。
- api/openapi.json と web/src/generated/ は生成コマンドで更新する。
- 要件→設計→タスク→実装の承認フローを守る。discovery は実装承認ではなく、既存 spec.json の承認フラグも変更しない。
