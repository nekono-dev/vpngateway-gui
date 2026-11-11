# Research & Design Decisions

---
**Purpose**: 多段接続（multihop-backend）の設計判断の根拠を残す。設計の本文（design.md）は、ここでの結論を自己完結した形で再掲する。
**Language**: ja
---

## Summary
- **Feature**: `multihop-backend`
- **Discovery Scope**: Complex Integration（既存の 1 トンネル・1 プロバイダ前提の接続系への拡張。ゲートウェイ・API・ランナー・ホスト制御に跨る）
- **Key Findings**:
  - 段ごとに Docker のネットワーク（bridge）を分け、外側の段を経由して内側の段を接続する方式が、AdGuard VPN と ProtonVPN の両方で成立した（検証サーバ、2026-11-08）。
  - ネットワーク名前空間（`ip netns`）の方式は、AdGuard VPN のログインが失われたため採らない。
  - ログインは作成時の MAC アドレスに結び付く。段のコンテナの MAC を固定すれば、再作成後もログインが残る。
  - 段が増えると経路の MTU が下がる（実測: 2 段・3 段は IP サイズ 1440、5 段は 1368）。出口の MTU を経路の実測値に合わせれば、大きいパケットが通る。
  - 長い転送の途中終了は、AdGuard の段を内側に重ねた経路で起きた（TCP over TCP の仮説）。要件の制約にはしない（利用者の決定）。注意事項として `.kiro/discovery/multihop-chain-input.md` の section 17 に記録。

## Research Log

### 既存の接続系の構造（コード調査）
- **Context**: 多段化で変える範囲を確定するため、既存の接続系を調べた。
- **Sources Consulted**: `proxy/src/network/gateway-controller.ts`・`tunnel-interface.ts`・`connection-monitor.ts`・`policy-routing.ts`・`ruleset.ts`、`proxy/src/gateway-channel/runner-forward.ts`、`proxy/src/host-control/host-reboot.ts`、`api/src/connection-state/connection-state-store.ts`・`providers/provider-switcher.ts`・`proxy-client/proxy-client.ts`、`vendors/*/profile.json`、`compose/gateway.yml`
- **Findings**:
  - ゲートウェイの状態は単一の `vpnIface`（文字列）。出口の検出は 1.1.1.1 への経路から 1 つ取る。
  - 接続状態は 1 プロバイダに 1 つ（`connection-state-store` の `getStoredConnection(providerId)`）。切替（`switchProvider`）は接続を切断してから行う。
  - ランナーは 1 ベンダーに 1 つ。UDS は `runner-<vendorId>.sock`（`runner-forward.ts`）。段ごとの識別子がない。
  - ホスト側の操作は、proxy が依頼ファイルを置き、ホストの systemd が実行する形（`host-reboot.ts`）。コンテナの作成を API や proxy に持たせる前例はない。
  - ベンダーの値は `profile.json` の宣言で表す（`structure.md`）。段の選び方の規則（ping の最小・Score の最小）も、ベンダーごとの宣言にする。
- **Implications**: 多段化の中心は、(1) 段の一覧を持つ経路の状態、(2) 段ごとのランナーの識別（UDS とコンテナ）、(3) 段ごとのネットワークとルーティング、(4) ホスト側の段コンテナの作成。

### ネットワーク名前空間方式（不採用）
- **Context**: 段ごとに `ip netns` で分ける案の成立性。
- **Findings**: 名前空間の中で AdGuard VPN の CLI を実行すると、デバイスのログインが失われた（4 回中 4 回）。ログアウトはサーバ側の失効ではなく、CLI がローカルのログイン情報を破棄したため（MAC の変化で再現）。
- **Implications**: 段の分離は、名前空間ではなく Docker のネットワーク（コンテナ）で行う。

### Docker の bridge と MAC の固定（採用）
- **Context**: 段ごとのネットワークとログインの維持。
- **Findings**: 段のコンテナは専用の bridge に置き、MAC を固定する。MAC を変えると、ログインが消える（`/home/vpngwgui/.local/share/adguardvpn-cli` 配下の設定が書き換わる）。同じ MAC と同じボリュームなら、コンテナを作り直してもログインが残る。
- **Implications**: 段（デバイス）ごとに、MAC・ボリューム・ネットワークの組を固定して管理する。

