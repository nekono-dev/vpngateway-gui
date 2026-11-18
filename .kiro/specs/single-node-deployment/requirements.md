# Requirements Document

## Introduction

LAN 内で VPN ゲートウェイを運用する利用者に対し、全コンテナを1台の Linux サーバへ Docker Compose で直接導入する構成だけを提供する。複数ホストへの役割分離と証明書配布に起因する導入・保守の複雑さを解消する。

Web の HTTPS は既定で無効、Web→API は信頼された同一ノード内の HTTP とする。API→Gateway は TLS の有効・無効を選択でき、既定は無効とする。VPN の利用機能・管理者認証を維持し、新方式内での保存データの扱いを定めながら、導入と通信の契約を簡略化する。

## Boundary Context

- **対象**: 単一ノードの導入・更新・停止・削除、必要最小限のホスト準備、通信保護の設定、関連する文書・配布・検証手順の変更。
- **対象外**: 複数ホストの配置・遠隔操作、未リリースの旧方式からの移行・互換対応・データ引き継ぎ、Web/API のプロセス統合、多段接続本体の実装、外部公開向け運用や証明書の自動取得・更新。
- **隣接仕様への期待**: 都市選択・距離順・ベンダー操作の意味を変えず、新しい導入・通信方式でも利用できること。既存 E2E と配布手順は新方式へ追従し、多段接続の今後の作業は新しい導入契約を前提に再確認する。
- **用語**: 「利用者」は LAN の Web ダッシュボードを操作する人、「運用者」はホスト準備・設定・Compose 操作を行う人。「内部制御通信」は同じノードの製品サービス間の通信で、LAN 端末からの管理操作とは区別する。
- **未リリースの扱い**: 旧方式で作成した環境・設定・保存データからの移行や互換性は保証しない。要件6の保持は、新方式で運用を始めた後の通常の更新・停止・再作成に対するものである。
- **記述上の前提**: Docker Compose、HTTP、TLS は利用者が指定した導入・通信の製品契約である。ファイル構成、設定名、待受アドレス、認証方式の実装は設計で定める。

## Requirements

### Requirement 1: 単一ノードの直接導入
**Objective:** As a 運用者, I want 全サービスを同じサーバへ Compose で導入したい, so that ホスト間の配置やペアリングを管理せずに利用できる。

#### Acceptance Criteria
1. The VPN Gateway System shall 全サービスを同じ Debian 12 以降または Ubuntu 22.04 以降の Linux ノード上の rootful Docker Engine で動かす構成だけを、サポートする導入構成として提供する。rootless Docker はサポートしない。
2. When 運用者が文書化されたホスト準備と設定を完了して Docker Compose の起動操作を行う, the VPN Gateway System shall Web・API・Gateway と有効にしたベンダーの実行環境をそのノードで起動する。
3. The VPN Gateway System shall 既存インストーラによる役割選択や構成ファイル生成を、通常の Compose 起動の前提にしない。
4. The VPN Gateway System shall 別ホストの Web・API・Gateway の配置先選択、遠隔導入、ペアリング操作を提供しない。
5. When 運用者が利用するベンダーを選択して構成を起動する, the VPN Gateway System shall 選択したベンダーを既存のベンダー宣言に従って利用可能にする。

### Requirement 2: 必要最小限のホスト準備
**Objective:** As a 運用者, I want Compose の前提となるホスト設定を明示的に準備・確認したい, so that VPN ゲートウェイを再起動後も運用できる。

#### Acceptance Criteria
1. When 運用者がホスト準備を実行する, the Host Preparation Tool shall Debian 12 以降または Ubuntu 22.04 以降であること、root 実行、必要コマンド、rootful Docker Engine、LAN_IFACE の妥当性、および nftables の構文検査が可能であることを静的に検証する。check は読み取り専用で boot guard を適用せず、boot guard の実適用・確認は apply が担う。apply が失敗した場合は非0で終了し非対応環境とする。rootless Docker は非対応とする。その環境はサポート対象外であり、製品を利用可能と扱わない。
2. When ホスト準備が成功する, the Host Preparation Tool shall LAN 通信の転送と必要なホスト操作を製品が利用できる状態にする。
3. When 同じ設定でホスト準備を再実行する, the Host Preparation Tool shall 製品が管理する設定や常駐処理を重複させない。
4. If ホスト準備の処理が失敗する, the Host Preparation Tool shall 成功として終了せず、失敗した処理と既に適用した変更を運用者が確認できるようにする。
5. When ホストが再起動する, the VPN Gateway System shall proxy が API から設定を初回受信して適用し、通信の転送可否を制御できるようになるまで製品の LAN 転送経路を遮断する。proxy の内部既定値を設定通知前に適用済みと扱わない。boot guard を nftables/systemd で実際に適用または確認できない環境では apply を非0で失敗させ、サポート対象外とする。
6. When 管理者が既存のホスト再起動操作を要求する, the VPN Gateway System shall ホストへ再起動要求を送り、受付結果を管理者へ返す。
7. When 運用者がホスト準備の確認または解除を行う, the Host Preparation Tool shall 製品が管理する設定・常駐処理と解除対象を識別できるようにし、製品と無関係な設定を変更しない。
8. When Gateway が停止中または unhealthy であり、透過ゲートウェイと Kill Switch が両方有効である, the VPN Gateway System shall 製品が管理する LAN 転送経路を遮断する。Gateway が healthy の間は通常 ruleset が転送可否を決め、VPN egress forwarding を許可できる。proxy 再起動時は API settings の初回受信・適用まで既存 guard state を変更せず、LEASE は lease の自然失効で遮断し、OFF は OFF のままとする。明示的プロキシのみのモードでは Kill Switch と停止時遮断保証を提供しない。

