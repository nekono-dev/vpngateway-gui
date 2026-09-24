# SPEC-WEBUI: Webサーバ（GUI）基本設計

サービス全体設計（../design.md）で定義されたWebサーバの詳細設計を示す。

本プロジェクトはVPN接続状態の常時監視・操作を行う管理パネルであり、静的コンテンツ配信ではなく状態を持つインタラクティブなUIが中心となるため、SSG（Static Site Generation）ではなくSPA（Vite + React、クライアントサイドレンダリング）を採用する。

コンポーネント配置・命名規約はAGENTS.mdの規約に従う。

# Webサーバ自身のTLS（Phase 25）

ブラウザ⇄Webサーバ間をHTTPSにする（`specs/requirements.md`「通信路の保護」）。`web/server/index.ts`のFastifyを`https`オプション（証明書はインストーラが配置する自己署名証明書・秘密鍵。`specs/design.md`「証明書の生成・配布」）で起動する。証明書はWebサーバのホスト名・IPを対象に発行され、ブラウザは初回アクセス時に自己署名警告を表示する（運用者が手動で信頼する運用を前提とし、Let's Encrypt等の自動化は対象外）。

証明書・秘密鍵の読み込みは`web/server/tls-options.ts`の`loadWebServerTlsOptions()`が行う。環境変数`WEB_TLS_CERT_FILE`・`WEB_TLS_KEY_FILE`（省略時は`GATEWAY_PKI_DIR`（既定`/etc/vpngwgui/pki`）配下の`web-server.crt`・`web-server.key`）から読み込む、既存のゲートウェイ制御チャネル（`proxy/src/gateway-channel/tls-options.ts`等）と同じ規約に従う。

# APIクライアント生成方針

- APIサーバがFastify + TypeBox + `@fastify/swagger` から自動生成するOpenAPI仕様を、orvalの入力として利用する。
- 生成先ディレクトリは `src/generated/api/` とし、手動編集しない（`.gitignore` 対象外としてコミットするか、ビルド時生成のみとするかはCI構成時に決定する）。
- APIサーバ側のスキーマ変更時は、orvalの再生成コマンドを実行してからWeb側の実装を行う運用とする。
- Webサーバの実装コードは、この生成クライアント以外の手段でAPIサーバへリクエストを送信してはならない。

# Web⇄API通信経路の実装

- ブラウザは常にWebサーバの単一オリジンにのみアクセスし、Webサーバが `/api/*` パス配下のリクエストを、`API_ORIGIN`（既定`https://api:3000`。分離配置時はインストーラが`https://<APIサーバのホスト名/IP>:<ポート>`を`.env`へ書く）へリバースプロキシする。単一ホスト構成でもAPIサーバ自身のTLSは常に有効なため、`API_ORIGIN`は常に`https://`になる。
- 実装は Fastify の `@fastify/http-proxy` を用いる。
- **【Phase 25】TLS検証**: `@fastify/http-proxy`（既定でundiciを使って上流へ接続する）の`undici.connect.ca`オプションへ、インストーラが配布したAPIサーバのCA証明書（`api-ca`。`specs/design.md`「証明書の生成・配布」）を渡し、検証を行う。CA証明書の読み込みは`web/server/tls-options.ts`の`loadApiCaCertificate()`（環境変数`API_TLS_CA_FILE`、省略時`GATEWAY_PKI_DIR`配下の`api-ca.crt`）が行う。証明書検証を無効化するオプション（`rejectUnauthorized: false`等）は使わない。
- **Cookieの透過転送**: ブラウザ⇄API間のセッションCookie（`vpngwgui_session`。下記「利用者認証の実装方針」）は、リバースプロキシがそのまま転送する。Webサーバ自身はCookieの中身を解釈・検証しない（検証はAPIサーバの責務）。同一オリジン構成のため、追加のCORS設定・`credentials`指定は不要。

# 利用者認証の実装方針（Phase 25）

設計方針は`specs/design.md`「認証・認可の設計方針」、要件は`../webserver/requirements.md`「利用者認証の要件」。

