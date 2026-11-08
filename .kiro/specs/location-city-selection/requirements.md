# Requirements Document

## Project Description (Input)
- **誰が問題を抱えているか**: 都市を指定して接続できる VPN プロバイダ（ProtonVPN・AdGuard VPN）を使い、国と都市を選んで接続したい利用者。プロバイダの機能を最大限生かしたい。どのプロバイダでも同じ操作で選べることを重視する。
- **現状**:
  - ProtonVPN: 接続先の一覧は国単位だけで、都市は一覧に出ない。接続は国指定だけに対応している。都市は国ごとのベンダーの一覧でしか取得できない。
  - AdGuard VPN: 一覧は都市の平らな行だけで、国だけを選ぶ手段が画面に無い。
  - プロバイダごとに、接続先の一覧の見え方と選び方が異なる。
- **変えたいこと**: 両プロバイダで、同じ UI で国と都市を選べるようにする。国の行を選ぶと、その国の都市の一覧に切り替わる。都市の一覧では「最速サーバ」か「サーバを選択」で接続の仕方を選ぶ。ProtonVPN の都市の一覧は、その国を開いたときに初めて取得して保存し、国ごとに一度だけ取得する。ping を計測できないプロバイダでは、国の行と都市の行を、利用者の国の首都からの距離の順に並べる（規則は `location-distance-sort` に従う）。
- 詳細は [brief.md](brief.md) を参照。一覧の UI の細部は [ui-conventions.md](../../steering/ui-conventions.md) に従う。

## Introduction
ping を計測できるプロバイダでは ping の順、計測できないプロバイダでは利用者の国の首都からの距離の順に、接続先を並べる。国の行を選ぶと都市の一覧に切り替わり、都市の一覧の「最速サーバ」では都市を選んで接続する。サーバの段があるプロバイダ（ProtonVPN）では、「サーバを選択」でその都市のサーバを Score の順で一覧から選べる。お気に入りは、都市かサーバの単位で登録する。

## Boundary Context
- **In scope**:
  - 国の一覧と都市の一覧の切り替え、戻る操作
  - 都市の一覧のタブ（「最速サーバ」「サーバを選択」）と、そのタブの設定の保存
  - ProtonVPN のサーバ一覧（都市内の全サーバ。Score の順）
  - お気に入り（都市単位・サーバ単位。プロバイダごと）
  - ProtonVPN の都市の一覧の取得と保存（国ごと）
  - 国・都市・サーバを指定した接続
  - ping の有無による並べ替えの切り替え（ping の順、または距離の順）と、各行の距離の表示
- **Out of scope**:
  - 都市の座標の取得、距離の計算と距離順の規則（`location-distance-sort` で扱う）
  - Secure Core のサーバの表示（別の仕様で扱う）
  - 無料プランでの都市・サーバの指定（既存のプラン制限に従い、指定できない）
  - 接続・切断の処理そのものの変更（接続の引数を渡すことを除く）
- **Adjacent expectations**:
  - `location-distance-sort` は、距離の計算と距離順の規則を提供する。本 spec は、国の行と都市の行（国コード・国名・都市名）を渡し、並べ替えた順序と距離を受け取る。
  - 接続先の一覧の取得、ping を計測できるかの判定、プラン制限の判定は、既存の仕組みの結果を使う。
  - 利用者の画面の操作（接続中・前回のバッジ、再計測、再取得）は、既存の表示と操作を使う。

## Requirements

### Requirement 1: 国の一覧と都市の一覧の切り替え
**Objective:** As a 利用者, I want 国を選ぶと、その国の都市の一覧に切り替わること, so that 国の中から都市を選んで接続できる

#### Acceptance Criteria
1. When 利用者が国の行を選択したとき, the system shall 一覧を、その国の都市の一覧に切り替える。
2. While 都市の一覧が表示されている, the system shall 一覧の左上に「‹ 国一覧」の戻るボタンを表示する。
3. When 利用者が戻るボタンを選択したとき, the system shall 国の一覧に戻る。
4. When 下の階層が表示されている一覧で、利用者が左から右へスワイプしたとき, the system shall 一つ上の階層に戻る。
5. While 国の一覧が表示されている, the system shall スワイプによる戻りを行わない。
6. When 利用者が上の階層に戻ったとき, the system shall その階層のタブの状態を保つ。

### Requirement 2: 都市の一覧のタブ
**Objective:** As a 利用者, I want 都市の一覧で接続の仕方を選べること, so that 最速のサーバへ繋ぐか、サーバを選んで繋ぐかを決められる