### Requirement 3: Web の HTTP 既定と任意の HTTPS
**Objective:** As a 利用者, I want 証明書を用意せず LAN の管理画面へアクセスしたい, so that 証明書の問題で初期利用を妨げられない。

#### Acceptance Criteria
1. When 運用者が Web の通信保護設定を変更せずに構成を起動する, the Web Service shall HTTPS を無効として HTTP で管理画面を提供する。
2. While Web の HTTPS が無効である, the Web Service shall Web 用証明書・秘密鍵・CA の生成や配置を起動条件にしない。
3. When 運用者が Web の HTTPS を有効にして必要な証明書設定で構成を起動する, the Web Service shall HTTPS で管理画面を提供する。
4. If Web の HTTPS が有効なのに必要な証明書設定が不足または不正である, the Web Service shall 原因を運用者へ示し、無断で HTTP へ切り替えて起動しない。
5. While 利用者が HTTP または HTTPS で管理画面を利用する, the VPN Gateway System shall 既存の初期管理者登録・ログイン・ログアウト・セッションによるアクセス制限を維持する。
6. While Web の HTTPS が有効である, the VPN Gateway System shall 内部 API が HTTP であっても、ブラウザ向け認証 Cookie が HTTP 接続では送信されないようにする。

### Requirement 4: Web と API のローカル通信
**Objective:** As a 運用者, I want Web と API を同じサーバの信頼された通信として扱いたい, so that 両者の疎通に証明書を管理する必要がなくなる。

#### Acceptance Criteria
1. The VPN Gateway System shall Web→API の通信を同一ノード内の HTTP として提供する。
2. When API 用の証明書や CA が配置されていない状態で通常構成を起動する, the VPN Gateway System shall 管理画面から API を利用できるようにする。
3. The VPN Gateway System shall 通常構成で API の待受を LAN 端末向けに直接公開しない。
4. While 利用者が管理画面を操作する, the Web Service shall ブラウザからの API 操作を管理画面と同じオリジンで提供する。
5. If Web から API に到達できない, the Web Service shall 管理画面の API 操作へ到達不能を示すエラーを返し、未使用の証明書を追加するよう要求しない。
6. When API が復旧する, the Web Service shall Web の証明書再生成や再ペアリングなしで API 操作を再開できるようにする。

### Requirement 5: API と Gateway の通信保護選択
**Objective:** As a 運用者, I want API→Gateway の TLS を必要に応じて選びたい, so that 通常は証明書なしで運用し、必要時だけ通信を保護できる。

#### Acceptance Criteria
1. When 運用者が API→Gateway の通信保護設定を変更せずに構成を起動する, the VPN Gateway System shall TLS を無効とする。
2. While API→Gateway の TLS が無効である, the VPN Gateway System shall 証明書・秘密鍵・CA の生成や配置なしで Gateway の状態取得と制御を提供する。
3. When 運用者が API→Gateway の TLS を有効にし、有効な証明書設定で構成を起動する, the VPN Gateway System shall 通信相手の証明書を検証して Gateway の状態取得と制御を提供する。
4. If TLS が有効な区間で証明書が不足・不正・期限切れであるか通信相手を検証できない, the VPN Gateway System shall その区間の保護された接続を成功とせず、原因を示して平文へ自動降格しない。
5. If API と Gateway の TLS/保護モード設定が一致せず疎通できない, the VPN Gateway System shall 他の TLS エラーと区別できる不一致イベントをログに記録し、status に専用の不一致状態を示し、Web UI に「API と Gateway の通信保護設定が一致しない」旨を表示し、無断で別の保護方式へ切り替えない。
6. The VPN Gateway System shall Web の HTTPS 設定と API→Gateway の TLS 設定を独立に選択できるようにする。
7. While 内部制御通信を利用する, the VPN Gateway System shall TLS の有効・無効にかかわらず、LAN 端末から Gateway の内部制御を直接実行できないようにする。
8. When 運用者が通信保護設定を変更して構成を再起動する, the VPN Gateway System shall 指定した保護方式を適用し、設定していない証明書生成や別ホストとのペアリングを要求しない。

