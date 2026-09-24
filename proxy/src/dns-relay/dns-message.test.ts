// 責務: DNSメッセージの解析・組み立て（dns-message.ts）の単体テスト。

import { describe, expect, it } from "vitest";
import { buildPtrQuery, buildServfail, parseAnswer, parseQuery, truncateForUdp, udpLimitFor } from "./dns-message.js";
import { buildAnswer, buildQuery } from "./test-helpers.js";

describe("parseQuery", () => {
  it("名前を小文字で取り出す", () => {
    const question = parseQuery(buildQuery("WWW.Example.com"));
    expect(question?.name).toBe("www.example.com");
    expect(question?.type).toBe(1);
    expect(question?.id).toBe(0x1234);
  });

  it("短すぎる・応答（QR=1）・質問なしはundefined", () => {
    expect(parseQuery(Buffer.alloc(5))).toBeUndefined();
    expect(parseQuery(buildAnswer("a.example.com", []))).toBeUndefined();
    const noQuestion = Buffer.alloc(12);
    expect(parseQuery(noQuestion)).toBeUndefined();
  });

  it("圧縮ポインタのループ・範囲外はundefined（無限ループしない）", () => {
    const loop = Buffer.alloc(16);
    loop.writeUInt16BE(1, 4);
    loop[12] = 0xc0;
    loop[13] = 12;
    expect(parseQuery(loop)).toBeUndefined();
  });
});

describe("parseAnswer", () => {
  it("Aレコードのアドレスとキャッシュ期限を取り出す", () => {
    const answer = parseAnswer(
      buildAnswer("a.example.com", [
        { address: "192.0.2.1", ttl: 60 },
        { address: "192.0.2.2", ttl: 300 },
      ]),
    );
    expect(answer?.rcode).toBe(0);
    expect(answer?.aRecords).toEqual([
      { address: "192.0.2.1", ttl: 60 },
      { address: "192.0.2.2", ttl: 300 },
    ]);
  });

  it("RCODEを返し、Aレコードが無ければ空", () => {
    const answer = parseAnswer(buildAnswer("a.example.com", [], 3));
    expect(answer).toEqual({ rcode: 3, truncated: false, aRecords: [], ptrNames: [] });
  });

  it("応答が途中で壊れていても、読めた分を返す", () => {
    const full = buildAnswer("a.example.com", [
      { address: "192.0.2.1", ttl: 60 },
      { address: "192.0.2.2", ttl: 60 },
    ]);
    const answer = parseAnswer(full.subarray(0, full.length - 5));
    expect(answer?.aRecords).toEqual([{ address: "192.0.2.1", ttl: 60 }]);
  });
});

describe("buildServfail", () => {
  it("IDと質問を引き継いだSERVFAIL（RCODE=2）を返す", () => {
    const query = buildQuery("a.example.com", 0xabcd);
    const question = parseQuery(query)!;
    const response = buildServfail(query, question);
    expect(response.readUInt16BE(0)).toBe(0xabcd);
    expect(response.readUInt16BE(2) & 0x800f).toBe(0x8002);
    expect(parseAnswer(response)).toEqual({ rcode: 2, truncated: false, aRecords: [], ptrNames: [] });
  });
});

describe("truncateForUdp / udpLimitFor", () => {
  it("上限以下ならそのまま、超えるならTCビット付きの質問のみにする", () => {
    const query = buildQuery("a.example.com");
    const question = parseQuery(query)!;
    const response = buildAnswer("a.example.com", [{ address: "192.0.2.1", ttl: 60 }]);
    expect(truncateForUdp(response, question, 1000)).toBe(response);
    const truncated = truncateForUdp(response, question, 20);
    expect(truncated.length).toBe(question.questionEnd);
    expect(parseAnswer(truncated)?.truncated).toBe(true);
  });

  it("EDNS0のOPTがあれば1232、なければ512", () => {
    expect(udpLimitFor(parseQuery(buildQuery("a.example.com", 1, 1))!)).toBe(1232);
    expect(udpLimitFor(parseQuery(buildQuery("a.example.com"))!)).toBe(512);
  });
});

describe("buildPtrQuery / PTR応答の解析", () => {
  it("IPv4アドレスから逆引き（in-addr.arpa）のPTRクエリを作る", () => {
    const query = buildPtrQuery("192.168.3.121", 7)!;
    const question = parseQuery(query)!;
    expect(question.name).toBe("121.3.168.192.in-addr.arpa");
    expect(question.type).toBe(12);
    expect(question.id).toBe(7);
  });

  it("不正なアドレスはundefined", () => {
    expect(buildPtrQuery("999.1.1.1", 1)).toBeUndefined();
    expect(buildPtrQuery("a.b.c.d", 1)).toBeUndefined();
    expect(buildPtrQuery("1.2.3", 1)).toBeUndefined();
  });

  it("PTRレコードの名前を小文字で取り出す（圧縮された名前を含む）", () => {
    const query = buildPtrQuery("192.168.3.121", 7)!;
    const response = Buffer.from(query);
    response.writeUInt16BE(0x8180, 2);
    response.writeUInt16BE(1, 6);
    const name = Buffer.from([7, ...Buffer.from("Macmini"), 3, ...Buffer.from("lan"), 0]);
    const record = Buffer.concat([Buffer.from([0xc0, 0x0c, 0, 12, 0, 1, 0, 0, 0, 60, 0, name.length]), name]);
    expect(parseAnswer(Buffer.concat([response, record]))?.ptrNames).toEqual(["macmini.lan"]);
  });
});
