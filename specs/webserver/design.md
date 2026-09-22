# SPEC-WEBUI: Webサーバ（GUI）基本設計

サービス全体設計（../design.md）で定義されたWebサーバの詳細設計を示す。

本プロジェクトはVPN接続状態の常時監視・操作を行う管理パネルであり、静的コンテンツ配信ではなく状態を持つインタラクティブなUIが中心となるため、SSG（Static Site Generation）ではなくSPA（Vite + React、クライアントサイドレンダリング）を採用する。

コンポーネント配置・命名規約はAGENTS.mdの規約に従う。

# APIクライアント生成方針

- APIサーバがFastify + TypeBox + `@fastify/swagger` から自動生成するOpenAPI仕様を、orvalの入力として利用する。
- 生成先ディレクトリは `src/generated/api/` とし、手動編集しない（`.gitignore` 対象外としてコミットするか、ビルド時生成のみとするかはCI構成時に決定する）。
- APIサーバ側のスキーマ変更時は、orvalの再生成コマンドを実行してからWeb側の実装を行う運用とする。
- Webサーバの実装コードは、この生成クライアント以外の手段でAPIサーバへリクエストを送信してはならない。

# Web⇄API通信経路の実装

- ブラウザは常にWebサーバの単一オリジンにのみアクセスし、Webサーバが `/api/*` パス配下のリクエストを内部ネットワーク経由でAPIコンテナ（`http://api:3000` 等、Docker内部DNS名）へリバースプロキシする。
- 実装は Fastify の `@fastify/http-proxy` を用いる。

# 状態管理の実装方針

- VPN接続状態、Kill Switch状態等は、APIサーバの状態取得エンドポイントを一定間隔（デフォルト5秒程度、画面表示中のみ）でポーリングして取得する。WebSocket等のプッシュ型通信は、初期実装では採用せず、必要になった時点で再検討する。
- 接続状態（`GET /v1/connection`）と稼働状況（`GET /v1/connection/gateway`）は1つのポーリングで並行取得する（`hooks/useDashboardPolling.ts`。汎用の`hooks/usePolling.ts`を利用）。各部分は独立に成否を持ち、片方の失敗がもう片方の表示に影響しない。取得に失敗した部分は古い値を残さず取得失敗を表示する（proxy障害時に「稼働中」が表示され続けるのを避けるため）。ただし接続/切断ボタンは、接続状態の取得が一時的に失敗しても最後に取得できた状態で操作可能とする。

# エラー通知の実装方針

- 操作（接続/切断/ログイン）のAPIエラーは、`notifications/`のトーストで通知する。`describe-api-error.ts`がHTTPステータス（400/422/502/504）を要約へ変換し、stderr等の生出力は「詳細」（`<details>`折りたたみ）にのみ入れる。エラートーストは利用者が閉じるまで残す（読み終える前に消えるのを避ける）。
- 設定ダイアログ・接続ログダイアログ内のエラーは、モーダル表示中はダイアログ外が操作不能でトーストを閉じられないため、ダイアログ内にインライン表示する。

# 接続国の表示方針

- 接続国はクライアントで保持せず、常に`GET /v1/connection`の`country`（と`location`）を表示する（apiserver/design.md「接続先国の永続化」）。クライアント側のメモリに保持すると、再読み込み・別端末・別ブラウザで表示が失われるため（Phase 4初期実装の不具合）。

# 接続先リストの実装方針（Phase 5）

要件は`requirements.md`「接続先リスト」。API（`specs/apiserver/design.md`「接続先（ロケーション）」）が並び順（ping昇順）・お気に入り・前回接続の別を決めて返し、Webはそれを表示・操作するだけとする（並べ替えロジック・お気に入りの保持をWebに置かない）。

## コンポーネントと責務

| ファイル | 責務 |
|---|---|
| `hooks/useLocations.ts` | `GET /v1/connection/locations`の取得状態（読み込み中・成功・失敗）と、再取得、★の登録/解除（`PUT`/`DELETE .../favorite`）、接続成功後の`lastConnected`のローカル更新を管理する。★操作は楽観的に反映し（並び順を変えないため再取得しない）、APIエラー時は元へ戻してエラーを通知する |
| `components/dashboard/LocationList.tsx` | タブ（すべて／お気に入り）・絞り込み入力・行リスト・再計測ボタン・取得失敗表示の組み立て |
| `components/dashboard/LocationRow.tsx` | 1行の表示（国コードのバッジ・国名・都市・ping・★ボタン・「接続中」「前回」バッジ）と選択 |
| `components/dashboard/ConnectionActions.tsx` | 接続／切断／「接続先を変更」ボタンの出し分け（従来の`ConnectDisconnectButton.tsx`を置換） |
| `locations/location-filter.ts` | 絞り込み・タブ切替の純粋関数（接続先の型に依存するドメイン処理のため、汎用の`lib/`ではなく責務ディレクトリ`locations/`に置く。AGENTS.mdのポータビリティテスト参照） |
| `locations/current-location.ts` | 現在の接続先ID・実効選択の決定（接続状態の`locationId`／`location`と一覧の突き合わせ）の純粋関数 |

