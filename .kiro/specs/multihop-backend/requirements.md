# Requirements Document

## Introduction
利用者は、出口の接続先に出る前に、1 つ以上の入口（経由する段）を経由して接続したい。
この spec は、経由する段を n 段まで扱える接続の仕組みを定める。画面は対象外（`multihop-ui` で扱う）。

用語:
- **段**: 経路上の 1 本の接続。出口の接続先も 1 段に数える。段数 n は、経路上の接続の本数である（「二段接続」は段数 2、入口 1 つと出口）。
- **入口**: 出口より前の段。入口の選び方は、段ごとに 3 方式（ランダム・プロバイダ選択・手動選択）から選ぶ。

## Boundary Context
- **In scope**:
  - 段数 n の経路の構成と、経路の接続・切断
  - 段ごとの接続先の決定（3 方式。プロバイダ選択の既定の提供元は出口と同じ）
  - 段ごとに提供元が異なる組み合わせ
  - 段が切れたときの動作（既定は遮断。段を外して継続も選べる。段ごとに設定する）
  - 経路の状態（段の一覧と、各段の状態）の提示
  - 段数 1（出口のみ）の接続が、今の接続と同じ結果になること
- **Out of scope**:
  - 画面（タブ・スイッチ・一覧・ラジオ）。`multihop-ui` で扱う。
  - 同時接続の上限の設定・検出・拒否（上限は設けない。規約への注意表示は画面の扱い）
  - 既存のベンダー機能 Secure Core（アプリの画面やコードでは使われていない。二段接続で置き換える）
  - 長い転送の安定性の保証（3 段以上で途中終了が起きることがある。注意事項として `.kiro/discovery/multihop-chain-input.md` の section 17 に記録し、要件の制約にはしない）
- **Adjacent expectations**:
  - `location-city-selection`: 都市の一覧を提供する。入口の候補は、この一覧から作る。
  - `location-distance-sort`: 距離による並べ替えは、この spec の入口の選び方に含めない。
  - `e2e-tests`: 多段接続のモックを追加する場合の基盤を提供する。

## Requirements

### Requirement 1: 段数と経路の構成
**Objective:** As a 利用者, I want 出口の接続先に、任意の段数の経路で接続すること, so that 出口の国に出る前に、別の国を経由できる

#### Acceptance Criteria
1. When 段数 n（n ≥ 2）の経路での接続が要求されたとき、the system shall 出口の接続先の前に n − 1 段の入口を経由して、出口へ接続する。
2. The system shall 段数と、同時に張る接続の本数に、上限を設けない。
3. When 段数 n（n = 1）の接続が要求されたとき、the system shall 出口の接続先だけへ、今の接続と同じ結果で接続する。
4. If 経路上のいずれかの段の接続が完了できないとき、the system shall 経路の接続を完了させず、失敗した段の位置と理由を返す。
5. While 経路が接続中である間、the system shall 経路の段の並び（入口から出口の順）を保持する。

### Requirement 2: 入口の接続先の決定
**Objective:** As a 利用者, I want 段ごとの入口の選び方を決めること, so that 経由する国とサーバを、目的に合わせて決められる

#### Acceptance Criteria
1. Where 段の選び方がランダム（既定）である場合、the system shall 段の提供元の候補から、無作為に 1 つの接続先を選ぶ。
2. Where 段の選び方がプロバイダ選択である場合、the system shall 段の提供元の方式で接続先を選ぶ（AdGuard VPN は ping の値が最小の接続先、ProtonVPN は Score の値が最小の接続先）。
3. When 段の選び方がプロバイダ選択で、段の提供元が「出口と同じ」（既定）であるとき、the system shall 出口の接続先と同じ提供元の方式で接続先を選ぶ。
4. Where 段の選び方が手動選択である場合、the system shall 利用者が指定した接続先を、その段に使う。
5. While 段の選び方がランダムまたはプロバイダ選択である間、the system shall その段で選ばれた接続先を返し、利用者による変更を受け付けない。
6. If 段の候補の接続先が 1 つもないとき、the system shall 経路の接続を開始せず、候補がないことを理由として返す。
7. When 段の選び方を変更する要求が受け付けられたとき、the system shall その段で選ばれる接続先を、変更後の選び方で決め直す。

### Requirement 3: 異なるプロバイダの組み合わせ
**Objective:** As a 利用者, I want 段ごとに異なるプロバイダを組み合わせること, so that 入口と出口を、別のプロバイダの接続先から選べる

#### Acceptance Criteria
1. Where 経路の段ごとに提供元が異なる場合、the system shall 各段を、その段の提供元の接続方法で接続し、1 つの経路として扱う。
2. Where 経路の段が出口と同じ提供元である場合、the system shall 異なる提供元を含む経路と同じ方法で、その段を扱う。
3. If 段の提供元の組み合わせが、その提供元のプランでは利用できないとき、the system shall 経路の接続を開始せず、利用できない段と理由を返す。

### Requirement 4: 段の切断時の動作
**Objective:** As a 利用者, I want 経路の一部が切れたときの動作を選ぶこと, so that 通信の遮断と継続を、用途に合わせて決められる

#### Acceptance Criteria
1. The system shall 切断時の動作の既定を、いずれかの段の切断で経路上の通信を遮断することとする。
2. Where 段ごとに切断時の動作が「切れた段を外して継続」と指定されている場合、the system shall その段が切断されたとき、その段を経路から外し、残りの段で接続を継続する。
3. The system shall 切断時の動作を、段ごとに個別に指定できる。
4. If 出口の段が切断されたとき、the system shall 通信を遮断し、経路の状態を切断として返す。
5. If 切れた段を外した後の経路が成立しないとき、the system shall 通信を遮断し、経路の状態を切断として返す。
6. When 段が切断されたとき、the system shall 切断された段の位置と、取られた動作（遮断または継続）を返す。

### Requirement 5: 経路の状態の提示
**Objective:** As a 利用者, I want 経路の状態を確認すること, so that どの段が接続中で、どの国に出ているかを把握できる

#### Acceptance Criteria
1. While 経路が接続中である間、the system shall 各段の接続先（入口から出口の順）と、各段の状態（接続中または切断）を返す。
2. When 段の状態が変わったとき、the system shall 変わった段の位置と、新しい状態を返す。
3. While 段数が 1 の接続である間、the system shall 今の接続状態と同じ内容を返す。

### Requirement 6: 通信の経路と通過
**Objective:** As a LAN 機器の利用者, I want 経路を通じた通信が、段数に関わらず通ること, so that 機器ごとの設定なしに、経路の出口から通信できる

#### Acceptance Criteria
1. While 経路が接続中である間、the system shall LAN 機器からの通信を、すべての段を経由して出口へ送る。
2. While 経路が接続中である間、the system shall 経路の実効上限に合わせて、通信の最大サイズを設定する。
3. While 経路が接続中である間、the system shall 経路の実効上限以下の大きさの通信を、途中で止めずに通す。
4. When 段が追加されて経路の実効上限が下がったとき、the system shall 通信の最大サイズを、新しい上限に合わせて設定し直す。

### Requirement 7: 段ごとのログインの維持
**Objective:** As a 運用者, I want 段の再作成でログインが失われないこと, so that 段を入れ替えても、接続先の再ログインが不要になる

#### Acceptance Criteria
1. The system shall 段ごとに、そのデバイスのログイン状態を、段の再作成の前後で維持する。
2. If 段のログイン状態が失われたとき、the system shall その段の接続を開始せず、再ログインが必要であることを返す。
