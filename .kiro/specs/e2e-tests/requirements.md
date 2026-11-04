# Requirements Document

## Introduction
本仕様は、現行の実装（Web UI・API サーバ・ゲートウェイ・インストーラ）を結合した状態で検証する E2E テストの要件を定める。
E2E は GitHub-hosted runner 上でのみ実行し、実 VPN アカウント・LXC・検証サーバを使わない。
検証の対象は、利用者・LAN クライアント・インストーラの操作から観測できる振る舞いである。
ネットワーク層の挙動は、LAN クライアントから見た通信結果（到達の可否、送信元 IP、名前解決の結果）で確認する。

## Boundary Context (Optional)
- **In scope**: E2E の実行基盤（要件 1）、初期設定・ログインと管理者アカウントの変更（要件 2）、VPN アカウントのログインと VPN 接続の操作（要件 3）、接続先・ベンダーの切り替え（要件 4）、
  ゲートウェイの LAN クライアント経由の挙動（要件 5〜7）、設定の動作検証（要件 8）、インストーラのライフサイクル（要件 9）、ゲートウェイの再起動依頼（要件 10）、
  画面幅に応じたレスポンシブ表示（要件 11）、Playwright によるフロントエンドの画面検証（要件 12）、設定の保存（要件 13）。
- **Out of scope**: 実 VPN ベンダーへの接続と実アカウントの利用、実 LAN・Raspberry Pi 実機、ホストの実際の再起動、
  LXC・macvlan 固有の構成、検証サーバ上での実行、CI の起動条件と結果の報告、フロントエンドの単体テスト（既存の `npm test` の範囲。E2E は実ブラウザでの検証のみを扱う）。
- **Adjacent expectations**: CI（`cicd` spec）は、要件 1 の実行結果（合否の終了結果と成果物）に依存する。
  インストーラの静的検査（`installer-check`）は本仕様の対象外で、既存の検査をそのまま使う。

## Requirements

### Requirement 1: E2E の実行基盤
**Objective:** As a 開発者, I want 全 E2E を 1 回の実行で再現できるようにしたい, so that 変更の回帰を同じ条件で繰り返し確認できる

#### Acceptance Criteria
1. When 開発者が E2E の実行を開始する, the E2E スイート shall 全シナリオを実行し、シナリオごとの合否を一覧として出力する
2. The E2E スイート shall シナリオ群ごとに初期状態（インストールされていない、管理者アカウントが無い）から始め、群の間で状態を引き継がない
3. When すべてのシナリオが合格する, the E2E スイート shall 成功を示す終了結果を返す
4. If いずれかのシナリオが失敗する, then the E2E スイート shall 失敗を示す終了結果を返し、失敗したシナリオ名と失敗の理由を出力する
5. If いずれかのシナリオが失敗する, then the E2E スイート shall 画面のスクリーンショットと各シナリオの操作ログを成果物として保存する
6. The E2E スイート shall 外部の VPN アカウントとリポジトリ外の秘密情報を必要とせず実行する

### Requirement 2: 初期設定とログイン
**Objective:** As a 利用者, I want 初回に管理者パスワードを設定し、以後はログインして操作したい, so that 認証されていない者が設定や接続を操作できない

#### Acceptance Criteria
1. When 管理者アカウントが存在しない状態で Web UI を開く, the Web UI shall 初期設定画面を表示する
2. When 初期設定画面で同じパスワードを 2 回入力して送信する, the Web UI shall 管理者アカウントを作成し、ダッシュボードを表示する
3. If 初期設定画面の 2 つのパスワードが一致しない, then the Web UI shall 「パスワードが一致しません」を表示し、管理者アカウントを作成しない
4. If ログイン画面で誤ったパスワードを入力する, then the Web UI shall 「パスワードが正しくありません」を表示し、ダッシュボードを表示しない
5. If 同一のクライアントからの認証の失敗が 60 秒以内に 5 回に達する, then the API サーバ shall 次のログイン試行を 429 で拒否する
6. When 失敗の記録が 60 秒より古くなり、60 秒以内の失敗が 5 回未満になる, the API サーバ shall 同一のクライアントからのログイン試行を再び受け付ける
7. If 未ログインの状態で保護された API を要求する, then the API サーバ shall 401 を返し、要求された操作を行わない
8. When 利用者がログアウトする, the Web UI shall ログイン画面へ戻る
9. When 利用者が現在のパスワードを入力して管理者のユーザー名またはパスワードを変更する, the API サーバ shall 変更を保存し、変更後の資格情報で次回のログインを受け付ける
10. If 管理者アカウントの変更で現在のパスワードが正しくない, then the API サーバ shall 401 を返し、ユーザー名とパスワードを変えない