## 選択・ボタンの状態遷移

- `selectedId`（利用者が明示的に選んだ接続先ID）を`App`が保持する。実効選択`effectiveId`は、`selectedId` → 接続中なら現在の接続先ID → 切断中なら`lastConnected`の接続先ID の優先順で決める。実効選択が一覧に存在しなければ未選択（接続不可）。
- 現在の接続先ID: `GET /v1/connection`の`locationId`。無い場合（API外の接続・保存内容なし）は、`location`（CLIが報告する都市名、大文字小文字は区別しない）と一覧の`city`の一致で補う（一致しなければ現在の接続先不明として扱い、どの行にも「接続中」を付けない）。
- ボタン: 切断中は［接続］（`effectiveId`があるとき有効）。接続中は［切断］を常に表示し、`effectiveId`が現在の接続先と異なるときだけ［接続先を変更］を併せて表示する（`PUT /v1/connection`の`connect=true`＋`locationId`。接続と同じ経路）。
- 操作（接続・変更・切断）の成功後は`selectedId`を消去する（以後は接続中の接続先が実効選択になる）。ボタンは送信中、二重押下できない。

## 取得のタイミング

画面表示時に1回、以降は利用者が「再計測」（取得失敗時は「再取得」）を押したときのみ。接続状態のポーリング（5秒）には含めない（`list-locations`はCLIを起動し約1秒かかる。また並び順が勝手に変わるのを避けるため）。取得中は再計測ボタンを無効化する。

## エラー表示

リスト取得の失敗は、トーストではなくリスト領域のインライン（`role="alert"`）に、`describeApiError`の要約と再取得ボタンで表示する（画面表示時に自動で発生するエラーであり、閉じるまで残るトーストが積み重なるのを避けるため。また利用者が原因を解消して再取得するまで領域に残るべきなため）。★の登録・解除失敗は操作エラーとしてトースト通知する。

## 設定ダイアログ

`defaultCountry`ドロップダウンと、それに使っていた`countries`の受け渡しを削除する（`CountrySelect.tsx`も削除）。

# ベンダーの選択の実装方針（Phase 8）

要件は`requirements.md`「ベンダーの選択」。ベンダーの保持・切替・切断の手順はAPI（`specs/apiserver/design.md`「ベンダーの選択」）が行い、Webは一覧の表示と切替の要求だけを行う。

- **状態の取得**: `hooks/useDashboardPolling.ts`の並行取得に`GET /v1/providers`を加える（各部分が独立に成否を持つ）。取得に失敗した場合はベンダー選択部品を出さず、従来どおり動作する（APIが古い・応答しない場合の後方互換）。
- **`components/dashboard/ProviderSelector.tsx`**: ラジオ入力のグループ（各ベンダーの表示名。`available: false`は`disabled`＋理由表示）。有効なベンダーが1つのときは名前のみ表示。選択時、接続中なら`window.confirm`で確認（文言に、切断されること・Kill Switchでの遮断を含める）してから`PUT /v1/providers/active`を呼ぶ。送信中は`disabled`（二重送信防止）。失敗（`409`/`422`/`502`）は`describeApiError`でトースト通知（`409`は「ベンダーの切替中です」、`422`は「現在のVPNを切断できませんでした」等）。成功後は`refresh()`。
- **ベンダー切替時の状態の入れ替え**: `App`は、選択中のベンダーID（`providers`のうち`active`のもの）を`key`として、接続操作カード（`SessionCard`・`LocationList`・`ConnectionActions`）へ与える。IDが変わるとこれらが再マウントされ、ローカルの状態（絞り込み・タブ・URL提示型ログインの結果・入力中のフォーム）が捨てられる。`useLocations`も同じIDで取得し直す（`enabled`に加え、IDが変わったら一覧・エラー・「前回」を空へ戻して再取得する）。`selectedId`（明示的に選んだ接続先ID）もIDが変わったら消す。
- **接続状態の表示**: `ConnectionStatusCard`に選択中のベンダー名を渡し、「接続中（<ベンダー名>）」の形で表示する。ベンダーが1つだけのときは従来の表示のまま。

# プロバイダ機能差・プラン制限への対応の実装方針（Phase 7）

要件は`requirements.md`「操作の制限表示」。制限の判定はAPI（`specs/apiserver/design.md`「オペレーションと実行可否（capability）」）が行い、Webは受け取った`capabilities`を部品へ配るだけとする。

## 状態の取得

