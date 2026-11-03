# Research & Design Decisions

## Summary
- **Feature**: `vendor-live-e2e`
- **Discovery Scope**: Complex Integration（実 VPN CLI・外部の認証フロー・検証サーバの API・端末での対話入力）
- **Key Findings**:
  - 製品の API のすべての `/v1/` 経路は、管理者のセッション Cookie を要求する（例外は `GET/POST /v1/operator` と `POST /v1/operator/session` のみ）。準備処理は、VPN の資格情報とは別に、管理者のログインも端末で行う必要がある。
  - AdGuard のログインは `deviceUrl` 方式。`POST /v1/session` は承認 URL を `loginUrl` として返し、CLI の完了を待つ。承認の完了は、`GET /v1/session` のログイン状態で確認する。
  - 出口 IP を API で観測できるのは、VPN トンネル経由の `tunnel-egress`（観測値 `observed`）だけ。接続前の直接の出口 IP を観測する手段は、API に存在しない。
  - `tunnel-egress` は、透過ゲートウェイまたは明示的プロキシが有効なときだけ適用される（それ以外は対象外）。試験の前に設定を変えるか、検証の対象を限定する必要がある。
  - 開発サーバと検証サーバは、同じ公開 IP（156.146.34.246）と同じゲートウェイ（192.168.3.251）配下にある（読み取りで確認）。

## Research Log

### 管理者セッションの必要性
- **Context**: 準備処理が VPN の資格情報を送る前に、API 自体の認証が必要か確認する。
- **Sources Consulted**: `api/src/auth/require-operator-session.ts`（未ログインの許可経路）、`api/src/app.ts`（preHandler へ登録）。
- **Findings**: 上記の 3 経路以外の `/v1/` は、有効なセッション Cookie が無いと拒否される（401）。
- **Implications**: 準備処理は、端末で管理者のユーザー名とパスワードを入力し、Cookie を保持してから VPN のログインを行う。この入力は、要件 1 の「すべての認証情報を端末で入力する」の範囲に含まれるが、要件に明記されていないため、要件の追加が必要。

### AdGuard の device 認証
- **Context**: AdGuard はパスワードで入れない。承認 URL の表示と、承認完了の待ち方を決める。
- **Sources Consulted**: `api/src/routes/session.ts`（非資格情報の分岐）、`vendors/adguardvpn/profile.json`（`login` は `completionPattern` を持つ）。
- **Findings**:
  - `executeVendorCommand` が `exitCode === null`（完了パターンに一致し、CLI が待機中）を返すと、API は `loginUrl` と案内文を返す。
  - 承認の完了後は、`GET /v1/session` の `loggedIn` が true になる（CLI の状態が変わる）。
- **Implications**: 準備処理は、`loginUrl` を端末に表示し、`GET /v1/session` をポーリングして承認を待つ。上限は 5 分（要件 3.4）。

### 出口 IP の観測
- **Context**: 要件 4.2・4.3 は「接続前の出口 IP と異なる」ことを求める。
- **Sources Consulted**: `proxy/src/verification/gateway-checks.ts`（`checkTunnelEgress`、`checkBypassRouting`、`checkExplicitProxyEgress`）、`api/src/schemas/verification.ts`（`observed` フィールド）。
- **Findings**:
  - `checkTunnelEgress` は、VPN のインターフェース（`vpnIface`）が無ければ「未確認」を返す。直接の出口 IP は取らない。
  - `checkBypassRouting` は経路の検査で、IP を観測しない。`checkExplicitProxyEgress` は VPN 接続が前提。
  - 直接の出口 IP を観測するのは、ブラウザ（`client-egress`）だけ。試験は端末から API で行うため、利用できない。
- **Implications**: 「接続前の出口 IP」は、製品の API からは得られない。基準として、開発サーバの公開 IP を使う案がある（同じ回線の前提が必要）。判断が必要（後述の確認事項）。

### 検証の前提（設定）
- **Context**: `tunnel-egress` を有効にするための条件。
- **Findings**: `tunnel-egress` は、透過ゲートウェイまたは明示的プロキシが有効なときだけ適用される。既定の `verifyEchoUrl` は `https://api.ipify.org`（https 必須）。
- **Implications**: 試験の前に、設定（`PUT /v1/connection/config`）で透過ゲートウェイまたは明示的プロキシを有効にする必要がある。これは検証サーバの設定を変えるため、試験の後に元へ戻す扱いを決める必要がある。