### Requirement 3: VPN 接続の操作
**Objective:** As a 利用者, I want VPN への接続と切断を操作し、その結果を画面で確認したい, so that 通信経路の状態を把握できる

#### Acceptance Criteria
1. When 利用者が接続を要求する, the API サーバ shall 接続状態を「接続済み」として返し、Web UI のダッシュボードに接続済みを表示する
2. When 利用者が切断を要求する, the API サーバ shall 接続状態を「切断」として返し、Web UI のダッシュボードに切断を表示する
3. If VPN のランナーが応答しない, then the API サーバ shall 接続の要求を失敗として返し（502 または 504）、接続状態を変えない
4. The Web UI shall 接続ログの一覧を表示する
5. When 利用者が VPN アカウントの認証情報を入力してログインする, the API サーバ shall ログイン状態とプラン（例: 無料・有料）を返し、Web UI に表示する
6. When 利用者が VPN アカウントからログアウトする, the API サーバ shall ログイン状態を未ログインとして返し、Web UI に未ログインを表示する
7. If VPN アカウントのログインが失敗する, then the API サーバ shall 失敗を示すエラーを返し、Web UI に利用者が分かるエラー通知を表示する

### Requirement 4: 接続先とお気に入り、VPN ベンダーの切り替え
**Objective:** As a 利用者, I want 接続先を選び、お気に入りを管理し、使う VPN ベンダーを切り替えたい, so that 目的の接続先を素早く選べる

#### Acceptance Criteria
1. When 利用者が接続先の一覧を開く, the Web UI shall 利用可能な接続先を表示する
2. When 利用者が接続先をお気に入りに登録する, the Web UI shall その接続先をお気に入りとして表示する
3. When 利用者がお気に入りを解除する, the Web UI shall その接続先をお気に入りとして表示しない
4. When 利用者が有効な VPN ベンダーを切り替える, the API サーバ shall 切り替え後のベンダーを有効なベンダーとして返す
5. When 切り替え前のベンダーで VPN が接続中に、別のベンダーへ切り替える, the API サーバ shall 切り替え前のベンダーの接続を切断してから切り替える
6. When 現在有効なベンダーと同じ ID を指定する, the API サーバ shall 有効なベンダーを変えず、成功として返す
7. If 切り替え先に登録されていない ID を指定する, then the API サーバ shall 400 を返し、有効なベンダーを変えない
8. If 切り替え先ベンダーのランナーが利用できない, then the API サーバ shall 502 を返し、有効なベンダーを変えない
9. If 切り替え前のベンダーの切断が失敗する, then the API サーバ shall 422 を返し、有効なベンダーを変えない
10. While ベンダーの切り替えが実行中である, when 別の切り替えを要求する, the API サーバ shall 409 を返す

### Requirement 5: 透過ゲートウェイ（LAN クライアントの通信経路）
**Objective:** As a 利用者, I want LAN 上の端末の通信が設定どおりの経路を通ることを確認したい, so that VPN の利用対象と遮断の有無を把握できる

