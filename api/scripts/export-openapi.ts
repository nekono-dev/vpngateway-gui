// 責務: Fastifyアプリをlistenせずに構築し、生成されたOpenAPI仕様をファイルへ書き出す。
// Web側のorvalによるクライアント生成の入力として使用する（webserver/design.md参照）。

import { writeFileSync } from "node:fs";
import { buildApp } from "../src/app.js";

async function main(): Promise<void> {
  const app = buildApp();
  await app.ready();
  writeFileSync("openapi.json", JSON.stringify(app.swagger(), null, 2));
  await app.close();
}

main();
