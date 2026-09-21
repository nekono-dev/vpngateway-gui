import { describe, expect, it } from "vitest";
import { redactSecrets } from "./redact.js";

describe("redactSecrets", () => {
  it("出力に現れた秘密を全て伏字にする", () => {
    expect(redactSecrets("bad password: hunter2 (hunter2)", ["hunter2"])).toBe("bad password: *** (***)");
  });

  it("複数の秘密を伏字にする", () => {
    expect(redactSecrets("pw=abc code=123456", ["abc", "123456"])).toBe("pw=*** code=***");
  });

  it("空文字列の秘密は無視する（全文字の間に挿入されない）", () => {
    expect(redactSecrets("hello", [""])).toBe("hello");
  });

  it("一致しなければそのまま返す", () => {
    expect(redactSecrets("nothing here", ["secret"])).toBe("nothing here");
  });

  it("正規表現の特殊文字を含む秘密も文字列として扱う", () => {
    expect(redactSecrets("pw=a.b*c", ["a.b*c"])).toBe("pw=***");
  });
});