#### Acceptance Criteria
1. Where 透過ゲートウェイが有効で VPN が接続済みである, when LAN クライアントが外部のホストへ接続する, the ゲートウェイ shall 通信を VPN 経由で送出し、外部のホストから見た送信元 IP を VPN の出口 IP とする
2. Where 透過ゲートウェイが有効で Kill Switch が有効である, while VPN が未接続である, the ゲートウェイ shall LAN クライアントの外部への通信を遮断する
3. Where 透過ゲートウェイが有効で Kill Switch が無効である, while VPN が未接続である, the ゲートウェイ shall LAN クライアントの外部への通信を遮断せず、WAN へ直接送出する
4. Where 迂回対象ドメインが登録されている, when LAN クライアントが迂回対象ドメインへ接続する, the ゲートウェイ shall 通信を VPN 経由にせず、WAN へ直接送出する

### Requirement 6: DNS 中継と 53 番リダイレクト
**Objective:** As a 利用者, I want LAN 上の端末の名前解決が中継経由になることを確認したい, so that 名前解決の経路と失敗時の動作を把握できる

#### Acceptance Criteria
1. Where DNS 中継が有効である, when LAN クライアントが名前解決を要求する, the ゲートウェイ shall 上流の DNS サーバの応答を返す
2. Where 53 番リダイレクトが有効である, when LAN クライアントが別の DNS サーバへ 53 番ポートで問い合わせる, the ゲートウェイ shall その問い合わせを DNS 中継へ転送する
3. Where DNS 失敗時の動作が failClosed である, if 上流の DNS サーバに到達できない, then the ゲートウェイ shall 名前解決の失敗を返し、フォールバック先の DNS サーバを使わない
4. Where DNS 失敗時の動作が fallback である, if 上流の DNS サーバに到達できない, then the ゲートウェイ shall フォールバック先の DNS サーバで名前解決する

### Requirement 7: 明示的プロキシ
**Objective:** As a 利用者, I want 許可した端末だけがプロキシを使えることを確認したい, so that 明示的プロキシの利用範囲を管理できる

#### Acceptance Criteria
1. Where 明示的プロキシが有効である, when 許可された CIDR 内の端末がプロキシへ接続を要求する, the ゲートウェイ shall 外部への接続を中継する
2. Where 明示的プロキシが有効である, if 許可されていない CIDR の端末がプロキシへ接続を要求する, then the ゲートウェイ shall 接続を拒否する
3. Where 明示的プロキシが有効で VPN が接続済みである, when 許可された端末が中継を要求する, the ゲートウェイ shall 中継先への通信を VPN 経由で送出する

### Requirement 8: 設定の動作検証
**Objective:** As a 利用者, I want 現在の設定が期待どおりに動いているかを検証で確認したい, so that 設定の不備を利用前に把握できる

#### Acceptance Criteria
1. When 利用者が動作検証を開始する, the API サーバ shall 検証を受け付けて 202 を返し、検証の識別子を返す
2. When 利用者が検証の識別子で状態を取得する, the API サーバ shall 検証項目ごとの結果（合格・不合格・対象外）を返す
3. While 検証が実行中である, when 別の検証を開始する, the API サーバ shall 409 を返す
4. Where 機能が無効である, the API サーバ shall その機能に関する検証項目を「対象外」として返す
5. When ブラウザが出口 IP の観測結果を提出する, the API サーバ shall 最初の提出を採用し、2 回目以降の提出では採用済みの結果を変えない
6. When E2E スイートが有効な設定で動作検証を実行する, the E2E スイート shall 対象外でないすべての検証項目が合格であることを確認する

### Requirement 9: インストーラのライフサイクル
**Objective:** As a 開発者, I want インストーラで導入・更新・削除が実ホスト上で正しく行われることを確認したい, so that 利用者の環境に残す変更を検証できる

#### Acceptance Criteria
1. When インストーラで導入を実行する, the インストーラ shall 導入後の状態確認（status）で導入済みを示す
2. When インストーラで指定した版への更新を実行する, the インストーラ shall 指定した版への切り替えを完了し、状態確認にその版を反映する
3. When インストーラでアンインストールを実行する, the インストーラ shall 本システムのサービス定義、ホストのファイアウォールに追加された本システムの規則、および取得先を取り除く
4. When インストーラで `--purge` を指定してアンインストールする, the インストーラ shall 設定・データ・導入メタ情報を削除する
5. Where `--purge` を指定せずにアンインストールする, the インストーラ shall 設定とデータを残す
6. When アンインストールの後に状態確認を実行する, the インストーラ shall 導入されていないことを示す