### 段の接続順序と中継（採用）
- **Context**: 内側の段の接続が成立する条件。
- **Findings**: 外側の段を先に接続し、内側の段の既定経路を外側の段へ向けてから、内側の段を接続する。逆の順序では、内側の段のトンネルが再接続のまま止まった。中継は、各段の FORWARD（内側から出る tun へ）と、内側の網からの MASQUERADE で行う。
- **Implications**: 接続は外段から順に行う。段ごとに「既定経路の向き」と「NAT」を設定するルーティング層が要る。

### MTU（採用: 出口の MTU を実測で決める）
- **Context**: 段が増えると経路の上限が下がる（要件 6.2・6.3）。
- **Findings**: DF 付き ICMP で、経路の実効上限を探索できる（2 段・3 段: IP サイズ 1440、5 段: 1368）。出口の proton0 を、実測値以下に設定すると通る（1440・1360）。ホストの直接経路は 1472 まで通る。
- **Implications**: 接続のたびに、外へ出る経路の上限を実測して、出口の MTU を設定する。実測の方法は proxy の責務とする。
- **Caveat**: 実測と設定の値は、検証サーバの条件に依る。本番の経路（ホストの既定経路が本番ゲートウェイを経由する）では、再測定が要る（brief の Open Questions）。

### TCP over TCP（注意事項。設計の制約にはしない）
- **Context**: AdGuard の段を内側に重ねた経路で、10 MB の取得が途中で終わった。
- **Findings**: 途中終了は、宛先が RST で切ったもの。AdGuard のトンネルは TCP 443 で張られている。Proton の段どうしの重ね（2 段）と、AdGuard を最外段に 1 つだけ置いた 3 段は、全量取得できた。MSS クランプでは改善しなかった。
- **Implications**: 要件の制約にはしない（利用者の決定）。設計の検証フックとして、長い転送の確認を残す。詳細は discovery の section 17。

### ホスト側での段コンテナの作成（採用: 依頼ファイル方式）
- **Context**: 要件 1.2（段数に上限を設けない）と、要件 7.1（段のログインを再作成の前後で維持）を両立する方式。
- **Findings**: 段の数だけコンテナが要る。固定の枠（スロット）を先に用意すると、上限になる。API や proxy に Docker の操作権限を持たせると、権限が広すぎる。既存の再起動依頼（`host-reboot.ts`）と同じく、依頼ファイルをホスト側の常駐処理が実行する方式なら、権限を増やさずに段数を増やせる。
- **Alternatives Considered**:
  1. 固定スロットを compose に並べる — 上限が生じるため不採用（要件 1.2 と矛盾）。
  2. API に Docker ソケットを渡す — 権限が広すぎるため不採用。
  3. ホストの常駐処理へ依頼ファイルを渡す — 採用。
- **Follow-up**: 依頼の形式、常駐処理の配置（installer）、既存の `vpngwgui-ctl`（常設コマンド）との関係を design で決める。

### 異なるプロバイダの組み合わせ（採用）
- **Context**: 段ごとに提供元が違う経路（要件 3.1）。
- **Findings**: ProtonVPN の起動処理は、`proton[0-9]+` のインターフェースを起動時に消す。複数の段を同居させるとき、消す範囲は Proton の段に限る必要がある。AdGuard の段とは、経路表と NAT の番号を段ごとに分ければ共存できた（5 段の検証で、AdGuard と Proton を混在させて接続できた）。
- **Implications**: 段ごとのトンネル（インターフェース名）と経路表の番号を、段の識別子で決める。プロバイダ固有の起動処理は、段のランナーの内側に閉じる。

### 段の選び方の規則（採用: ベンダーの宣言）
- **Context**: AdGuard VPN は ping、ProtonVPN は Score で選ぶ（要件 2.2）。
- **Findings**: AdGuard VPN の一覧には `PING` 列がある（`vendors/adguardvpn/samples.json`）。ProtonVPN の Score は、現行のコードには無く、`location-city-selection` の要件書にだけ登場する。
- **Verification (2026-11-08)**: CLI の `servers`・`status`・`connect` のヘルプには Score が出ない。一方、CLI のキャッシュ `~/.cache/Proton/VPN/serverlist.json` の `LogicalServers[].Score` に、全 18,671 件の Score（浮動小数）が入っている（例: SE-JP#1 = 2.99、CH 系 = 約 0.8）。
- **Implications**: 規則（対象の値・最小化）は `profile.json` の宣言にする。Score の取得元は、ランナーのキャッシュファイル。キャッシュ形式は CLI の版に依るため、版と項目名を宣言に書く。

