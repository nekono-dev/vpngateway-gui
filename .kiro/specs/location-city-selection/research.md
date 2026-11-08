# 調査メモ: location-city-selection（設計の前提の確認）

調査日: 2026-11-08。方法: リポジトリのコード読み取り、検証サーバのランナーでの読み取り専用の確認（接続・ログイン・設定変更はしていない）。

## 1. 既存の実装（変更の対象）
- 接続先の一覧: `routes/connection-locations.ts` が `locations/location-fetcher.ts`（CLI の `listLocations` 実行）と `location-list-parser.ts`（固定幅の表の解析。ping 昇順）を組み合わせる。
- 接続: `connection-state/apply-connection.ts` が接続先 ID を `fetchLocations` の結果から引き、`connectName` を `%LOCATION%` に代入する。
- お気に入り・前回接続: `locations/favorite-locations-store.ts`（ID の配列のみ）と `last-location-store.ts`。どちらもプロバイダごとに `$STATE_DIR/providers/<ID>/` へ保存する。
- プロファイル: ProtonVPN の `connect` は `--country %LOCATION%`（国コード 2 文字）。`listLocations` は `countries list`。`account.plans[free].availableLocations` が、サーバ一覧キャッシュ（`VPN/serverlist.json`、`LogicalServers` 配列）を読む宣言を既に持つ。
- AdGuard VPN: `connect -l %LOCATION% -y`、`list-locations` は都市の行（ISO・国名・都市・ping）を返す。
- web: `LocationList.tsx` はタブ（すべて・お気に入り）と絞り込みを持つ平らな一覧。階層（国・都市・サーバ）の画面はまだ無い。

## 2. ランナーでの読み取り確認（ProtonVPN）
- `serverlist.json`: トップレベルは `LogicalServers`（18,671 件）。サーバの項目は `ID`・`Name`（例: `SE-JP#1`）・`Tier`・`Features`・`EntryCountry`・`ExitCountry`・`City`・`Load`・`Score`・`Status`・`Servers` ほか。
- Secure Core の判定: `Features` の bit 1（`Features & 1`）。Chicago（US）の 897 台のうち 20 台が該当し、brief の記載と一致する。
- `Status`: 真偽値（有効なサーバは true）。`Tier`: 0（121 件）と 2（18,550 件）。0 を無料とみなす（要確認。影響は表示の階層のみ）。
- 都市の組: 有効かつ Secure Core でないサーバの（出口の国, 都市）の組は 196 組。`cities list` の 196 組と完全に一致（差分なし）。
- `protonvpn connect --help`: `SERVER_NAME`（例: `IT#23`）で特定のサーバへ接続できる、と記載されている（ヘルプの記述のみ。実際の接続は未確認）。
- `protonvpn cities list <CC>`: 「Cities in <国名>:」の見出しに続く表（City・Features 列）。

## 3. ランナーでの読み取り確認（AdGuard VPN）
- `adguardvpn-cli connect --help`: `-l, --location` は都市名・国名・ISO コードのいずれかを受け付ける。2026-11-08 に CLI 1.8.2 で国名 `Japan` を指定した実接続（TOKYO、TUN mode、出口国コード JP）を確認。
- `connect -l "Tokyo, Japan"` と `connect -l "Tokyo, JP"` は、いずれも `There is no location with the specified city name, country name, or ISO code` で拒否された。D1 の (b) は不採用、都市名のみ（要件 6-2）で確定。
- 検証時は本番ゲートウェイ（192.168.3.251）を停止して AdGuard エンドポイントに到達し、確認後に切断した。

## 4. 要件と brief の食い違い
- brief の「国の行からは国を指定して接続する」は、承認済みの要件 6-6（国の行から国単位の接続を行わない）と食い違う。要件を優先し、設計は国の行からの接続を行わない。

## 5. 設計の判断（草案）
- 都市の一覧: CLI の `cities list` を使う（要件 5-1 の文言どおり）。サーバ一覧はキャッシュから読む。
- 都市の行の接続先: 都市内で有効かつ Secure Core でないサーバのうち Score が最も小さいもの（要件 6-1）。接続はそのサーバ名で行う。
- サーバのお気に入り ID: 接続先 ID の形式（`<国>-<都市>`）と衝突しないよう、`srv-` の接頭辞を付ける。
- お気に入りの保存形式: 表示名（都市・サーバ名）を保存し、「お気に入り」の一覧を CLI の再取得なしで組み立てる。旧形式（ID の配列）は非表示（要件 4-8）。
- 距離の注釈: `location-distance-sort` の `annotateDistances` を、国の一覧・都市の一覧・参考一覧に掛ける（都市の一覧の経路を含む）。