### Requirement 10: ゲートウェイの再起動依頼
**Objective:** As a 利用者, I want 管理画面からホストの再起動を依頼できることを確認したい, so that 再起動の依頼が重複せず、利用者に結果が返る

#### Acceptance Criteria
1. When 利用者が再起動を依頼する, the API サーバ shall 依頼を受け付けて 202 を返し、応答に依頼の受け付けを示す
2. When 利用者が依頼の受け付けを確認する, the E2E スイート shall ホストの依頼用ディレクトリに依頼ファイルが作られたことを確認する
3. If 再起動の依頼が既に受け付けられている, then the API サーバ shall 2 回目の依頼を 409 で拒否する
4. If ホスト側の依頼受け付けの仕組みが利用できない, then the API サーバ shall 依頼を 503 で返す

### Requirement 11: レスポンシブ表示
**Objective:** As a 利用者, I want 狭い画面（スマートフォン等）でも Web UI の主要な操作ができること, so that 画面幅に関係なく接続と設定の操作ができる

#### Acceptance Criteria
1. The E2E スイート shall 画面幅 1280px（デスクトップ）、600px、420px の 3 種類の幅で、各画面の表示と操作を確認する
2. When 画面幅が 600px 以下で Web UI のダッシュボードを開く, the Web UI shall 接続・切断の操作と接続先の選択を表示し、操作できる
3. While 画面幅が 600px 以下である, the Web UI shall ページ全体に横方向のスクロールを生じさせない
4. While 画面幅が 600px 以下である, when 利用者が設定ダイアログを開く, the Web UI shall ダイアログの全てのタブを横スクロールで選択できる
5. While 画面幅が 420px 以下である, when Web UI が通知を表示する, the Web UI shall 通知を画面の下部に表示する

### Requirement 12: フロントエンドの画面検証（Playwright）
**Objective:** As a 開発者, I want 実ブラウザで Web UI の画面の表示と操作を検証したい, so that 見た目と操作の不具合を API の検証だけで見逃さない

#### Acceptance Criteria
1. The E2E スイート shall Playwright で実ブラウザ（headless Chromium）を操作し、初期設定、ログイン、ダッシュボード、接続先の一覧、設定ダイアログの全タブ、接続ログ、動作検証の各画面が期待する内容を表示することを確認する
2. When E2E スイートが画面上の操作（接続ボタン、お気に入り、ダイアログの開閉、タブの切り替え）を行う, the E2E スイート shall API の応答だけでなく、画面に表示された結果を確認する
3. If Web UI の実行中に未処理の例外または JavaScript のエラーが発生する, then the E2E スイート shall そのシナリオを失敗として扱う
4. If API がエラー応答（例: 502）を返す, then the Web UI shall 利用者に分かるエラーの通知を表示する

### Requirement 13: 設定の保存
**Objective:** As a 利用者, I want 設定ダイアログで変更した設定を保存し、次に開いたときも同じ値で表示されたい, so that 透過ゲートウェイ・DNS・明示的プロキシ・迂回の設定を確実に管理できる

#### Acceptance Criteria
1. When 利用者が設定ダイアログで項目を変更して保存する, the API サーバ shall 設定を保存し、保存された値を返す
2. When 利用者が設定ダイアログを開き直す, the Web UI shall 保存済みの値を表示する
3. If 保存しようとした設定値が不正である, then the API サーバ shall 400 を返し、保存済みの設定を変えず、Web UI に利用者が分かるエラー通知を表示する
4. When 利用者が設定を保存する, the ゲートウェイ shall 保存された設定を要件 5〜7 の挙動へ反映する