### Web 上の外部調査（未実施）
- **Context**: discovery の full 手順は、外部の文献・ドキュメントの調査を求める。
- **Findings**: 本件の判断に必要な事実（経路の成立、MTU、ログインの MAC 依存、TCP over TCP の症状）は、検証サーバでの実測で得ている。外部の文献調査は行っていない。
- **Implications**: 外部のプロトコル仕様に依存する判断（WireGuard の MTU 既定値など）は、実測の値を根拠とし、文献による裏付けは行っていない。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| 段の配列を持つ経路（採用） | 経路を段の列として表し、段ごとに接続先・提供元・方式を持つ | 段数に依らない。1 段は要素 1 つの特殊例で、既存の 1 段と揃う | 状態モデルの変更が大きい | 要件 1.1・1.3 に合う |
| 1 トンネル＋プロバイダの拡張 | 既存の単一の状態を、トンネルの配列に広げる | 変更が小さい | 段ごとの提供元・識別子が後付けになる | 不採用 |
| 名前空間で段を分離 | `ip netns` ごとに段を分ける | 作成が軽い | AdGuard のログインが失われた | 不採用（上記） |

## Design Decisions

### Decision: 段の識別子と段コンテナの対応
- **Context**: 要件 1.1・7.1。段ごとに、ネットワーク・MAC・ボリューム・UDS を対応させる必要がある。
- **Alternatives Considered**:
  1. 段の位置（1 つ前、2 つ前…）で識別する — 経路が変わると、同じ端末の段が別の位置になり、ログインの対応が崩れる。
  2. 段のログイン（デバイス）の識別子で固定する — 登録したデバイスごとに、MAC・ボリューム・UDS を一意に持つ。
- **Selected Approach**: デバイス（ログイン）の識別子を段の識別子とする。段の位置は、経路を組むときに決める。
- **Rationale**: 段の位置が変わってもログインは変わらない。要件 7.1 を満たす。
- **Trade-offs**: 段コンテナの数は、登録したデバイスの数と同じになる（上限ではなく、登録の数）。
- **Follow-up**: 識別子の採番と保存は design の State Management で決める。

### Decision: 段コンテナの作成はホスト側の常駐処理に依頼する
- **Context**: 要件 1.2・7.1。詳細は上の Research Log を参照。
- **Selected Approach**: proxy（または API）が依頼ファイルを置き、ホストの常駐処理が段コンテナを作る・作り直す。作成時の MAC とボリュームは、デバイスの識別子から決める。
- **Rationale**: 段数に固定の上限を設けず、Docker の操作権限を API に渡さない。
- **Follow-up**: 依頼の形式と、常駐処理の配置（installer の一部として配布）を design で決める。

### Decision: 経路の接続は外段から順に行う
- **Context**: 3.x の実測（内側の段が再接続のまま止まる）。
- **Selected Approach**: 接続の計画で、段を外側から並べ、段ごとに「既定経路の向き → 接続」の順に実行する。途中の段が失敗したら、外側から順に切断する。
- **Rationale**: 逆順では、内側の段のトンネルが安定しなかった。
- **Follow-up**: 失敗時の巻き戻しの範囲を tasks で確認する。

## Risks & Mitigations
- **RISK-1**: 段コンテナの作成を常駐処理に委ねると、依頼の失敗・遅延が接続を止める — 依頼の状態（受理・完了・失敗）を返し、タイムアウトを設ける。
- **RISK-2**: 経路の MTU の実測が、本番の経路（既定経路が本番ゲートウェイを経由）では異なる — 接続時に毎回実測し、設定する。検証の範囲を明記する。
- **RISK-3**: 長い転送の途中終了（TCP over TCP）— 要件の制約にしない。設計の検証フックに、長い転送の確認を含める。
- **RISK-4**: Proton の Score の取得方法が未確認 — 方式の実装前に、CLI の出力を確認する。
- **RISK-5**: 1 プロバイダ前提のコード（切替・接続状態・一覧）との衝突 — 既存の spec（`location-city-selection`・`location-distance-sort`）と同じファイルを触るため、統合時に確認する。

## References
- `.kiro/discovery/multihop-chain-input.md` — 検証の記録（section 9〜17）
- `.kiro/specs/multihop-backend/brief.md` — 検証結果の要約
- `proxy/src/host-control/host-reboot.ts` — ホスト側の依頼の前例