- `hooks/useDashboardPolling.ts`の並行取得に、`GET /v1/connection/capabilities`と`GET /v1/session`を加える（既存の接続状態・稼働状況と同様、各部分が独立に成否を持つ）。APIは`account`判定を30秒キャッシュするため、5秒周期でもCLIは頻繁に起動されない。
- 取得失敗時は`capabilities`を「全て可」とみなす（制限をかけない）。初回取得が完了する前は「読み込み中」として、接続先リスト（`useLocations`）の取得を開始しない（`useLocations`は`enabled`引数を受け取り、`locationList`が可のときだけ取得する）。
- `403 operation_restricted`を受けたら、`refresh()`で`capabilities`を即時再取得する（学習した制限がすぐUIへ反映される）。

## コンポーネントと責務

| ファイル | 責務 |
|---|---|
| `capabilities/capability-state.ts` | `capabilities`の型と、操作の可否・理由文の参照・「全て可」の既定値・`connectAuto`を表示するかの判定（純粋関数。API応答の型に依存するドメイン処理のため責務ディレクトリ`capabilities/`に置く） |
| `components/dashboard/SessionCard.tsx` | ログイン状態（ログイン済み・プラン名・未ログイン・不明）の表示、ログイン導線（`loginMethod`で切替）、ログアウトの組み立て（従来の`VpnLoginButton.tsx`を置換） |
| `components/dashboard/LoginForm.tsx` | `credentials`方式のフォーム（ユーザー名・パスワード・2FAコード）。送信後に秘密の欄を必ず空にする |
| `components/dashboard/RestrictionNote.tsx` | 制限理由の表示（`role="note"`）。無効化した部品の`aria-describedby`の参照先になる |
| `components/dashboard/LocationList.tsx` / `ConnectionActions.tsx` | `capabilities`に従う部品の無効化・非表示・理由の表示（上表のとおり） |

## `credentials`ログインの実装上の注意

- 入力欄は`type="password"`、`autoComplete="off"`（パスワードマネージャによる保存提案を避ける。LAN内の管理画面で資格情報をブラウザに残さない方針）。
- `POST /v1/session`の生成クライアント呼び出しの`finally`で、成否にかかわらず`password`・`twoFactorCode`の状態を空にする。エラー応答（422）の`stderr`は詳細（折りたたみ）にのみ入る既存方針のまま（APIが伏字化済み）。
- 送信中はフォーム全体を無効化し、二重送信を防ぐ。

# 暫定表示の実装方針（Phase 4）

- `excludedDomains`（Phase 14）は設定の保存のみ可能で通信へ反映されないため、設定ダイアログに「未対応」を表示する。Phase 14の実装時に除去する。明示的プロキシはPhase 6で実装済みのため、稼働状況欄は実状態（`GET /v1/connection/gateway`の`explicitProxy`）を表示し、設定ダイアログの暫定表示は除去した。
- 稼働状況カードの各行（透過ゲートウェイ・明示的プロキシ）は、テスト（単体・E2E）が行を特定できるよう`dd`に`data-testid`を付ける（`dd`はARIA上アクセシブルネームを付けられず、`aria-labelledby`が実ブラウザで機能しないことがE2Eで判明したため）。取得失敗の理由（`role="alert"`）は1行目にだけ全文を出し、2行目は「取得失敗」のみとする（同一文言の重複読み上げを避ける）。

## プランで接続できる接続先の参考表示の実装方針（Phase 12）

要件は`requirements.md`「プランで接続できる接続先の参考表示」。

- **取得**: `useAvailableLocations(enabled, providerId)`（`hooks/useAvailableLocations.ts`）が`GET /v1/connection/available-locations`を取得する。`enabled`は「接続先リストが制限されている（`locationList`が使えない）」のとき。ベンダー切替・`enabled`がtrueになったときに取得する（ポーリングしない）。ベンダー切替で前のベンダーの結果を捨てる（世代管理は`useLocations`と同じ）。失敗・空は「表示なし」として扱い、通知しない。
- **表示**: `AvailableLocations`（`components/dashboard/AvailableLocations.tsx`）が、国名と都市の一覧を、選択・お気に入りを無効化した行（接続先リストと同じ見た目。下記「参考一覧での現在の接続先の表示の実装方針（Phase 16）」参照）として描く。`LocationList`は、`unavailableReason`の理由文（`RestrictionNote`）の直後に、渡された一覧があればこれを描く。
- 一覧が変わるのはプラン変更（再ログイン）時のため、ログイン状態（`GET /v1/session`のプラン）が変わったときにも再取得する。

## プランの補足情報の参考表示の実装方針（Phase 13）

要件は`requirements.md`「ログイン導線」（プラン名への補足併記）。追加の取得は行わず、`SessionCard.tsx`が既に持つ`GET /v1/session`の応答（`plan.usageNote`）をそのまま使う。