## 6. D2 の検証環境の確認（2026-11-08・読み取りのみ）
- 検証サーバ（192.168.3.240）: ディスクは 94G 中 45G 空き（50%）。メモリは 15G、使用可能 13G。
- LXD は利用可能。ただし、既存のコンテナ（ai-server・app-server・dev-server・dhcp-server・dns-server・jetson-server）と、他のセッションが使用中の検証用コンテナ（vh-pr1・vh-pr2・vh-ag1〜3）がある。新しい環境は、これらに影響しない形で作る。
- ランナーは Docker のイメージ（`vpngwgui-runner-protonvpn`）で動いている。イメージの導入には、Proton 公式リポジトリ・NetworkManager・gnome-keyring・D-Bus が必要。
- 実ログインは、利用者の資格情報（ProtonVPN の入力）が必要。自動化・資格情報の複写は行わない。
- 検証の方法（予定）:
  1. 既存のランナーのイメージから、隔離された検証用コンテナを一つ作る（既定のブリッジネットワーク。ホストのネットワークは使わない。既存のコンテナ・ポートには触れない）。
  2. 利用者が、そのコンテナ内で ProtonVPN にログインする（資格情報は利用者が入力する）。
  3. `protonvpn connect <無効なサーバ名>` で、名前の検証の挙動を確かめる。`protonvpn connect <有効なサーバ名>` で、実際の接続を確かめ、切断する。
  4. 結果を記録する。検証後に、コンテナを削除する。
- 代替（D2 が失敗した場合）: `protonvpn connect --city <都市名>`（CLI が選ぶ最速のサーバ）。要件 6-1 の Score の規則とは選び方が異なる。
- AdGuard VPN の (b) は CLI に拒否されたため不採用。国名接続 `connect -l Japan -y` は CLI 1.8.2 で実接続を確認済み。
- ProtonVPN の国名接続は本 spec では未確認。

## 7. D2 の検証環境（作成記録・2026-11-08）
- 隔離コンテナ: `cityconn-probe-pvn`（既存の `vpngwgui-runner-protonvpn:latest` イメージから作成）。
- 網: 既定のブリッジ（172.17.0.0/16）。ポートは公開しない。ホストの網（host）は使わない（本番のランナーは host 網のため、そのままでは本番の経路に影響する）。
- 権限: `NET_ADMIN` のみ（特権コンテナではない）。ユーザー 0:0 で起動（エントリポイントの要件）。
- ボリューム: `cityconn-probe-{ctl,config,keyrings,cache}`（新規。本番のボリュームは使わない）。
- 作成直後の状態: 切断中・未ログイン（`protonvpn info` の Account: None）。ランナーは起動済み。
- 後片付け: 検証後に `docker rm -f cityconn-probe-pvn` と、`docker volume rm cityconn-probe-{ctl,config,keyrings,cache}` で削除する。

## 8. D2 の検証結果（2026-11-08・隔離コンテナで実施）
- 無効なサーバ名（`NOPE#999`）: `Error: Invalid server ID 'NOPE#999'` で拒否。接続は行われず、切断のまま（フォールバックの接続は無い）。
- 有効なサーバ名（`US-IL#378`。Chicago の最速・有効・非 Secure Core のサーバを、キャッシュの Score から選択）: `Connected to US-IL#378 in Chicago, United States.`。状態は `Server: US-IL#378 in Chicago, United States`（既存の `locationPattern` と一致）。切断で `Disconnected.`。
- 代替 `--city Chicago`: 同じ `US-IL#378` を選んだ（1 回の結果）。ただし、CLI の選び方がキャッシュの Score と常に一致するとは限らない。主方法は、要件 6-1 に従いサーバ名で接続する。
- 結論: D2 は確認済み。サーバ名での接続を、都市の行とサーバの行の接続に使う。

## 9. 後片付け（2026-11-08）
- 検証後、隔離コンテナとボリュームを削除した（下記の手順で実施）。本番のコンテナ・ボリュームには触れていない。
