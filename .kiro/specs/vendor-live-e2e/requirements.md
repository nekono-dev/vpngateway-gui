# Requirements Document

## Introduction
本仕様は、実際の VPN ベンダー（Proton VPN・AdGuard VPN）の runner を使った試験を、検証サーバ（aitest）に対して自動で行うための要件を定める。
試験は次の 2 段階で行う。
1. **準備処理（prepare）**: 開発サーバの端末から実行する。すべての認証情報（資格情報・2FA のコード・承認の操作）を端末で対話的に入力し、検証サーバの API でログインを行う。
2. **試験**: 準備処理の直後に、開発サーバから自動で実行する。準備処理で作ったログイン状態を使い、人の入力を必要としない。

検証サーバのブラウザ操作と、検証サーバ上での手動の作業は、いずれも不要とする。
検証の対象は、利用者が API と Web UI から観測できる接続の結果（接続状態と出口 IP）である。

## Boundary Context (Optional)
- **In scope**: 準備処理（管理者の認証、API 証明書の確認、Proton のログイン、AdGuard の device 認証、接続前の基準の記録）、準備処理の失敗時の扱い、
  準備処理の後の試験（接続・切断・出口 IP の確認）、試験の前提となる設定の有効化と復元（要件 8）、プラン（無料・有料）ごとの期待値、試験の途中の失効の扱い、失敗の報告。
- **Out of scope**: 資格情報や 2FA のコードの環境変数・ファイルによる受け渡し、CI での実行、
  AdGuard の device 認証の承認の自動化、検証サーバ上での手動の作業、hosted runner の E2E（`e2e-tests`）のモック構成、
  開発サーバに VPN を接続する試験（開発サーバは試験の対象外）。
- **Adjacent expectations**: `e2e-tests` の基盤（Playwright の設定・API クライアント）を再利用してよい。モック構成は使わない。
  `cicd` は本仕様の試験を CI から呼ばない。試験の間、開発サーバから検証サーバの API に到達できることを、本仕様が前提とする。

## Requirements

### Requirement 1: 準備処理の共通の振る舞い
**Objective:** As a 開発者, I want 試験の前に端末で一度ログインの準備を済ませ, so that 検証サーバのブラウザを開かずに試験を実行できる

#### Acceptance Criteria
1. When 開発者が準備処理を開始する, the 準備処理 shall 最初に検証サーバの API へ到達できるかを確認し、結果を端末に表示する
2. If 検証サーバの API に到達できない, then the 準備処理 shall 中止し、試験を実行しない
3. While 準備処理が資格情報や 2FA のコードを受け取っている, the 準備処理 shall 入力の内容を端末に表示しない
4. The 準備処理 shall 資格情報・2FA のコード・ログイン状態の値を、ファイル、ログ、試験の成果物に書き出さない
5. When 準備処理が完了する, the 準備処理 shall 試験を人の入力なしで開始できる状態として、対象の runner のログイン状態を検証サーバ上に用意する
6. The 準備処理 shall 検証サーバ上での手動の操作を要求せず、すべての操作を開発サーバから検証サーバの API で行う
7. When 準備処理を開始する, the 準備処理 shall 検証サーバの API の証明書を、あらかじめ取り込んだ CA で検証する
8. If 検証サーバの API の証明書を、取り込んだ CA で検証できない, then the 準備処理 shall 中止し、資格情報の入力を求めない
9. When 準備処理を開始する, the 準備処理 shall 管理者のユーザー名とパスワードを端末で入力させ、検証サーバの API に管理者としてログインする
10. If 管理者のログインに失敗する, then the 準備処理 shall 直ちに中止し、「管理者の認証に失敗した」ことを端末に表示する
11. When 準備処理が試験の前に開発サーバの公開 IP を取得する, the 準備処理 shall 取得した IP を接続前の基準として記録し、端末に表示する

### Requirement 2: Proton VPN の準備（ログイン）
**Objective:** As a 開発者, I want 端末で Proton のアカウントと 2FA のコードを入力してログインしたい, so that Proton の runner で試験できる状態になる

#### Acceptance Criteria
1. When 開発者が Proton のユーザー名とパスワードを入力する, the 準備処理 shall 検証サーバの Proton runner へログインを要求する
2. When 2FA のコードが必要なアカウントでログインする, the 準備処理 shall 端末で 2FA のコードを入力させ、入力された直後にログインを要求する
3. If ログインが認証の失敗（資格情報または 2FA のコードの誤り）で失敗する, then the 準備処理 shall 直ちに中止し、「認証に失敗した」ことを端末に表示する
4. If ログインが接続の失敗（runner の応答がない、タイムアウト）で失敗する, then the 準備処理 shall 直ちに中止し、「接続に失敗した」ことを端末に表示する
5. When ログインが成功する, the 準備処理 shall 試験で使うアカウントのプラン（無料または有料）を端末に表示する

