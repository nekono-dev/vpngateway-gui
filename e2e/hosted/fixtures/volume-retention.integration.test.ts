// 責務: 実 Docker named volume で Compose down の保持・再利用・明示削除を検証する。

import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { composeConfig, composeDown, composeDownVolumes, HOSTED_COMPOSE_FRAGMENTS } from "./compose.js";

const marker = "vpngwgui-volume-retention-marker";
const image = "alpine:3.21";
const volumeKey = "api-data";

function docker(args: readonly string[]): string {
  return execFileSync("docker", [...args], { encoding: "utf8" }).trim();
}

function detectSkipReason(): string | undefined {
  try {
    docker(["info", "--format", "{{.ServerVersion}}"]);
  } catch {
    return "Docker daemon が利用できないため volume retention integration test を skip します";
  }

  const containers = docker(["ps", "-a", "--format", "{{.Names}}"])
    .split("\n")
    .filter((name) => name.startsWith("vpngwgui"));
  const volumes = docker(["volume", "ls", "--format", "{{.Name}}"])
    .split("\n")
    .filter((name) => name.startsWith("vpngwgui"));
  if (containers.length > 0 || volumes.length > 0) {
    return `既存の vpngwgui* 資源があるため volume retention integration test を skip します (containers: ${containers.join(",") || "none"}; volumes: ${volumes.join(",") || "none"})`;
  }

  try {
    docker(["image", "inspect", image, "--format", "{{.Id}}"]);
  } catch {
    return `${image} がローカルにないため pull を避けて volume retention integration test を skip します`;
  }

  return undefined;
}

const skipReason = detectSkipReason();
let volumeName = "";
let created = false;

describe("Compose named volume retention (Docker integration)", () => {
  beforeAll(() => {
    if (skipReason !== undefined) console.warn(skipReason);
  });

  afterAll(() => {
    if (created) {
      try {
        docker(["volume", "rm", volumeName]);
      } catch {
        // 明示 down -v が削除済みの場合は何もしない。
      }
    }
  });

  it.skipIf(skipReason !== undefined)("down は marker を保持し vendor fragment 再選択後も同じ volume を使い、down -v は削除する", () => {
    const initiallySelected = composeConfig(HOSTED_COMPOSE_FRAGMENTS);
    const detached = composeConfig(["docker-compose.e2e-mock.yml"]);
    const reselected = composeConfig(HOSTED_COMPOSE_FRAGMENTS);
    const logicalVolume = initiallySelected.volumes[volumeKey];
    expect(logicalVolume).toBeDefined();
    volumeName = logicalVolume.name;
    expect(detached.volumes[volumeKey].name).toBe(volumeName);
    expect(reselected.volumes[volumeKey].name).toBe(volumeName);
    expect(initiallySelected.services.api.volumes?.some((volume) => volume.source === volumeKey)).toBe(true);

    try {
      docker([
        "volume", "create",
        "--label", "com.docker.compose.project=vpngwgui",
        "--label", `com.docker.compose.volume=${volumeKey}`,
        volumeName,
      ]);
      created = true;
      docker(["run", "--rm", "-v", `${volumeName}:/data`, image, "sh", "-c", `printf '%s' '${marker}' > /data/marker`]);

      composeDown(HOSTED_COMPOSE_FRAGMENTS);
      expect(docker(["run", "--rm", "-v", `${volumeName}:/data:ro`, image, "cat", "/data/marker"])).toBe(marker);

      const afterReselection = composeConfig(HOSTED_COMPOSE_FRAGMENTS);
      expect(afterReselection.services.api.volumes?.some((volume) => volume.source === volumeKey)).toBe(true);
      expect(afterReselection.volumes[volumeKey].name).toBe(volumeName);
      expect(docker(["run", "--rm", "-v", `${afterReselection.volumes[volumeKey].name}:/data:ro`, image, "cat", "/data/marker"])).toBe(marker);

      composeDownVolumes(HOSTED_COMPOSE_FRAGMENTS);
      expect(() => docker(["volume", "inspect", volumeName])).toThrow();
      created = false;
    } finally {
      if (created) {
        try {
          docker(["volume", "rm", volumeName]);
        } finally {
          created = false;
        }
      }
    }
  }, 30_000);
});