### API への到達と証明書
- **Context**: 開発サーバから、検証サーバの API（ポート 3000）へ証明書を検証して届くか。
- **Findings**:
  - 開発サーバから `192.168.3.240:3000` へ TCP/TLS は届く（`openssl s_client` で証明書を取得）。
  - 証明書の発行元は `vpngwgui-api-ca`。SAN に `IP:192.168.3.240` を含む。
  - 開発サーバのシステムの CA では検証できないため、`curl` は失敗する（期待どおり）。
  - CA 証明書（`api-ca.crt`）は、検証サーバの `/etc/vpngwgui/pki/` にある。読み取りには sudo が必要。
- **Implications**: 検証のための CA を、開発サーバに取り込む必要がある。取り込み方法は、後述の確認事項。`-k`（検証なし）は、資格情報の盗聴を防げないため採らない。

### 実 CLI の実行環境（検証済みの事実）
- **Findings**:
  - 検証サーバの Proton CLI（`/usr/bin/protonvpn`）は、runner コンテナの外（ホストの root から `docker exec`）で `config list` を実行すると例外で失敗した。CLI は runner のコンテナの環境で動かす。
  - 検証サーバの AdGuard runner は、`You are not logged in`（ログアウト状態）。
  - 開発サーバ（devSrv）は、Proton CLI が未導入で、実接続で経路が変わるため、この機では試験しない。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
| --- | --- | --- | --- | --- |
| A. 開発サーバから API 経由（採用） | 準備処理と試験を開発サーバで行い、検証サーバの API のみを使う | 検証サーバにブラウザ接続しない。製品の公開面だけを使う | 管理者の認証と CA の取り込みが必要。出口 IP の基準に制約がある | 要件 6・7 に合う |
| B. 検証サーバ上で CLI を直接実行 | ssh で CLI を叩く | 観測の範囲が広い | 検証サーバでの手動操作に当たる。要件 1.6 に反する | 不採用 |
| C. 製品に観測手段を追加 | API に直接の出口 IP を返す機能を足す | 基準の問題が解消する | 製品の変更になり、本 spec の境界の外 | 別の spec として判断 |

## Design Decisions（ユーザーの回答で決定）

### 決定: 接続前の出口 IP の基準は、開発サーバの公開 IP
- **Context**: API では接続前の直接の出口 IP を観測できない。
- **Selected Approach**: 準備処理が開発サーバの公開 IP を取得して記録する。試験は、接続後の VPN 経由の出口 IP がこの値と異なることを確認する。
- **Precondition**: 開発サーバと検証サーバが同じ回線（同じ公開 IP）にあること。現在の環境で確認済み（156.146.34.246）。自動では検証できないため、準備処理で端末に表示し、開発者が確認する。

### 決定: API 証明書は、検証サーバの CA を一度取り込んで検証する
- **Context**: 開発サーバは、プライベート CA の証明書を検証する必要がある。`-k`（検証なし）は採らない。
- **Selected Approach**: 検証サーバの `api-ca.crt` を一度だけ開発サーバへ取り込む（読み取りに sudo が必要）。準備処理は、CA の検証に失敗したら資格情報を送る前に中止する（要件 1.7・1.8）。
- **Risks**: 検証サーバで sudo が使えない場合は、取り込めず試験は実行できない。

### 決定: 試験の前に設定を変え、試験の後に元へ戻す
- **Context**: `tunnel-egress` は、透過ゲートウェイか明示的プロキシが有効なときだけ適用される。
- **Selected Approach**: 試験の前に必要な設定を有効にし、変更の前の値を記録する。試験の後（成功・失敗を問わず）、記録した値へ戻す（要件 8）。

### 決定: 管理者の認証も準備処理で端末から入力する
- **Context**: `/v1/` の大半は管理者のセッションを要求する。
- **Selected Approach**: 準備処理が管理者のユーザー名とパスワードを端末で入力させ、API にログインする（要件 1.9・1.10）。

## Risks & Mitigations
- **R1: 2FA のコードの期限切れ** — コードは入力直後にログインへ使う（要件 2.2）。準備処理と試験の間の待ち時間を最小にする。
- **R2: 試験中の VPN 接続による到達性の喪失** — 検証サーバのデフォルト経路が変わる。API は LAN 側の経路で応答する見込みだが、未確認。試験の前後で到達を確認する（要件 6.1）。
- **R3: 公開 IP 基準の前提** — 同じ回線の前提が崩れると、基準が誤る。準備処理で前提を確認させる。
- **R4: AdGuard のセッションの失効** — 試験の途中の失効は、その試験を失敗として記録する（要件 4.7）。