### Requirement 3: AdGuard VPN の準備（device 認証）
**Objective:** As a 開発者, I want 端末に表示された承認の URL とコードを、別の端末のブラウザで承認したい, so that 検証サーバのブラウザを開かずに AdGuard の runner を準備できる

#### Acceptance Criteria
1. When 開発者が AdGuard の準備を開始する, the 準備処理 shall 承認の URL と確認コードを端末に表示する
2. While 承認の完了を待っている, the 準備処理 shall 承認の状態を検証サーバの API で確認し続ける
3. When 承認が完了する, the 準備処理 shall AdGuard の runner がログイン済みであることを確認し、端末に表示する
4. If 承認が 5 分以内に完了しない, then the 準備処理 shall 中止し、「承認の時間切れ」を端末に表示する
5. The 準備処理 shall 開発者に検証サーバの Web UI を開かせない（承認は開発者の別の端末のブラウザで行う）

### Requirement 4: 試験の自動実行
**Objective:** As a 開発者, I want 準備処理の後に試験が人の操作なしで実行されること, so that 接続と切断の結果を確認できる

#### Acceptance Criteria
1. When 準備処理が完了する, the 試験 shall 人の入力なしで開始し、検証サーバの API だけで操作する
2. When 試験が接続を要求する, the 試験 shall 接続の後、VPN 経由の出口 IP を観測し、それが準備処理で記録した接続前の基準の IP と異なることを確認する
3. When 試験が切断を要求する, the 試験 shall 切断の後、VPN 経由の出口 IP が観測されない（未接続である）ことを確認する
4. The 試験 shall Proton と AdGuard の両方の runner について、4.2 と 4.3 の確認を行う
5. Where 対象のアカウントが無料プランである, when 試験が接続先を指定する, the 試験 shall 接続先の選択が制限されることを確認する
6. Where 対象のアカウントが有料プランである, when 試験が接続先を指定する, the 試験 shall 指定した接続先へ接続できることを確認する
7. If 試験の途中でログイン状態が失効する, then the 試験 shall その試験を失敗として記録する
8. When 試験が終了する, the 試験 shall VPN の接続を切断した状態にする

### Requirement 5: 失敗の報告
**Objective:** As a 開発者, I want 試験ごとの合否と失敗の理由を端末で確認したい, so that どこで何が違ったかを判断できる

#### Acceptance Criteria
1. The 試験 shall 試験ごとに合否を端末に一覧として表示する
2. If 試験が失敗する, then the 試験 shall 期待した値と実際の値（または応答の内容）を、失敗の理由として表示する
3. If 試験が失敗する, then the 試験 shall 失敗の時点の接続状態と runner の状態を、成果物として保存する
4. The 試験 shall 成果物に、資格情報・2FA のコード・ログイン状態の値を含めない

### Requirement 6: 検証サーバへの到達性
**Objective:** As a 開発者, I want 試験の間、開発サーバから検証サーバの API が使えること, so that 接続の結果を途切れずに確認できる

#### Acceptance Criteria
1. The 試験 shall 試験の開始の前と終了の後に、開発サーバから検証サーバの API へ到達できることを確認する
2. If 試験の途中で検証サーバの API に到達できない, then the 試験 shall 到達できなくなった時点の試験を失敗として記録し、後続の試験を中止する
3. If 試験の途中で検証サーバの API に到達できない, then the 試験 shall 失敗の理由として「検証サーバへの到達の失敗」を端末に表示する

### Requirement 7: 実行の場所と起動
**Objective:** As a 開発者, I want 準備処理と試験を開発サーバの端末から起動したい, so that 資格情報を入力する操作を、開発者の端末に限定できる

#### Acceptance Criteria
1. The 準備処理 and the 試験 shall 開発サーバの端末から、開発者が手動で起動する形でのみ実行できる
2. The 準備処理 and the 試験 shall CI（自動の実行環境）からは起動できない

### Requirement 8: 試験の前提となる設定
**Objective:** As a 開発者, I want 出口 IP の確認に必要な設定を試験の前に有効にし、試験の後に元へ戻したい, so that 検証サーバの設定を変えたまま残さずに試験できる

#### Acceptance Criteria
1. When 試験を開始する, the 試験 shall 出口 IP の確認に必要な設定（透過ゲートウェイまたは明示的プロキシ）が有効であることを確認し、有効でなければ有効にする
2. When 試験が設定を変更する前に, the 試験 shall 変更の前の設定の値を記録する
3. When 試験が終了する（成功・失敗を問わない）, the 試験 shall 記録した設定の値を元に戻す
4. If 設定を元に戻せない, then the 試験 shall 元に戻せなかった設定の名前と記録した値を端末に表示する