- **未認証時の誘導**: アプリ起動時（`App`のマウント時）に`GET /v1/operator`を呼ぶ。`configured: false`なら初期設定画面（`components/auth/SetupPage.tsx`）を表示する。`configured: true`の場合は続けて`GET /v1/operator/session`を呼び、`401`ならログイン画面（`components/auth/LoginPage.tsx`）を表示する。いずれもダッシュボードはレンダリングしない。以後、いずれかのAPI呼び出しが`401`を返した場合も、その場でログイン画面へ切り替える（実行中の操作はエラートーストで失敗を通知する）。
- **初期設定画面（`SetupPage.tsx`）**: ユーザー名・パスワード（確認用に再入力を含む）の入力フォーム。送信は`postOperator`（orval生成）を呼ぶ。成功時はそのままログイン済みとしてダッシュボードへ遷移する（`POST /v1/operator`が併せてセッションを発行するため、続けてログイン画面を経由させない）。`409`（作成済み）の場合はログイン画面へ切り替える（他の利用者が先に設定した場合を想定）。
- **ログイン画面（`LoginPage.tsx`）**: ユーザー名・パスワード入力欄と送信ボタンを持つフォーム。送信は`postOperatorSession`（orval生成）を呼ぶ。成功時はダッシュボードへ遷移し、以後のポーリング等を開始する。失敗（`401`）時は「ユーザー名またはパスワードが正しくありません」を表示する。`429`（レート制限）時は専用の文言を表示する。
- **アカウント設定（設定ダイアログ内、`components/dashboard/SettingsDialog.tsx`に追加）**: 現在のパスワード・新しいユーザー名（省略可）・新しいパスワード（省略可）の入力欄を持つフォーム。送信は`putOperator`（orval生成）を呼ぶ。成功時はダイアログ内に完了を表示する（再ログインは不要）。`401`（現在のパスワード不一致）はダイアログ内にインライン表示する（`specs/webserver/design.md`「エラー通知の実装方針」の方針に合わせる）。
- **ログアウト**: 既存のヘッダー等に配置するログアウト操作から`DELETE /v1/operator/session`を呼び、成功したらログイン画面へ戻る。
- **状態の持ち方**: 認証状態（未設定／未ログイン／ログイン済み・ユーザー名）はReactのコンテキスト（`contexts/AuthContext.tsx`）で保持する。Cookie自体はブラウザが管理するため、Web UI側で別途トークンを保持しない。

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

- `excludedDomains`（Phase 14）は、DNS中継が有効な間だけ通信へ反映される。「未対応」の暫定表示はPhase 14で除去し、`dnsRelayEnabled`がOFFのときの注意表示（`webserver/requirements.md`「設定ダイアログの入力項目」）に置き換える。稼働状況欄は`GET /v1/connection/gateway`の`dnsRelay`（状態・上流の疎通・迂回中のIP数）を表示する。DNS中継の設定項目は、`SettingsDialog.tsx`に「DNS中継」のグループとして追加する（ラジオボタン・複数行入力は既存のUI部品規約に従う）。明示的プロキシはPhase 6で実装済みのため、稼働状況欄は実状態（`GET /v1/connection/gateway`の`explicitProxy`）を表示し、設定ダイアログの暫定表示は除去した。
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

# ダッシュボードのカード構成・レイアウトの整理の実装方針（Phase 21）

要件は`requirements.md`「ダッシュボードのカード構成・レイアウトの整理」。

## ログイン導線をVPNベンダーのカードへ移す

- `SessionCard.tsx`から接続/切断ボタンの受け渡し（`disconnectAction`・`connectAction`props）を削除する。責務をログイン状態の表示・ログイン導線・ログアウトのみに戻す（Phase 16以前の責務）。
- `App.tsx`が、VPNベンダーのカード（`aria-label="VPNベンダー"`）の中で`ProviderSelector`の直後に`SessionCard`を描く（従来は接続操作カードの中にあった）。

## 接続状態・稼働状況・接続/切断ボタンを1枚のカードにまとめる