## References
- `api/src/routes/session.ts`・`api/src/auth/require-operator-session.ts`・`api/src/app.ts`
- `proxy/src/verification/gateway-checks.ts`・`api/src/verification/check-catalog.ts`・`api/src/schemas/verification.ts`
- `vendors/protonvpn/profile.json`・`vendors/adguardvpn/profile.json`
- `installer/setup.sh`（API サーバ証明書の SAN の組み立て）

## AdGuard プラン制限の観測（未実施。tasks の 2.6 で記録する）

- **Context**: AdGuard の無料版は、接続先の制限がプロファイルに定義されていない（`restricts` が空、`restrictedPattern` がない）。出力サンプルの注記（「more locations」）から、無料版の接続先が限られる可能性がある。
- **Observation Plan**: 準備処理で AdGuard にログインした状態で、無料版のアカウントから接続先を指定して接続し、応答（状態コード・エラーの種類・理由の文言）を記録する。有料版のアカウントが使える場合は、同じ接続先への応答も記録する。
- **実施順序（決定）**: 準備処理（tasks 2.1〜2.4）を実装した後に観測する（tasks 2.6）。観測は端末での管理者認証と AdGuard の device 承認を伴うため、ユーザーの立ち会いで行う。検証サーバでの手動操作は行わない。
- **Decision（未確定）**: 観測の結果で、無料版の期待値（成功か、どの応答で失敗するか）を確定する。確定後に tasks の 3.5 を作る。
- **Note**: 製品の 403 の変換は、`restrictedPattern` に一致した失敗だけに行う。AdGuard で制限が 422（通常の失敗）として返る場合、要件 4.5 の「制限」の判定は、応答の種類だけでは区別できない点に注意する。

### 観測の結果（無料版・2026-11-03）

- **記録**: `e2e/artifacts/vendor-live/observe-adguard-free-2026-11-03T14-48-28-220Z.json`（ローカルの成果物。git の対象外）
- **準備処理**: 管理者の認証、公開 IP の確認（156.146.34.246）、AdGuard の承認（無料版）はすべて成功。
- **接続先の一覧**: 取得できた（HTTP 200 相当）。国は United States, Germany, Italy, United Kingdom, Netherlands, Finland, Poland, France の 8 か国。**Seoul は含まれない**。
- **接続の要求**: 行っていない（Seoul の接続先が無いため、接続先の ID を得られなかった）。したがって、無料版で Seoul に接続したときの応答は未観測。
- **ログアウト**: 成功（HTTP 200）。
- **Decision（部分）**: 無料版では Seoul の接続先が一覧に無いため、Seoul を指定した接続は、接続前の段階で成立しない。無料版の接続先の制限（4.5）の期待値は、一覧にある国への接続の応答で確かめる必要がある。
- **残り（更新済み。下の「国を指定した観測」を参照）**: 有料版の Seoul の一覧の有無。

### 国を指定した観測（United States・2026-11-03）

| 項目 | 無料版（free） | 有料版（プラン ID は `premium`） |
| --- | --- | --- |
| 記録ファイル（成果物。git の対象外） | `observe-adguard-free-2026-11-03T14-51-43-027Z.json` | `observe-adguard-premium-2026-11-03T14-53-11-388Z.json` |
| 接続先の一覧 | 10 件（United States: us-dallas） | 80 件（United States: us-los-angeles） |
| United States への接続 | 成功（HTTP 200） | 成功（HTTP 200） |
| 接続後の状態 | connected | connected |
| 出口 IP | 89.222.99.241（基準 156.146.34.246 と異なる） | 149.34.247.161（基準 156.146.34.246 と異なる） |
| 切断・ログアウト | 成功（HTTP 200） | 成功（HTTP 200） |

- **無料版の判定**: 一覧にある国（United States）への接続は、制限されずに成功する。Seoul は無料版の一覧に無いため、無料版では Seoul を指定できない（一覧で制限されている）。
- **有料版の判定**: 一覧が広く（80 件）、United States への接続は成功する。有料版で Seoul が一覧にあるかは未確認（国を指定した観測では確かめていない）。
- **プラン名**: AdGuard のプラン ID は `free` と `premium`。design の「有料（paid）」の表記は、AdGuard では `premium` と読み替える。
- **制限の応答（403 / 422）**: 今回の観測では、無料版でも制限の応答が出なかった。4.5 の期待値は「一覧にある国は接続できる。一覧に無い接続先は指定できない」とする。
- **Decision**: 無料版の期待値（4.5）は「一覧にある国への接続は成功する」で確定。有料版で Seoul が一覧にあるかは、`--target=Seoul` の観測で確かめる（任意）。

