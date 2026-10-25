# ネットワークコンテナ タスク一覧

## Phase 1: 透過ゲートウェイと接続監視

- 対応: D-1, D-2, D-3, D-4
- [x] T-1.1: nftablesのルールセットの組み立てと、原子的な置換による適用を実装する。
- [x] T-1.2: 経路の問い合わせによるトンネルの検出と、10秒周期の接続監視を実装する。
- [x] T-1.3: 設定と接続状態に応じたルールの再構成の調停と、稼働状況の導出を実装する。
- [x] T-1.4: コンテナの権限と、ホスト起動直後の遮断ガードに合わせた起動順序を整える。
- [x] T-1.5: ルールと追従の受け入れテストを追加する。
- 検証: `npm run test -w proxy && npx vitest run --config tests/vitest.config.ts tests/proxyserver/gateway-rules.test.ts tests/proxyserver/tunnel.test.ts`

## Phase 2: 明示的プロキシと設定の反映

- 対応: D-5, D-10
- [x] T-2.1: 3proxyの設定ファイルの組み立てと、許可元CIDRの厳密な検証を実装する。
- [x] T-2.2: 3proxyの起動・停止・再起動の調停と、指数バックオフの再起動を実装する。
- [x] T-2.3: 設定反映の要求の検証と、各コントローラへの振り分けを実装する。
- [x] T-2.4: 明示的プロキシの受け入れテストを追加する。
- 検証: `npx vitest run --config tests/vitest.config.ts tests/proxyserver/explicit-proxy.test.ts`

## Phase 3: DNS中継とドメイン迂回

- 対応: D-6, D-7, D-8
- [x] T-3.1: DNSメッセージの解析と、UDP・TCPの待受を実装する。
- [x] T-3.2: 迂回ドメインの照合、クライアント識別子の生成、上流への転送と障害時の切り替えを実装する。
- [x] T-3.3: 迂回対象のIPアドレスの保持と、印付け・アドレス変換・経路規則を実装する。
- [x] T-3.4: 53番の誘導規則を実装する。
- [x] T-3.5: 迂回とDNS中継の受け入れテストを追加する。
- 検証: `npx vitest run --config tests/vitest.config.ts tests/proxyserver/bypass.test.ts tests/proxyserver/dns-relay.test.ts`

## Phase 4: 制御チャネルとホスト再起動の依頼

- 対応: D-9, D-12
- [x] T-4.1: 相互TLSの受け口と、経路の振り分けを実装する。
- [x] T-4.2: ランナー宛の要求の転送を実装する。
- [x] T-4.3: ホストの再起動の依頼ファイルの作成を実装する。
- [x] T-4.4: 制御チャネルの受け入れテストを追加する。
- 検証: `npx vitest run --config tests/vitest.config.ts tests/proxyserver/control-channel.test.ts`

## Phase 5: 設定の動作検証

- 対応: D-11
- [x] T-5.1: ルール一覧の分解と、設定との照合を実装する。
- [x] T-5.2: トンネルへ束縛した出口IPの取得と、中継リゾルバへの問い合わせを実装する。
- [x] T-5.3: 誘導した送信元の記録と、検証用の名前の登録・受信の記録を実装する。
- [x] T-5.4: 動作検証の受け入れテストを追加する。
- 検証: `npx vitest run --config tests/vitest.config.ts tests/proxyserver/verification.test.ts`