- `ConnectionStatusCard.tsx`と`GatewayStatusCard.tsx`は、それぞれが持っていた外枠（`<div className="card...">`・`<section className="card" aria-label="稼働状況">`）を取り除き、カード内側の表示（接続状態の文言／稼働状況の`dl`）だけを返すようにする。外枠は`App.tsx`側で1つにまとめて持つ（1つの`<section className="card">`に両方の内容と接続/切断ボタンを並べる）。
- 接続状態に応じた枠色（`card-connected`・`card-disconnected`・`card-danger`）の判定は、`ConnectionStatusCard.tsx`から`connectionCardClassName(connection, isLoading, error)`として切り出し、`App.tsx`がこれを外枠の`className`に使う（従来`ConnectionStatusCard`内部で完結していた枠色の決定を、外枠を持つ側へ移すだけで判定ロジック自体は変えない）。
- `App.tsx`は、接続状態の直後に`ConnectButton`／`DisconnectButton`（Phase 16で切り出し済み。押しやすい位置に置く目的は維持しつつ、置き場所をSessionCardからこのカードへ変更）を置き、その下に稼働状況の内容を続ける。

## 「ログインしてください」等の制限理由の重複表示の解消

- 未ログイン等で［接続］が無効化される理由（`connectBlockedReason`）は、`connectToLocation`と`locationList`が常に同じ理由へ同期される（`apiserver/capability-evaluator.ts`の仕様。一方が実行不可なら他方も同じ原因を継承する）ため、［接続］ボタンが無効化される場面では接続先リスト側の制限表示（`LocationList.tsx`の`unavailableReason`）にも常に同じ理由文が表示される。
- `LocationList.tsx`は、`unavailableReason`を表示する`RestrictionNote`に固定id（`location-list-restriction`）を付ける。
- `ConnectButton.tsx`は、`connectBlockedReason(capabilities)`が`reasonOf(capabilities, "locationList")`と一致するとき（＝接続先リスト側に同じ理由文が既に表示される、または表示されうるとき）は、自身の`RestrictionNote`を描かず、`aria-describedby`だけを`location-list-restriction`へ向ける。一致しない場合（稀なケース。プロバイダの対応可否がオペレーションごとに異なる等）は、従来どおり自身の`RestrictionNote`（`connect-restriction`）を描く。
- これにより、画面上に同じ理由文が視覚的に重複することはなく、支援技術からは常にいずれかの理由文を`aria-describedby`で辿れる。

## 画面の縦幅をビューポートに収める

- `styles.css`で、`html`・`body`・`#root`の高さを100%とし、`main`の高さを`100dvh`（動的ビューポート高さ）に固定して`overflow: hidden`にする。
- `main`はflexの縦積みのまま、接続操作カード（`.controls`）と接続先リスト（`.location-list`・`.location-scroll`）に`flex: 1; min-height: 0;`を連鎖させ、他のカード（VPNベンダー・接続状態）の実高さぶんを差し引いた残りの高さを接続先リストの内部スクロール領域が吸収する（`.location-scroll`の`max-height`固定値は廃止する）。
- ページ全体としてはスクロールせず、接続先リストが多い場合のみ`.location-scroll`の内部だけがスクロールする（Phase 16での「接続/切断ボタンをスクロールなしで押せる位置に置く」という意図を、カード構成が変わった後も引き続き満たす）。
- **【2026-09-22追記・実機検証で判明】** 接続先リストが使えない（`locationList`が制限されている）ときの分岐（`LocationList.tsx`）は、通常時の`.location-list`（flexの縦積み、`flex: 1; min-height: 0;`）の外枠を使わずFragmentを返していたため、この分岐で表示される「接続できる国（参考）」一覧（`AvailableLocations.tsx`）が高さの制約を受けず、国数の多いベンダー・プラン（実機確認: Proton VPN無料版、10か国）でページ全体がビューポートを超えて表示される不具合が生じた（利用者からの指摘で発覚）。`LocationList.tsx`のこの分岐を`.location-list`で囲み、`AvailableLocations`のラッパー（`.available-locations`）にも同じflexの縦積み（`flex: 1; min-height: 0;`）を与え、内部の`.location-scroll`まで残り高さのflex連鎖を通すことで修正した。回帰防止のため、コンポーネントテストに「参考一覧が`.location-list`に囲まれていること」の構造チェックを追加し、実機E2E（`e2e/phase21/webgui-phase21.mjs`）にページ全体がビューポートを超えないことの確認を追加した。

# モバイル表示・入力欄の視認性改善の実装方針（Phase 22）

要件は`requirements.md`「モバイル表示・入力欄の視認性改善」。

## フォーカス時の意図しない拡大の防止

