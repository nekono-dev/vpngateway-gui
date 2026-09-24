// 責務: DNS中継の単体テスト用に、DNSクエリ・応答のバイト列を組み立てる補助関数（本番コードからは使わない）。

export function encodeName(name: string): Buffer {
  const parts = name.split(".").map((label) => Buffer.concat([Buffer.from([label.length]), Buffer.from(label)]));
  return Buffer.concat([...parts, Buffer.from([0])]);
}

export function buildQuery(name: string, id = 0x1234, additional = 0): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  header.writeUInt16BE(0x0100, 2);
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(additional, 10);
  const tail = Buffer.alloc(4);
  tail.writeUInt16BE(1, 0);
  tail.writeUInt16BE(1, 2);
  return Buffer.concat([header, encodeName(name), tail]);
}

/** 質問1件＋Aレコード（圧縮ポインタで名前を参照）を持つ応答を組み立てる。 */
export function buildAnswer(name: string, records: { address: string; ttl: number }[], rcode = 0, id = 0x1234): Buffer {
  const response = Buffer.from(buildQuery(name, id));
  response.writeUInt16BE(0x8180 | rcode, 2);
  response.writeUInt16BE(records.length, 6);
  const answers = records.map((record) => {
    const rr = Buffer.alloc(16);
    rr.writeUInt16BE(0xc00c, 0);
    rr.writeUInt16BE(1, 2);
    rr.writeUInt16BE(1, 4);
    rr.writeUInt32BE(record.ttl, 6);
    rr.writeUInt16BE(4, 10);
    Buffer.from(record.address.split(".").map(Number)).copy(rr, 12);
    return rr;
  });
  return Buffer.concat([response, ...answers]);
}
