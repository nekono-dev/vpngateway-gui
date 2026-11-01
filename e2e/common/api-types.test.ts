// 責務: 共有の API 応答の型（api-types.ts）が、api/openapi.json の応答スキーマと一致することを確かめる（要件 1.1 の契約）。
// 前提: `npm run export-openapi -w api` で api/openapi.json を生成しておく（生成物は git の対象外）。

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONTRACT_FIELDS } from "./api-types";

interface OpenApiDoc {
  paths: Record<string, Record<string, { responses: Record<string, { content?: { "application/json"?: { schema?: { properties?: Record<string, unknown> } } } }> }>>;
}

const doc = JSON.parse(readFileSync(join(process.cwd(), "api/openapi.json"), "utf8")) as OpenApiDoc;

describe("api-types と openapi.json の一致", () => {
  it.each(CONTRACT_FIELDS)("$method $path（$status）の応答に、型の項目が全て存在する", (field) => {
    const operation = doc.paths[field.path]?.[field.method];
    expect(operation, `経路が openapi に無い: ${field.method} ${field.path}`).toBeDefined();
    const schema = operation?.responses[field.status]?.content?.["application/json"]?.schema;
    expect(schema?.properties, `応答スキーマが無い: ${field.status}`).toBeDefined();
    for (const key of field.keys) {
      expect(Object.keys(schema?.properties ?? {})).toContain(key);
    }
  });
});
