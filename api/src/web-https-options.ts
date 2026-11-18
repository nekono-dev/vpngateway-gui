// 責務: API の Cookie Secure に使う Web HTTPS フラグを厳密に解釈する。

/** Web と同じ規則で HTTPS フラグを読み、不正値では起動を拒否する。 */
export function parseWebHttpsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const enabled = env.WEB_HTTPS_ENABLED;
  if (enabled === undefined || enabled === "false") return false;
  if (enabled === "true") return true;
  throw new Error('WEB_HTTPS_ENABLED は "true" または "false" のみ指定できます');
}
