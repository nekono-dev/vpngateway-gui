// 責務: DNSメッセージ（RFC 1035）のうち、中継に必要な最小限の解析・組み立てを行う純粋関数群。
// 問い合わせ名の取り出し、応答のRCODE・Aレコード（IPv4アドレスとTTL）の抽出、SERVFAIL応答・切り詰め応答の生成。

const HEADER_LENGTH = 12;
const TYPE_A = 1;
const FLAG_QR = 0x8000;
const FLAG_TC = 0x0200;
const FLAG_RD = 0x0100;
const FLAG_RA = 0x0080;
export const RCODE_SERVFAIL = 2;
// 圧縮ポインタのループ等、不正なメッセージでの無限ループを防ぐための上限。
const MAX_NAME_JUMPS = 32;

export interface DnsQuestion {
  id: number;
  name: string;
  type: number;
  // 先頭の質問の終端オフセット（応答の組み立てに使う）。
  questionEnd: number;
  // ヘッダのARCOUNT（EDNS0のOPTレコードの有無の判定に使う）。
  additionalCount: number;
}

export interface DnsARecord {
  address: string;
  ttl: number;
}

export interface DnsAnswer {
  rcode: number;
  truncated: boolean;
  aRecords: DnsARecord[];
}

interface NameResult {
  name: string;
  // 名前の直後（次のフィールドの先頭）のオフセット。圧縮ポインタの場合はポインタの直後。
  next: number;
}

function readName(buffer: Buffer, start: number): NameResult | undefined {
  const labels: string[] = [];
  let offset = start;
  let next: number | undefined;
  let jumps = 0;
  for (;;) {
    if (offset >= buffer.length) return undefined;
    const length = buffer[offset];
    if (length === 0) {
      return { name: labels.join(".").toLowerCase(), next: next ?? offset + 1 };
    }
    if ((length & 0xc0) === 0xc0) {
      if (offset + 1 >= buffer.length) return undefined;
      next ??= offset + 2;
      offset = ((length & 0x3f) << 8) | buffer[offset + 1];
      jumps += 1;
      if (jumps > MAX_NAME_JUMPS) return undefined;
      continue;
    }
    if ((length & 0xc0) !== 0) return undefined;
    if (offset + 1 + length > buffer.length) return undefined;
    labels.push(buffer.subarray(offset + 1, offset + 1 + length).toString("latin1"));
    offset += 1 + length;
  }
}

/**
 * 目的: DNSクエリから先頭の質問（名前・型）を取り出す。
 * 入力: buffer(UDPペイロードまたはTCPのフレーム本体)。
 * 出力: 質問。クエリでない（QR=1）、質問が無い、形式が不正な場合はundefined。
 */
export function parseQuery(buffer: Buffer): DnsQuestion | undefined {
  if (buffer.length < HEADER_LENGTH) return undefined;
  const flags = buffer.readUInt16BE(2);
  if ((flags & FLAG_QR) !== 0) return undefined;
  if (buffer.readUInt16BE(4) < 1) return undefined;
  const name = readName(buffer, HEADER_LENGTH);
  if (name === undefined || name.next + 4 > buffer.length) return undefined;
  return {
    id: buffer.readUInt16BE(0),
    name: name.name,
    type: buffer.readUInt16BE(name.next),
    questionEnd: name.next + 4,
    additionalCount: buffer.readUInt16BE(10),
  };
}

/**
 * 目的: DNS応答から、RCODEと応答セクションのAレコード（IPv4アドレス・TTL）を取り出す。
 * 入力: buffer(応答メッセージ)。
 * 出力: 解析結果。形式が不正な場合はundefined。応答セクションの途中で壊れていた場合は、それまでに読めたAレコードを返す。
 */
export function parseAnswer(buffer: Buffer): DnsAnswer | undefined {
  if (buffer.length < HEADER_LENGTH) return undefined;
  const flags = buffer.readUInt16BE(2);
  const questionCount = buffer.readUInt16BE(4);
  const answerCount = buffer.readUInt16BE(6);
  const result: DnsAnswer = { rcode: flags & 0x000f, truncated: (flags & FLAG_TC) !== 0, aRecords: [] };

  let offset = HEADER_LENGTH;
  for (let index = 0; index < questionCount; index += 1) {
    const name = readName(buffer, offset);
    if (name === undefined || name.next + 4 > buffer.length) return undefined;
    offset = name.next + 4;
  }
  for (let index = 0; index < answerCount; index += 1) {
    const name = readName(buffer, offset);
    if (name === undefined || name.next + 10 > buffer.length) return result;
    const type = buffer.readUInt16BE(name.next);
    const ttl = buffer.readUInt32BE(name.next + 4);
    const dataLength = buffer.readUInt16BE(name.next + 8);
    const dataStart = name.next + 10;
    if (dataStart + dataLength > buffer.length) return result;
    if (type === TYPE_A && dataLength === 4) {
      const octets = [...buffer.subarray(dataStart, dataStart + 4)];
      result.aRecords.push({ address: octets.join("."), ttl });
    }
    offset = dataStart + dataLength;
  }
  return result;
}

/**
 * 目的: クエリに対するSERVFAIL応答を組み立てる（上流障害時のフェイルクローズ用）。
 * 入力: query(元のクエリ), question(parseQueryの結果)。
 * 出力: IDと質問を引き継いだSERVFAIL応答。
 */
export function buildServfail(query: Buffer, question: DnsQuestion): Buffer {
  const response = Buffer.alloc(question.questionEnd);
  query.copy(response, 0, 0, question.questionEnd);
  const recursionDesired = query.readUInt16BE(2) & FLAG_RD;
  response.writeUInt16BE(FLAG_QR | recursionDesired | FLAG_RA | RCODE_SERVFAIL, 2);
  response.writeUInt16BE(1, 4);
  response.writeUInt16BE(0, 6);
  response.writeUInt16BE(0, 8);
  response.writeUInt16BE(0, 10);
  return response;
}

/**
 * 目的: UDPで返せる大きさを超える応答を、質問のみ＋TCビット付きに切り詰める（クライアントはTCPで再問い合わせする）。
 * 入力: response(上流の応答), question(元クエリの質問), limit(UDPで返せる最大バイト数)。
 * 出力: limit以下ならそのまま、超えるなら切り詰めた応答。
 */
export function truncateForUdp(response: Buffer, question: DnsQuestion, limit: number): Buffer {
  if (response.length <= limit) return response;
  const truncated = Buffer.from(response.subarray(0, question.questionEnd));
  truncated.writeUInt16BE(truncated.readUInt16BE(2) | FLAG_TC, 2);
  truncated.writeUInt16BE(0, 6);
  truncated.writeUInt16BE(0, 8);
  truncated.writeUInt16BE(0, 10);
  return truncated;
}

/**
 * 目的: クライアントがUDPで受け取れる最大バイト数を見積もる。
 * 入力: question(元クエリの質問)。
 * 出力: EDNS0のOPTレコードがあれば1232、なければ従来の512。
 */
export function udpLimitFor(question: DnsQuestion): number {
  return question.additionalCount > 0 ? 1232 : 512;
}