### Requirement 6: Compose 中心のライフサイクルと保存データ
**Objective:** As a 運用者, I want 新方式の運用で Compose を使って起動・更新・停止・削除したい, so that 導入後も同じ運用方法を使える。

#### Acceptance Criteria
1. When 運用者が新方式の文書化された更新手順を実行する, the VPN Gateway System shall 旧インストーラの更新コマンドなしで新しい製品版を起動できるようにする。
2. When 運用者が新方式で作成した環境の停止・再起動・コンテナ再作成を行う, the VPN Gateway System shall 管理者アカウント・設定・お気に入り・製品が永続保存する監査ログ・ベンダーの保存された認証状態を保持する。
3. When 運用者がベンダーを一時的に無効にして再度有効にする, the VPN Gateway System shall 明示的なデータ削除なしに保存されたベンダー状態を消去しない。
4. When 運用者が通常の停止またはコンテナ削除を行う, the VPN Gateway System shall 永続データの削除をその操作の必須条件にしない。
5. When 運用者が製品のホスト設定の解除を明示的に実行する, the Host Preparation Tool shall 製品が導入したホスト設定と常駐処理を解除できるようにする。
6. If 運用者が永続データの削除を明示的に選択していない, the VPN Gateway System shall ホスト設定の解除または通常のコンテナ削除によって保存データを削除しない。
7. If 起動または更新に必要な構成が不正である, the VPN Gateway System shall 不正な設定を識別できるエラーを示し、起動・更新が成功したと報告しない。

### Requirement 7: 新方式の導入案内と配布
**Objective:** As a 運用者, I want 新方式に統一された導入・運用手順を参照したい, so that 廃止された分離構成の手順と混同しない。

#### Acceptance Criteria
1. The Product Documentation shall 単一ノードのみをサポートすること、Compose を利用する新しい導入・更新・停止・削除方法、ホスト準備の必要性を説明する。
2. The Product Documentation shall 旧インストーラの役割指定・遠隔配置・ペアリング手順を現行版の有効な導入方法として案内しない。
3. The Product Documentation shall Web HTTPS と API→Gateway TLS の既定値、任意有効化の設定と証明書の準備方法を区間ごとに説明する。
4. When 現行版の配布・導入案内を提供する, the Product Distribution shall Compose を使う導入方法と必要なホスト準備を利用可能にし、旧インストーラで分離配置を新規導入させない。
5. The Product Documentation shall 新方式への新規導入を案内し、未リリースの旧方式からの移行・互換対応・保存データの引き継ぎをサポート対象として案内しない。

### Requirement 8: 既存機能と隣接検証の維持
**Objective:** As a 利用者と運用者, I want 導入方式を変えても既存の VPN 操作が使えることを確認したい, so that 構成の簡略化を機能の後退なしで受け入れられる。

#### Acceptance Criteria
1. While 単一ノード構成で製品を利用する, the VPN Gateway System shall 既存のベンダー切り替え、接続・切断、都市・サーバ選択、お気に入り、距離順の機能を維持する。
2. While 単一ノード構成で LAN 通信を処理する, the VPN Gateway System shall 既存の透過ゲートウェイ・明示的プロキシ・DNS 中継・迂回と Kill Switch の設定に従って通信を処理する。
3. The Product Verification shall 証明書を配置しない既定構成で、Compose 経由の導入・アプリ起動・管理者認証・Web からの VPN 操作・Gateway の通信を確認できるようにする。
4. The Product Verification shall Web HTTPS と API→Gateway TLS の有効・無効の全組み合わせ、および TLS 有効時の不正な証明書による接続失敗を確認できるようにする。
5. The Product Verification shall 文書化された Compose 経由の更新・停止・再起動・削除と、保存データの保持・明示的削除を確認できるようにする。
6. The Product Verification shall hosted E2E と手動の実 VPN 試験で、新しい API 到達経路と通信保護設定を利用できるようにする。
7. The Product Verification shall 新しい導入方式の検証に実 VPN の資格情報を hosted CI へ渡すことを要求しない。
8. If 許可されていないベンダー操作のコマンド実行が要求される, the VPN Gateway System shall 通信保護の有効・無効にかかわらずそのコマンドを実行しない。