#### Acceptance Criteria
1. Where プロバイダにサーバの段がある（ProtonVPN）, the system shall 都市の一覧に「最速サーバ」と「サーバを選択」のタブを表示する。
2. Where プロバイダにサーバの段がない（AdGuard VPN）, the system shall 都市の一覧に「最速サーバ」のタブだけを表示する。
3. While 「最速サーバ」のタブが選ばれている, when 利用者が都市を選択したとき, the system shall その都市に接続し、一覧の遷移を終える。
4. While 「サーバを選択」のタブが選ばれている, when 利用者が都市を選択したとき, the system shall その都市のサーバの一覧を表示する。
5. When 利用者がタブを選択したとき, the system shall そのタブを、有効なプロバイダの設定として保存する。
6. When 利用者が国を選択したとき, the system shall 都市の一覧を、有効なプロバイダに保存されたタブで表示する。
7. If 有効なプロバイダにタブの設定が保存されていない, then the system shall 「最速サーバ」のタブで表示する。

### Requirement 3: サーバ一覧（サーバの段があるプロバイダ）
**Objective:** As a 利用者, I want 都市内の全サーバを Score の順で見て選ぶこと, so that 速いサーバを自分で選べる

#### Acceptance Criteria
1. When 都市のサーバの一覧が表示されたとき, the system shall その都市の有効なサーバを、Secure Core のサーバを除き、Score の小さい順に一覧する。
2. The system shall 各サーバの行に、サーバ名、階層（無料または有料）、負荷（%）、Score を表示する。
3. The system shall 無料と有料のサーバを、区別するフィルタを付けずに一つの一覧に表示する。
4. The system shall 無効なサーバを表示しない。
5. The system shall サーバの一覧に検索窓を表示しない。
6. The system shall サーバの一覧の上に件数などの要約の行を表示しない。
7. When 利用者がサーバを選択したとき, the system shall そのサーバ名を指定して接続する。

### Requirement 4: お気に入り
**Objective:** As a 利用者, I want 都市とサーバをお気に入りに登録すること, so that よく使う接続先へすぐ戻れる

#### Acceptance Criteria
1. The system shall お気に入りを、プロバイダごとに保存する。
2. While 「最速サーバ」のタブが選ばれている、またはプロバイダにサーバの段がない, the system shall 都市の行ごとに ☆ を表示し、☆ が選択されたとき、その都市をお気に入りに登録または解除する。
3. While 「サーバを選択」のタブが選ばれている（サーバの段があるプロバイダ）, the system shall 都市の行に ☆ を表示しない。
4. While サーバの一覧が表示されている, the system shall サーバの行ごとに ☆ を表示し、☆ が選択されたとき、そのサーバをお気に入りに登録または解除する。
5. When 利用者が ☆ を選択したとき, the system shall その行の選択状態を変えない。
6. While 国の一覧で「お気に入り」のタブが表示されている, the system shall お気に入りの都市とお気に入りのサーバの両方を一覧する。
7. When 利用者が「お気に入り」のタブで、お気に入りのサーバを選択したとき, the system shall そのサーバに接続する。ただし、そのサーバが現在のサーバ一覧に無いとき、AdGuard VPN では接続中であれば切断し、そのお気に入りの国名で `connect -l <国名>` を実行する。このとき、そのお気に入りは表示・通知せず、お気に入りから削除する。ProtonVPN ではフォールバック接続を行わず CLI を呼ばずにエラーを返し、お気に入りを残す。エラーの表示は既存のエラー表示の方法に従い、新しい通知の仕組みは作らない。
8. The system shall 今回の変更の前に国の単位で登録されたお気に入りを、表示も接続もしない。

### Requirement 5: 都市の一覧の取得と保存（ProtonVPN）
**Objective:** As a 利用者, I want 国を開いたときに都市が表示されること, so that 全国の都市を一度に取得せずに済む

#### Acceptance Criteria
1. When 利用者が初めて国を選択したとき, the system shall その国の都市の一覧をプロバイダから取得し、保存する。
2. While 国の都市の一覧が保存されている, the system shall 保存された一覧を使い、再度取得しない。
3. If 都市の一覧を取得できなかったとき, then the system shall 既存の接続先の一覧と同じく、エラーと再取得のボタンを表示する。
4. When 利用者が再取得のボタンを選択したとき, the system shall 都市の一覧を取得し直す。
5. When 利用者が「再計測」を選択したとき, the system shall 有効なプロバイダの都市の一覧の保存を破棄する（サーバの一覧は CLI が管理するキャッシュのため、本 spec では破棄しない）。
6. The system shall 接続に使うサーバ名を、プロバイダのサーバの一覧から取得する。

### Requirement 6: 接続
**Objective:** As a 利用者, I want 選んだ都市やサーバへ正しく接続されること, so that 選んだ場所から通信できる