- `SessionCard.tsx`が、プラン名の表示に`plan.usageNote`があれば括弧書きで併記する（例: 「Free（残り3.00 GBです ...）」のように、CLIの文言をそのまま出す。Webサーバは意味を解釈・翻訳しない）。無ければ何も追加しない。

## 接続・切断ボタンの配置・強調の実装方針（Phase 16）

要件は`requirements.md`「接続・切断ボタンの配置・強調」。

- `ConnectionActions.tsx`が持っていた［接続］［切断］ボタンを、それぞれ独立した部品`ConnectButton.tsx`・`DisconnectButton.tsx`（`components/dashboard/`）へ切り出した。`ConnectionActions.tsx`に残るのは［接続先を変更］のみ（接続中に別の接続先が選ばれているときだけ表示）。
- `App.tsx`が、接続状態（`connection?.status`）に応じてどちらか一方（未接続時は`ConnectButton`、接続中は`DisconnectButton`）を組み立て、`SessionCard`へ`connectAction`・`disconnectAction`（どちらも`ReactNode`）として渡す。`SessionCard.tsx`は、渡された部品をアカウント状態表示（`session-top-row`）の左に描くだけで、接続・切断の実行自体には関与しない（責務は従来どおりログイン状態の表示のみ）。
- ログイン状態（`loggedIn`）の判定結果に表示を左右させない（`loggedIn`が未確定・falseでも、接続中なら`disconnectAction`は表示され続ける）。Kill Switch運用中に、ログイン状態の一時的な取得失敗・未確定によって切断操作自体が失われないようにするため。
- 配色は、切断のみ`button.danger`（`--danger`を背景色に使う。`styles.css`）とする。接続は従来どおり`button.primary`。
- **【2026-09-22追記・実機検証で判明】** ［切断］ボタンのみを移設した最初の実装では、［接続］ボタンが`ConnectionActions.tsx`の`connect-row`（接続先リストの下）に残ったままだった。接続先リストが多数（数十件）になる構成の実機で、接続先リストの下までスクロールしないと［接続］ボタンへ到達できない問題が判明し、`ConnectButton.tsx`として同様に切り出した。

## 参考一覧での現在の接続先の表示の実装方針（Phase 16）

要件は`requirements.md`「参考一覧での現在の接続先の表示」。

- **現在の接続先の特定**: `locations/current-available-location.ts`の`findCurrentAvailableLocation(connection, availableLocations)`が、`connection.location`（CLIが報告した接続先の表記）の中に、参考一覧の各国の`cities`のいずれかが含まれるかを、大文字小文字を区別せず判定する純粋関数。`locations/current-location.ts`の`findCurrentLocationId`（接続先リスト向け）と同じ考え方を、接続先IDを持たない参考一覧向けに行う。**都市名の完全一致ではなく部分一致とする**: 実機確認（2026-09-22、Proton VPN無料プラン）で、自動接続時にCLIが報告する`location`が都市名のみ（例: `Tokyo`）ではなく、「サーバ名 in 都市名, 国名」の複合表記（例: `US-FREE#5 in Seattle, United States`）になることが判明したため。
- **表示**: `AvailableLocations.tsx`は、接続先リストの行（`LocationRow.tsx`が使う`location-item`・`location-row`・`location-iso`・`location-name`・`badge`等のクラス）と同じマークアップ・CSSクラスを再利用して行を描く。ただし選択（ラジオ入力）は置かず、非活性のクリックできない行として描く。★（お気に入り）も常に無効化した`<button disabled>`のみを置き、実際の登録操作は行わない（`LocationRow.tsx`本体は再利用せず、見た目のクラスのみ共有する。参考一覧はIDを持たず、`LocationItem`型に合わせる意味が無いため）。
- **ping列の出し分け**: `capabilities/capability-state.ts`の`supportsLocationPing(capabilities)`が、`pingMeasurement`capabilityの`reason`が`"unsupported"`のときだけ非対応と判定する。`pingMeasurement`は`locationList`に従属するcapabilityのため（`apiserver/design.md`「オペレーションと実行可否（capability）」）、参考一覧が表示される状況（`locationList`がプラン制限で使えない）では、素の`isAvailable(capabilities, "pingMeasurement")`は常にfalseになってしまい判定に使えない。`reason`で「非対応（`unsupported`）」と「プラン制限の継承（`planRestricted`）」を区別することで、CLIそのものの対応可否のみを見る。
- 参考一覧は生存確認を伴わない静的なサーバ一覧が出典のため、対応していても実際のping値は持たず、列は「-」のまま表示される。
- 単なるテキスト表示のため、独立したフックやコンポーネントは設けない（`AvailableLocations`のような専用取得・専用部品は不要）。
