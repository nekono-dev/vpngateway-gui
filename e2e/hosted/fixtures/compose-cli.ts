// 責務: hosted provision から Compose fixture の lifecycle を実行する CLI を提供する。

import { composeDown, composeDownVolumes, composeUp, HOSTED_COMPOSE_FRAGMENTS, validateComposeConfig } from "./compose.js";

const [action, ...requestedFragments] = process.argv.slice(2);
const fragments = requestedFragments.length > 0 ? requestedFragments : [...HOSTED_COMPOSE_FRAGMENTS];

switch (action) {
  case "config":
    validateComposeConfig(fragments);
    break;
  case "up":
    composeUp(fragments);
    break;
  case "down":
    composeDown(fragments);
    break;
  case "down-volumes":
    composeDownVolumes(fragments);
    break;
  default:
    throw new Error("usage: compose-cli.ts config|up|down|down-volumes [compose-fragment ...]");
}