#### Acceptance Criteria
1. When ProtonVPN で「最速サーバ」のタブから都市に接続するとき, the system shall その都市の有効なサーバのうち Score が最も小さいサーバに接続する。
2. When AdGuard VPN で都市に接続するとき, the system shall 都市名をプロバイダに渡す。AdGuard VPN の国単位のフォールバック接続（4-7）では、接続の引数に国名を渡す。
3. When サーバに接続するとき, the system shall そのサーバ名をプロバイダに渡す。
4. While 都市またはサーバに接続している, the system shall その行に「接続中」のバッジを表示する。
5. Where プランが接続先の選択を許可しない, the system shall 都市とサーバへの接続を行わず、既存の制限の案内を表示する。
6. The system shall 国の行（国の ID）からの接続を拒否する。要件 4-7 の国名接続はお気に入りのサーバを解決する処理であり、国の ID からの接続ではない。

### Requirement 7: 並べ替え
**Objective:** As a 利用者, I want 接続先が一定の規則で並ぶこと, so that 目的の接続先を探しやすい

#### Acceptance Criteria
1. Where プロバイダが ping を計測できる, the system shall 国の行を、その国の都市の ping の最小値の小さい順に並べる（並べ替えの根拠として使い、国の行には ping の値を表示しない）。
2. Where プロバイダが ping を計測できる, the system shall 都市の行を、ping の小さい順に並べる。
3. Where プロバイダが ping を計測できない, the system shall 国の行を、利用者の国の首都からの距離の近い順に並べる（規則は `location-distance-sort` の要件 1-1 と 4-1 に従う）。
4. Where プロバイダが ping を計測できない, when 都市の一覧が表示されるとき, the system shall 都市の行を、利用者の国の首都からの距離の近い順に並べ、お気に入りの都市を先頭に置く（規則は `location-distance-sort` の要件 1-2・1-4 に従う）。
5. The system shall 「このVPNプロバイダでは ping 計測を利用できません」の案内を表示しない。
6. The system shall 国の行に ping の値を表示しない。

### Requirement 8: 表示内容
**Objective:** As a 利用者, I want 必要な情報だけが一覧に出ること, so that 画面を簡潔に保てる

#### Acceptance Criteria
1. The system shall 一覧の UI を `.kiro/steering/ui-conventions.md` に従って表示する。
2. The system shall 一覧の上や中に、要約の行・操作の説明・ヒント・値の意味の説明を表示しない。
3. The system shall 各サーバの Score を値として表示し、その意味の説明を表示しない。
4. Where プロバイダが ping を計測できない, when 接続先の距離が決まったとき, the system shall その接続先の行に「約 N km」を表示し、距離が決まらない行には距離を表示しない（表示の形式は `location-distance-sort` の要件 4-3 と 4-4 に従う）。

## 決定事項と前提
- 国の行には ping を表示しない（Requirement 7-6）。並べ替えの根拠としてのみ使う（Requirement 7-1）。
- ping を計測できないプロバイダの並べ順は、距離順を既定とする（Requirement 7-3・7-4）。距離の規則は `location-distance-sort` が定める。
- 都市の行の距離は、利用者の国の首都からその都市までの大圏距離とする（距離の基点は国単位。都市を基点にしない）。
- 旧の国単位のお気に入りは、表示も接続もしない（Requirement 4-8）。
- 都市一覧の保存は、「再計測」で破棄し、次に国を開いたときに取り直す（Requirement 5-5）。
- 国の行から国単位の接続は行わない（Requirement 6-6）。
- AdGuard VPN の都市の接続は都市名のみを渡す（Requirement 6-2）。「都市, 国」の書式は 2026-11-08 に CLI が拒否したため不採用。
- 一覧の UI の未決定事項（`ui-conventions.md`）は、次のとおり決めた。
  - AdGuard VPN（サーバの段がない）では、都市の行に ☆ を出す（Requirement 4-2）。
  - サーバの一覧では Score を値として残し、説明は出さない（Requirement 8-3）。

## 承認の前提
- Requirement 7-3・7-4 が依存していた `location-distance-sort` は、要件・設計・タスクまで作成済みで、承認されている。したがって、距離順の規則は確定している。
- 検証済み（`location-distance-sort/research.md`）: ProtonVPN の国は 149 か国、都市は 196 件。都市名の照合は同梱データで 192 件が一致し、残りの 4 件は距離なしで表示する（Requirement 3-5 の扱い）。
- 検証（隔離された環境で実施する）: ProtonVPN のサーバ名を指定した接続（Requirement 6-1・6-3 の前提）。検証にはログインが必要で、ログインは利用者が行う。
- AdGuard VPN の「都市, 国」の書式は、2026-11-08 の拒否結果により不採用。
- 本 spec の承認は、要件の確認のあとに行う。