- iOS Safari等は、フォーカスした入力欄のフォントサイズが16px未満のとき、そのフォントサイズが画面に収まるよう自動的にページ全体を拡大する。`viewport`メタタグの`maximum-scale`固定・`user-scalable=no`によるピンチズーム自体の禁止は、拡大操作を必要とする利用者のアクセシビリティを損なうため行わない。
- 代わりに、`styles.css`が入力欄（`input`・`select`・`textarea`）のフォントサイズを`16px`以上に統一する。次項「入力欄の視認性向上」で文字サイズを拡大する対応と合わせて満たされる。

## 入力欄の視認性向上

- `styles.css`の入力欄セレクタ（従来`select, textarea, input[type="search"]`のみに限定していたものを、`input`全体（`type`を問わない。`LoginForm.tsx`のユーザー名・パスワード・2段階認証コード欄を含む）へ拡大する）に、以下をまとめて適用する。
  - `font-size`: `1rem`（16px。「フォーカス時の意図しない拡大の防止」と両立）
  - `border`: 既定の`var(--border)`（灰色、ボタン等と共通）ではなく、入力欄専用の新しいCSSカスタムプロパティ`--input-border`（`:root`に追加。ブラウザ・OS既定の枠線色と区別できる、システムで意図的に定めた色）を使う
  - `padding`: `8px 10px`程度（従来の`6px`のみから拡大し、枠線内に余白を持たせる）
- フォーカス時は`outline`を`--input-border`と同系色で表示し、枠線色とフォーカス表示の一貫性を保つ（既存の`.location-row:has(input:focus-visible)`等、個別に`outline`を定義している箇所とは独立に扱い、干渉しない）。

## アカウントのログイン状態表示の簡素化

- `SessionCard.tsx`の状態表示（`session-status`）は、ログイン済み（`loggedIn === true`）のときのみ描画する。未ログイン（`loggedIn === false`）のときは、従来表示していた「アカウント: 未ログイン」を描画しない（ログインフォーム・ログインボタン自体が未ログインであることを示すため）。ログイン状態が未確定（`loggedIn === undefined`）のときも同様に何も描画しない（従来どおり）。
- ログイン済みの表示は、他のカードの状態表示（`LocationRow.tsx`の「接続中」バッジ等）と同じ`badge badge-ok`クラスを使い、プラン名（あれば`usageNote`併記）とともに緑色の背景で示す。接続状態の表示（`connectionCardClassName`による枠色）と同様に、色で状態が分かるようにする狙いを、既存の`badge`という共通の仕組みで満たす（ログイン状態専用の新しい配色ルールは設けない）。

## 接続先設定フォームの高さ

- `App.tsx`が、接続操作カード（`.controls`）に実際に表示する行があるかどうか（`locations.locations.length > 0`、または参考一覧が使われる状況で`availableLocations`に1件以上あるか）を判定し、あるときだけ`.controls`へ`controls-expanded`クラスを追加する。
- `styles.css`は、`.controls`の既定を`flex: 0 0 auto`（内容に必要な高さのみ）とし、`.controls-expanded`のときのみ従来どおり`flex: 1 1 auto; min-height: 0;`（画面の残り高さいっぱいに広がり、内部の`.location-scroll`がスクロールを吸収する。Phase 21「画面の縦幅をビューポートに収める」の実装をそのまま流用する）を適用する。
- 取得中・0件・制限理由のみ（参考一覧も空）のときは`.controls`が内容に応じた高さのみを占めるため、画面下部に不要な空白が生じない。

## フッターの追加

- `App.tsx`の`<main>`直下、既存の各カードの後ろに`<footer className="app-footer">`を追加し、本リポジトリのGitHubページ（`https://github.com/nekono-dev/vpngateway-gui`）へのリンクを、GitHubのロゴ（インラインSVG。外部画像・アイコンフォントへの追加の依存を避けるため`components/icons/GithubIcon.tsx`として置く）とともに表示する。
- `styles.css`の`main`はflexの縦積み（`display: flex; flex-direction: column;`）のため、フッターは他のカードと同じ流れの末尾に置くだけで追加のレイアウト変更は不要。ただし画面の縦幅をビューポートに収める制約（Phase 21）と両立させるため、フッターは小さく（アイコン+リンクの1行程度）に留め、`.controls`が`controls-expanded`でない（内容が少ない）ときに画面内に収まるようにする。

# ベンダー選択のプルダウン化・PWA対応・モバイル表示の改善の実装方針（Phase 23）

