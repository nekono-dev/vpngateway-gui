# 調査メモ: location-distance-sort（座標データの検証）

検証日: 2026-11-08。目的: 距離の座標を、配布物に同梱した Natural Earth の公開データから引けるかを確かめる。

## 1. データ源（Natural Earth）

- 取得元: `https://naciscdn.org/naturalearth/10m/cultural/ne_10m_populated_places.zip`（Natural Earth 5.1.2）
- 取得したファイルの SHA-256: `cd149186f03d2603e0410da399b980a4357d0ac32d3a2305a49ed3dffcc41d7b`
- 件数: 7,342 件（dbf の記録数で確認）
- 利用条件: パブリックドメイン。帰属表示は不要（[利用条件](https://www.naturalearthdata.com/about/terms-of-use/)）。例外は、Washington Post・欧州委員会 JRC・XNR・IMA のデータ（地図の基図・河川・道路・時間帯）で、populated places は含まれない。
- 項目（dbf で確認）: `NAME`・`NAMEASCII`・`NAME_EN`・`ISO_A2`・`ADM0_A3`・`ADM0NAME`・`FEATURECLA`（区分）・`ADM0CAP`・`POP_MAX`（人口）・`LATITUDE`・`LONGITUDE`。
- 区分（`FEATURECLA`）: `Admin-0 capital`（202 件）・`Admin-0 region capital`（28 件）・`Admin-0 capital alt`（13 件）など。
- 注意: `ADM0CAP` は首都の判定に信頼できない（南スーダンの Juba は区分が `Admin-0 capital` なのに `ADM0CAP=0`）。首都は `FEATURECLA` で判定する。
- 注意: コソボは `ISO_A2` が `-99`。`ADM0_A3` は `KOS`。

## 2. ProtonVPN の都市一覧（検証サーバのランナーから取得）

- 取得: ランナーの CLI（proton-vpn-cli 1.0.5）の `countries list` で 149 か国、各国で `cities list <国コード>` を実行。読み取りのみ。
- 結果: 196 都市（149 か国、エラーなし）。
- 補足: 以前の brief には「197 都市」とあったが、今回の取得では 196 件。表の行数を数えても 196 件だった。
- 補足: CLI は実行時に「サーバ一覧が古い」と判断して、ランナーのサーバ一覧のキャッシュを更新する。読み取りの範囲内の動作だが、ランナーの状態は変わる。

## 3. 都市の照合

照合の規則: 国は、ProtonVPN の国コードを公開データの国に対応づける（`UK`→`GB`、`XK`→`KOS`（`ADM0_A3`））。都市名は、`NAME`・`NAMEASCII`・`NAME_EN` のいずれかが一致すればよい（アクセント・大文字小文字・記号は無視する）。

| 結果 | 件数 |
|------|------|
| 一致 | 192 / 196（98%） |
| 取りこぼし | 4 |

取りこぼし: Novi Travnik（BA）・Schaan（LI）・Ashburn（US）・Secaucus（US）。いずれも公開データに存在しない。

英語名の列（`NAME_EN`）と国の対応づけで一致したもの: Fujairah（AE）・Limassol（CY）・Copenhagen（DK）・Andorra la Vella（AD）・Pristina（XK）。英語名がない場合は一致しない。ロンドン等の英国の都市は `GB` の下にある（`UK` のままでは一致しない）。

同名の候補: Columbus（US）に 2 件（Ohio の 1,270,000 人と、Georgia の 217,980 人）。人口の最も多い候補を選ぶ規則（Requirement 3-3）で、Ohio が選ばれる。

## 4. 国の首都

- ProtonVPN の 149 か国のうち、148 か国には首都が 1 件以上ある（`Admin-0 capital` または `Admin-0 region capital`）。
- 首都が無い: プエルトリコ（PR）。`Admin-1 capital`（San Juan）のみ。
- 首都が複数ある: ボリビア（La Paz・Sucre）、コートジボワール（Abidjan・Yamoussoukro）、ミャンマー（Yangon・Naypyidaw）、パレスチナ（Gaza City・Ramallah）、南アフリカ（Johannesburg・Cape Town・Pretoria・Bloemfontein）。
- 公開データ全体（230 の国の識別）では、首都が無いのは 14 件。大半は海外領土（フランスの海外県、ニュージーランドの自治領など）。ProtonVPN の一覧には含まれない。

## 5. 決定事項（2026-11-08）

1. 首都が複数ある国: 人口の最も多い首都を使う（同名の都市の規則と揃える）。
2. 首都が無い国（プエルトリコ）: 距離なしで表示する（Requirement 3-5）。`Admin-1 capital` は使わない。

## 6. 再現の手順（要約）

- zip を新しい空のディレクトリに展開し、dbf・shp を標準ライブラリで読む（外部データのため、インタプリタに同じディレクトリのモジュールを読ませない）。
- ランナーの CLI は、`docker exec -u vpngwgui` と `DBUS_SESSION_BUS_ADDRESS` の設定で動かす（ランナーのエントリポイントと同じ環境）。

## 7. 設計の判断（2026-11-08・design フェーズ）

- **首都の区分**: `Admin-0 capital` を優先し、無ければ `Admin-0 region capital`。`Admin-0 capital alt` は使わない（日本では京都、スリランカでは別の首都が該当するため）。ProtonVPN の 149 か国は、どちらかの区分で首都が決まる（プエルトリコを除く。プエルトリコは首都の区分が無い）。区分 1 だけの国は GL・HK・MO・PS。
- **既存の並べ替えとの関係**: 既存の ping 昇順（`location-list-parser` の `sortByPing`）は変えない。距離の並べ替えは、ping が計測できないときだけ、ルートの応答直前に掛ける。ping を計測できないプロバイダでは ping 値が無いため、CLI の出力順が保たれ、距離の並べ替えが安定ソートの前提にもなる。
- **Accept-Language の解析**: 品質値（`q`）では並べ替えない。要件 2-2 の「最初の言語」を、ヘッダに書かれた順で読む。
- **お気に入りの先頭配置**: 都市の行のみ（要件 1-4）。国の行には適用しない（国単位のお気に入りは `location-city-selection` の要件 4-8 に従う）。
- **capability の再利用**: `pingMeasurement` の判定を `isPingMeasurable` として export し、距離の注釈もそれを使う（判定の規則を二重に持たない）。
- **同梱データの生成**: 生成スクリプトは依存パッケージを使わず、dbf を直接読む。入力 zip の SHA-256 と件数（7,342）を出力に記録する。
- **Accept-Language の転送（未検証）**: `@fastify/http-proxy` v10 の既定の転送で、要求ヘッダが上流へ渡るかは、受け入れテストで確かめる。
- **Build vs Adopt**: 大圏距離は三角関数の数行で足りるため、外部パッケージを使わない。国の名称は既存の `Intl.DisplayNames` を使う（`plan-locations` と同じ）。

## 8. PoC（タスク前の注意点の検証、2026-11-08）

検証はスクラッチ領域だけで行い、リポジトリと他のセッションの作業には触れていない（PoC の後も `git status` の内容は変わらず、待受ポートも残っていない）。

### 8.1 Accept-Language の転送
- 方法: 本番と同じ `@fastify/http-proxy` 10.0.2 と fastify 5.12.3 を、リポジトリの node_modules から読み取りのみで使い、`prefix: /api`・`rewritePrefix: ""`・`replyOptions.onError` の設定で中継を起動。上流はヘッダを返すだけの HTTP サーバにした。TLS と CA の設定は省いた（ヘッダの転送には影響しないと考えた）。
- 結果: 送った `ja-JP,ja;q=0.9,en-US;q=0.8` が上流にそのまま届いた。ヘッダ無しの要求では、上流にも値が付かなかった。
- 注意: Node の `fetch` は Accept-Language が無いと `*` を自動で付ける。テストでヘッダ無しを確かめるときは `node:http` を使う。
- 残り: TLS 経由の本番構成での確認は、受け入れテスト（タスク 9.1）で行う。

### 8.2 同梱データの生成と容量
- 方法: Node の標準機能だけで dbf を読み、同梱データ候補（行配列の JSON）を作った。
- 結果: 7,342 件。容量は 531 KB（見積もり 0.6 MB より小さい）。
- 照合: 設計の規則（正規化・首都の区分・人口順・別名 UK→GB、XK→KOS）を JS で実装し、ProtonVPN の都市 196 件を照合した。結果は Python の検証と一致（192 件一致、取りこぼし 4 件）。首都（JP・BO・ZA・HK・PS・PR・KOS など）も設計どおり。

### 8.3 JSON の取り込みと型
- 方法: ESM のパッケージで、`import data from "./places.json" with { type: "json" }` を使い、tsc で出力した。
- 結果: `dist` に JSON が複写され、実行時に読めた（7,342 件）。
- 注意: JSON の型推論は、混在する配列の要素を `string | number | null` として扱い、そのままでは代入エラーになる。読み込み側で件数と行の形を検査し、型を付ける必要がある。

## 9. タスク 9.1: 本番と同じ TLS 構成での確認（2026-11-08）
- 方法: ローカルの CA（ca）で API 用の証明書（SAN: DNS:api, IP:127.0.0.1）を発行し、同じ証明書で HTTPS の上流（API の代わり。受け取った Accept-Language を返す）を立てた。web は `web/server/index.ts` を、本番と同じ環境変数（API_ORIGIN・API_TLS_CA_FILE・WEB_TLS_CERT_FILE・WEB_TLS_KEY_FILE）で起動した。
- 結果A（正しい CA）: `Accept-Language: ja-JP,ja;q=0.9,en-US;q=0.8` が上流に届いた。ヘッダ無しでは上流にも値が無い。
- 結果B（誤った CA）: UNABLE_TO_VERIFY_LEAF_SIGNATURE により、502（bad_gateway）。検証が効いている。
- 後片付け: 起動したプロセスは PID で停止した。待ち受けは残っていない。他のセッションのプロセスには触れていない。
