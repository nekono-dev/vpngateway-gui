// 責務: ベンダーバンドル（`vendors/<ID>/`）の構成・権限・永続化・実行環境を検査する受け入れテスト。
// 受け入れ条件 runner/AC-7〜AC-9・AC-11・AC-12・AC-15 を、全ベンダーに同じ基準で確認する。

import { describe, expect, it } from "vitest";
import { listVendorIds, readRepoFile, repoFileExists } from "../helpers/repo.js";

const vendorIds = listVendorIds();

/** 目的: プロファイルの全アクションのargv要素を平坦化して返す。 */
function allArgvTokens(vendorId: string): string[] {
  const profile = JSON.parse(readRepoFile(`vendors/${vendorId}/profile.json`)) as {
    actions: Record<string, { argv?: string[] }>;
  };
  return Object.values(profile.actions).flatMap((action) => action.argv ?? []);
}

describe("ベンダーバンドル", () => {
  it("少なくとも1つのベンダーバンドルが存在する", () => {
    expect(vendorIds.length).toBeGreaterThan(0);
  });

  it("runner/AC-7: 全ベンダーのランナー定義が、ログイン情報の保存先に名前付きボリュームを割り当てる", () => {
    for (const id of vendorIds) {
      const compose = readRepoFile(`vendors/${id}/compose.yml`);
      // `<ボリューム名>:/home/vpngwgui/...` の形で、ソケット共有以外の名前付きボリュームをホームへ割り当てる。
      expect(compose, id).toMatch(/- (?!ctl-socket)[a-z][a-z0-9-]*:\/home\/vpngwgui\//);
      // トップレベルの volumes に、割り当てたボリュームが宣言されている。
      expect(compose, id).toMatch(/^volumes:\n(?:  [a-z0-9-]+: \{\}\n?)+/m);
    }
  });

  it("runner/AC-8: 全ベンダーのランナー定義が、ホストのネットワーク名前空間とトンネル用の権限を指定する", () => {
    for (const id of vendorIds) {
      const compose = readRepoFile(`vendors/${id}/compose.yml`);
      expect(compose, id).toMatch(/^\s+network_mode: host$/m);
      expect(compose, id).toMatch(/^\s+- NET_ADMIN$/m);
    }
  });

  it("runner/AC-9: 全ベンダーのプロファイルが、CLI独自のKill Switchを操作するコマンドを持たない", () => {
    for (const id of vendorIds) {
      const offending = allArgvTokens(id).filter((token) => /kill[-_]?switch/i.test(token));
      expect(offending, id).toEqual([]);
    }
  });

  it("runner/AC-11: 全ベンダーのバンドルが、必須の構成要素をそろえている", () => {
    for (const id of vendorIds) {
      expect(id, id).toMatch(/^[a-z][a-z0-9]{0,31}$/);
      for (const file of ["profile.json", "compose.yml", "Dockerfile"]) {
        expect(repoFileExists(`vendors/${id}/${file}`), `${id}/${file}`).toBe(true);
      }
      const profile = JSON.parse(readRepoFile(`vendors/${id}/profile.json`)) as { vendor: string };
      expect(profile.vendor, id).toBe(id);
      const compose = readRepoFile(`vendors/${id}/compose.yml`);
      expect(compose, id).toContain(`runner-${id}:`);
      expect(compose, id).toContain(`dockerfile: vendors/${id}/Dockerfile`);
      expect(compose, id).not.toMatch(/^\s+profiles:/m);
    }
  });

  it("runner/AC-12: 特殊な実行環境を要するベンダーの実行環境が、ランナーのイメージ内に導入され、ホストの資源を共有しない", () => {
    const dockerfile = readRepoFile("vendors/protonvpn/Dockerfile");
    const entrypoint = readRepoFile("vendors/protonvpn/entrypoint.sh");
    const compose = readRepoFile("vendors/protonvpn/compose.yml");
    // CLI（NetworkManager・keyringを依存に持つ）と、D-Busがイメージに導入される。
    expect(dockerfile).toContain("proton-vpn-cli");
    expect(dockerfile).toContain("dbus");
    // 常駐サービスをコンテナ内のエントリポイントが起動する。
    for (const command of ["dbus-daemon --system", "NetworkManager --no-daemon", "gnome-keyring-daemon"]) {
      expect(entrypoint, command).toContain(command);
    }
    // ホストのD-Busを共有せず、ホスト側の導入手順も持たない。
    expect(compose).not.toMatch(/\/(?:var\/)?run\/dbus/);
    expect(repoFileExists("vendors/protonvpn/install-host.sh")).toBe(false);
  });

  it("runner/AC-15: 全ベンダーのランナー定義が、特権モードを指定せず、ランナー本体を非rootへ切り替える", () => {
    for (const id of vendorIds) {
      const compose = readRepoFile(`vendors/${id}/compose.yml`);
      expect(compose, id).not.toMatch(/^\s+privileged:\s*true/m);
      // 非rootで直接起動するか、エントリポイントがrootから非root（UID 10001）へ降格する。
      const runsAsNonRoot = /^\s+user: "10001:10001"$/m.test(compose);
      const entrypointPath = `vendors/${id}/entrypoint.sh`;
      const dropsPrivileges =
        repoFileExists(entrypointPath) &&
        /setpriv --reuid=/.test(readRepoFile(entrypointPath)) &&
        /useradd[^\n]*-u 10001/.test(readRepoFile(`vendors/${id}/Dockerfile`).replace(/\\\n/g, " "));
      expect(runsAsNonRoot || dropsPrivileges, id).toBe(true);
    }
  });
});