要件は`requirements.md`「ベンダー選択のプルダウン化・PWA対応・モバイル表示の改善」。

## VPNベンダー選択のプルダウン化とログイン/ログアウト導線の同じ行への配置

- `ProviderSelector.tsx`は、複数ベンダーのときの部品を`<fieldset><div role="radiogroup">`（ラジオボタンの並び）から`<select>`（プルダウン）へ変更する。選択中の値は`value={active?.id}`（controlled）とし、`onChange`で選ばれたベンダーを`handleSwitch`（既存の確認・切替ロジック。変更なし）へ渡す。利用不可ベンダーは`<option disabled>`にし、理由（`unavailableReason`）は選択肢の文言に括弧書きで含める（従来はラジオの横に別要素で表示していたが、プルダウンの各選択肢はテキストのみのため文言に含めるほかない）。
- ベンダーが1つだけのとき（`providers.length <= 1`）の名前のみ表示（`.provider-name`）は変更しない。
- プルダウンの隣にログイン/ログアウトボタンを並べるため、`ProviderSelector`（`select`を含む要素）と`SessionCard`は、従来どおり`App.tsx`の同じ`<section className="card provider-card">`の直接の子（DOM上の兄弟）のまま維持し、CSSのみで行内配置を実現する。`SessionCard.tsx`は返り値を単一の`<div className="session-card">`から`Fragment`へ変更し、「単発ボタンで済む導線（ログアウトボタン、またはURL提示型ログインのボタン）」を`<div className="session-action">`、「それ以外（アカウント状態のバッジ、資格情報入力型のログインフォーム、ログインURL提示の結果、制限理由）」を`<div className="session-extra">`として、それぞれ独立した要素で返す。資格情報入力型のログイン（`loginMethod === "credentials"`）は、フォーム自体をボタンだけに切り出せないため`session-action`には何も置かず、`session-extra`側にフォームごと表示する。
- `styles.css`の`.provider-card`をCSS Grid（`grid-template-areas: "select action" / "extra extra"`）にし、`.provider-select-row`・`.provider-name`（ベンダー1つのときの名前表示）を`select`領域、`.session-action`を`action`領域、`.session-extra`を`extra`領域に割り当てる。DOM上の親子構造（`ProviderSelector`・`SessionCard`という別コンポーネントの出力）を変えずに、CSSのgrid-areaだけで見た目の行を組み替えられるため、両コンポーネントの既存ロジック（ログイン状態の保持、切替の確認等）には手を入れない。`session-extra`が空（何も表示するものが無い、例: URL提示型ログインで未クリック）のときは`:empty`セレクタで`display: none`にし、余分な行の高さを持たない。

## プルダウンの装飾（テキストボックス風）

- `styles.css`の`.provider-select`に`appearance: none`を適用してブラウザ・OS既定の矢印等を消し、他の入力欄と同じ枠線色（`--input-border`）・padding・フォーカス時のoutlineを適用する（既存の`select, textarea, input:not(...)`の共通ルールをそのまま継承し、`.provider-select`では`padding-right`（自前の矢印ぶんの余白）のみ上書きする）。矢印は`.provider-select-wrap::after`（絶対配置した疑似要素、border-right/border-bottomで作る三角形）で自前に描画する。

## 入力欄の枠線色のグレー化

- `styles.css`の`:root`の`--input-border`を、紫（`#6e40c9`）からグレー系（`#6e7781`。`--muted`と同系統でブラウザ既定の`--border`より濃く、視認性は維持する）へ変更する。この変数を参照している箇所（入力欄全般、プルダウン）はすべて自動的に追従するため、他のファイルの変更は不要。

## スマートフォンでのスクロール防止

- `styles.css`に`@media (max-width: 420px)`を追加し、`main`・`.card`の余白（padding・gap）を詰める。`.provider-card`は、この幅では`grid-template-columns: 1fr`・`grid-template-areas: "select" / "action" / "extra"`へ切り替え、プルダウンとボタンを縦に積む（狭い画面でベンダー名が長い場合でも折り返し・はみ出しでスクロールが発生しないようにするため）。
- `body`に`overscroll-behavior-y: none`を追加し、iOS Safari等のラバーバンドスクロール（ページ全体を引っ張って伸縮させる挙動）による意図しないスクロールを防ぐ。`main`のpaddingに`env(safe-area-inset-top/bottom)`を加味し、ノッチ・ホームインジケータのある端末でも内容が隠れないようにする。
- Phase 21・22で確立した「`main`は`100dvh`固定・`overflow: hidden`、`.controls-expanded`のみ残り高さを内部スクロール（`.location-scroll`）へ渡す」という縦幅の制御方針自体は変更しない。

