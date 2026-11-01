// 責務: 公開 IP の書式の検査（parsePublicIp）の単体テスト。IPv4 以外の本文は拒否する（要件 1.11）。

import { describe, expect, it } from "vitest";
import { parsePublicIp } from "./public-ip";

describe("parsePublicIp", () => {
  it("IPv4 の本文を受け付け、前後の改行を取り除く", () => {
    expect(parsePublicIp("156.146.34.246\n")).toBe("156.146.34.246");
  });

  it.each(["", "<html>error</html>", "2001:db8::1", "256.1.1.1", "1.2.3", "1.2.3.4.5", "1.2.3.4 extra"])(
    "IPv4 以外の本文 %j を拒否する",
    (body) => {
      expect(parsePublicIp(body)).toBeNull();
    },
  );
});
