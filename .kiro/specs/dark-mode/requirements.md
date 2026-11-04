# Requirements Document

## Introduction
Web UI（管理画面）を暗い場所や夜間に使う利用者が、白い画面を眩しく感じる。OS をダークに設定していても画面はライトのままになるため、ダークモードを実装する。
テーマの選択は api（サーバ側）に保存し、どのブラウザから開いても同じ表示にする。

詳細な背景と検討経緯は [brief.md](brief.md) を参照する。

## Boundary Context (Optional)
- **In scope**: Web UI の全画面（初期設定・ログイン・ダッシュボード）のテーマ表示、テーマの切り替えボタン、テーマ設定の保存と取得、テーマ設定に伴う `theme-color` の切り替え。
- **Out of scope**: ゲートウェイの運用設定（`UserSettings`）へのテーマの追加、ブラウザ（localStorage）への保存、配色の全面的なデザイン刷新、proxy とインストーラの変更。
- **Adjacent expectations**: 管理者の認証（ログインとセッション）は既存の仕組みをそのまま使う。テーマの取得だけは未ログインでも行える公開の読み取りとする。

## Requirements

### Requirement 1: テーマの選択
**Objective:** As a 管理者, I want 画面の配色を「OS 規定」「ライト」「ダーク」から選びたい, so that 利用環境の明るさに合わせて画面を読みやすくできる

#### Acceptance Criteria
1. When 利用者が画面内のテーマ切り替えボタンを押す, the Web UI shall テーマを「OS 規定 → ライト → ダーク」の順に切り替える
2. When テーマが切り替わる, the Web UI shall 押した直後に、画面全体を新しいテーマの配色で表示する
3. While テーマが「OS 規定」である, the Web UI shall OS の配色設定（ライトまたはダーク）に従って表示する
4. While テーマが「OS 規定」である, when OS の配色設定が変わる, the Web UI shall 画面を再読み込みせずに新しい配色へ追従する
5. The Web UI shall テーマ切り替えボタンを、ログイン後の全画面で見える位置に表示する

### Requirement 2: テーマ設定のサーバ側保存
**Objective:** As a 管理者, I want 選んだテーマをサーバに保存したい, so that どのブラウザから開いても同じ表示になる

#### Acceptance Criteria
1. When 管理者がテーマを切り替えた, the Web UI shall 選んだテーマを api に保存する
2. When 管理者が別のブラウザでダッシュボードを開く, the Web UI shall 保存済みのテーマで表示する
3. If テーマの保存に失敗した, then the Web UI shall 切り替え前のテーマに戻し、保存に失敗したことを利用者に伝える
4. The api shall テーマの値として「OS 規定」「ライト」「ダーク」の3種類だけを受け付ける
5. If テーマに3種類以外の値が指定された, then the api shall 保存せず、その要求を不正な要求として拒否する
6. Where テーマ設定が一度も保存されていない, the api shall テーマを「OS 規定」として扱う

### Requirement 3: 未ログイン時のテーマ表示
**Objective:** As a 利用者, I want ログイン前の画面でも保存されたテーマで表示されてほしい, so that ログイン画面を開いたときに白い画面を見ずに済む

#### Acceptance Criteria
1. When 利用者が未ログインの状態で Web UI を開く, the Web UI shall 保存済みのテーマを api から取得して、初期設定画面またはログイン画面に適用する
2. The api shall 未ログインの要求に対して、テーマの値だけを返す
3. The api shall 未ログインの要求に対して、テーマの取得以外の設定値やアカウントの情報を返さない
4. If テーマの取得に失敗した, then the Web UI shall テーマを「OS 規定」として表示を続ける

### Requirement 4: 白いちらつきの防止
**Objective:** As a 利用者, I want 画面を開いた直後に、白い画面が一瞬見えないでほしい, so that 夜間でも眩しさを感じずに済む

#### Acceptance Criteria
1. While テーマを api から取得している間, the Web UI shall 画面の内容を描画せず、空白を表示する
2. When テーマの取得が完了した, the Web UI shall 取得したテーマで画面の内容を描画する
3. The Web UI shall 描画された最初の画面を、取得したテーマの配色で表示する（ライトからダークへの切り替わりを見せない）

### Requirement 5: 両テーマでの配色の読みやすさ
**Objective:** As a 利用者, I want どちらのテーマでも文字や状態の表示が読めてほしい, so that 配色に関係なく設定と状態を確認できる

#### Acceptance Criteria
1. The Web UI shall ライトとダークの両テーマで、本文の文字と背景の組み合わせに 4.5:1 以上のコントラスト比を保つ
2. The Web UI shall ライトとダークの両テーマで、成功・警告・エラーの状態を、色の意味（緑・黄・赤系）が分かる配色で表示する
3. The Web UI shall ライトとダークの両テーマで、入力欄・ボタン・枠線を背景から視覚的に区別できる配色で表示する（数値の基準は設けず、画面確認で目視により判断する）
4. While テーマが「ダーク」である, the Web UI shall 既存のライト配色で使っていた全ての画面要素（ダッシュボード・初期設定・ログイン・ダイアログ）を、暗い背景の配色に切り替えて表示する

### Requirement 6: ブラウザの表示色への追従
**Objective:** As a 利用者, I want ブラウザやスマートフォンの表示色（アドレスバーなど）もテーマに合わせてほしい, so that 画面全体の見た目が揃う

#### Acceptance Criteria
1. When テーマが切り替わる, the Web UI shall ブラウザに伝える表示色（`theme-color`）を、現在のテーマに合わせた値へ変更する
2. While テーマが「OS 規定」である, the Web UI shall OS の配色設定に応じた表示色を伝える

### Requirement 7: テーマ設定の変更の権限
**Objective:** As a 運用者, I want テーマの保存は管理者だけができるようにしたい, so that 未認証の利用者が設定を書き換えられない

#### Acceptance Criteria
1. If 未ログインの要求がテーマの保存を試みた, then the api shall 保存せず、認証が必要であることを示す応答を返す
2. The api shall テーマの保存を、管理者のログイン済みセッションを持つ要求に限って受け付ける

## Notes
- 画面の確認方法（E2E による画面の検証の範囲と手順）は、設計の段階で決める。
- 実装は、設計で決めた範囲をまとめて一度に完成させる（段階ごとに止めない）。