## PWA対応

- `web/public/manifest.webmanifest`（Webアプリマニフエスト）を追加し、アプリ名・アイコン（`/icons/icon-192.png`・`icon-512.png`・`icon-maskable-512.png`・`apple-touch-icon.png`。外部の画像編集ツールに依存せず、Node標準の`zlib`のみでPNGを生成するビルド前のワンショットスクリプトで作成し、リポジトリには生成済みのPNGを配置する）・`display: standalone`・`theme_color`等を定義する。`index.html`に`<link rel="manifest">`・`<meta name="theme-color">`・`<link rel="apple-touch-icon">`等を追加する。
- `web/public/sw.js`（Service Worker）を追加し、`/api/*`は常に最新の状態を扱う必要があるためキャッシュ対象から除外し、アプリの静的シェル（`index.html`・`manifest.webmanifest`等）のみをキャッシュ優先（取得後に裏で更新）で扱う。`main.tsx`が`window`の`load`イベントで`navigator.serviceWorker.register("/sw.js")`を呼ぶ（`"serviceWorker" in navigator`で対応環境のみ）。
- **制約**: Service Workerの登録（`navigator.serviceWorker`自体の存在）は、ブラウザのセキュアコンテキスト要件により、配信がHTTPSまたは`localhost`でなければ有効化されない。検証環境（`http://192.168.3.240:8080`、LAN IPへの素のHTTP配信）で確認したところ、`window.isSecureContext`が`false`となり`navigator.serviceWorker`自体が存在しない（実機確認、2026-09-22）。本フェーズはこの制約を認識のうえ、資材（manifest・アイコン・Service Worker本体・登録コード）を用意することまでをスコープとし、配信のHTTPS化は別途の判断（利用者へ確認のうえ、スコープ外とした）とする。

# ログインボタンもプルダウンの隣へ・入力欄の枠線色をボタン同等の薄さへの実装方針（Phase 24）

要件は`requirements.md`「ログインボタンもプルダウンの隣へ・入力欄の枠線色をボタン同等の薄さへ」。

## 資格情報入力型ログインのボタン化

- `SessionCard.tsx`に、資格情報入力型ログインでフォームを開いたかを保持するローカル状態`showCredentialsForm`（既定`false`）を追加する。ベンダーが替わったときは`App.tsx`側の`key={`provider-${activeProviderId}`}`による再マウントで自動的に初期化される（Phase 21以来の既存の仕組みをそのまま使う。専用のリセット処理は追加しない）。
- `session-action`（プルダウンと同じ行）に表示する「ログイン」ボタンの押下時の挙動を、`loginMethod`で分岐する: URL提示型（`deviceUrl`）は従来どおり`handleLogin()`を直接呼ぶ。資格情報入力型（`credentials`）は`setShowCredentialsForm(true)`のみを行い、実際のログイン要求（`POST /v1/session`）は呼ばない（フォーム自身の送信で行う。既存の`LoginForm.tsx`・`handleLogin(credentials)`は変更しない）。
- ボタンの表示文言は、資格情報入力型は「ログイン」（フォームの送信ボタンと同じ表示だが、フォームを開いた後はこのボタン自体を消すため、画面上で表示名が重複することはない）、URL提示型は従来どおり「VPNベンダーへログイン」のまま維持する（過去のE2Eスクリプト・仕様書内の参照文言との互換のため、あえて統一しない）。
- `session-extra`側の`LoginForm`の表示条件に`showCredentialsForm`を追加し、ボタンを押すまでフォーム（ユーザー名・パスワード等の入力欄）を表示しないようにする。

## 入力欄の枠線色をボタン同等の薄さへ

- `styles.css`の`:root`の`--input-border`を、Phase 23で定めたグレー（`#6e7781`）から、ボタンの枠線色である`--border`（`#d0d7de`）と同じ値へ変更する。他の箇所（入力欄全般、プルダウン）への変更は不要（CSS変数を参照しているため自動的に追従する）。
