#!/usr/bin/env node
// 責務: JSX/TSX（`*.tsx`、テストを除く）を走査し、Proton Pass等のパスワードマネージャが反応しなくなる既知の落とし穴を指摘する。
// 実機検証で確定した事実（SKILL.mdの「疑うポイント」）のうち、静的に検出できるものだけを見る。依存パッケージなし。
// 使い方: node audit-forms.mjs [ファイルまたはディレクトリ...]（省略時はsrc）。ERRORがあれば終了コード1。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const roots = process.argv.slice(2);
if (roots.length === 0) roots.push("src");

function collect(path, out) {
  const st = statSync(path);
  if (st.isDirectory()) {
    for (const name of readdirSync(path)) {
      if (["node_modules", "dist", "build", ".git"].includes(name)) continue;
      collect(join(path, name), out);
    }
  } else if (/\.tsx$/.test(path) && !/\.test\.tsx$/.test(path)) {
    out.push(path);
  }
  return out;
}

// JSXの開始タグ（`<input ...>`）を、属性内の`>`（アロー関数）を考慮して切り出す。
function tags(source, name) {
  const found = [];
  const re = new RegExp(`<${name}(?=[\\s/>])`, "g");
  let m;
  while ((m = re.exec(source)) !== null) {
    let depth = 0;
    let i = m.index + m[0].length;
    for (; i < source.length; i++) {
      const c = source[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0 && source[i - 1] !== "=") break;
    }
    found.push({ text: source.slice(m.index, i + 1), index: m.index });
  }
  return found;
}

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}=(?:"([^"]*)"|\\{([^}]*)\\})`));
  return m ? (m[1] ?? m[2]) : undefined;
};
const hasFlag = (tag, name) => new RegExp(`\\b${name}(?=[\\s/>=])`).test(tag);
const lineOf = (source, index) => source.slice(0, index).split("\n").length;

const findings = [];
const add = (level, file, source, index, message) => findings.push({ level, file, line: lineOf(source, index), message });

for (const file of roots.flatMap((r) => collect(r, []))) {
  // コメント（行コメント・ブロックコメント）は、位置を保ったまま空白に置き換えて、コメント内のタグを数えない。
  const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g, (m, lead) => (lead ?? "") + m.slice((lead ?? "").length).replace(/[^\n]/g, " "));
  const rel = relative(process.cwd(), file);
  const inputs = tags(source, "input");
  const credentialInputs = inputs.filter((t) => {
    const type = attr(t.text, "type");
    const name = attr(t.text, "name") ?? "";
    return type === "password" || /^(username|password|current-password|new-password)/.test(name);
  });
  const hasPassword = inputs.some((t) => attr(t.text, "type") === "password");

  // 1. autocomplete: offまたは無指定は種別を判定できない。
  for (const t of credentialInputs) {
    const ac = attr(t.text, "autoComplete");
    if (ac === undefined) add("ERROR", rel, source, t.index, "資格情報の入力欄にautoCompleteが無い（username / current-password / new-passwordを指定する）");
    else if (ac === "off") add("ERROR", rel, source, t.index, 'autoComplete="off"ではPassがフォーム種別を判定できず反応しない');
  }

  // 5. 非表示のユーザー名欄は検出されない。
  for (const t of inputs) {
    if (attr(t.text, "autoComplete") !== "username") continue;
    if (hasFlag(t.text, "readOnly") || hasFlag(t.text, "hidden") || /aria-hidden|visually-?hidden|opacity|display:\s*none|tabIndex=\{-1\}/i.test(t.text)) {
      add("ERROR", rel, source, t.index, "非表示・readOnlyのユーザー名欄は検出されない（可視のtext欄にする）");
    }
  }

  // 7. 同じ<form>にパスワード欄と2段階認証（OTP）欄がある。
  for (const f of tags(source, "form")) {
    const end = source.indexOf("</form>", f.index);
    const body = source.slice(f.index, end === -1 ? undefined : end);
    const formInputs = tags(body, "input");
    const pw = formInputs.some((t) => attr(t.text, "type") === "password");
    const otp = formInputs.find((t) => /twoFactor|totp|otp|mfa|2fa/i.test(attr(t.text, "name") ?? "") || attr(t.text, "autoComplete") === "one-time-code");
    // 2段階認証欄が条件付き描画（`{show ? (<label>...` / `{show && (<label>...`）なら、最初は同居しないので許容する。
    const labelStart = otp ? body.lastIndexOf("<label", body.indexOf(otp.text)) : -1;
    const isConditional = labelStart > 0 && /(\?|&&)\s*\(\s*$/.test(body.slice(Math.max(0, labelStart - 40), labelStart));
    if (pw && otp && !isConditional) {
      add("ERROR", rel, source, f.index + body.indexOf(otp.text), "同じ<form>にパスワード欄と2段階認証欄があるとPassが反応しない（2段階認証欄はボタンで後から追加する。LoginForm.template.tsx参照）");
    }
    // 4. 変更フォームの別ユーザー名欄。
    const hasNewPassword = formInputs.some((t) => attr(t.text, "autoComplete") === "new-password");
    if (hasNewPassword) {
      for (const t of formInputs) {
        if (attr(t.text, "type") !== "password" && attr(t.text, "autoComplete") !== "username" && /user|account|login|name/i.test(attr(t.text, "name") ?? "")) {
          add("ERROR", rel, source, f.index + body.indexOf(t.text), "new-passwordを持つフォームに別のtext欄（新しいユーザー名など）があると、現在のパスワード欄へ新パスワードが入る。username欄の書き換えで変更する");
        }
      }
      if (!formInputs.some((t) => attr(t.text, "autoComplete") === "username")) {
        add("WARN", rel, source, f.index, "new-passwordを持つフォームに可視のusername欄が無い");
      }
    }
    // 7b. form属性・フォーム外のボタンでの関連づけ。
    if (formInputs.some((t) => hasFlag(t.text, "form")) || tags(source, "button").some((t) => /\bform=/.test(t.text))) {
      add("WARN", rel, source, f.index, "form属性で<form>外の要素を関連づけている。静的ページでは通ってもアプリ内でPassが<main>全体をフォーム扱いした実績がある");
    }
  }
  // <form>の外にform属性付きの資格情報関連の欄がある場合も拾う。
  for (const t of inputs) {
    if (hasFlag(t.text, "form") && /\bform=\{/.test(t.text) && hasPassword) add("WARN", rel, source, t.index, "form属性で別の<form>へ関連づけた入力欄（上記7bと同様）");
  }

  // 6. 確認欄と誤判定されるラベル。
  if (hasPassword) {
    const re = /<label[^>]*>\s*([^<{]*(?:確認|再入力)[^<{]*)/g;
    let m;
    while ((m = re.exec(source)) !== null) add("WARN", rel, source, m.index, `ラベル「${m[1].trim()}」は確認欄と誤判定されうる`);
  }

  // 2/3. パスワード欄を含むダイアログ。
  for (const d of tags(source, "dialog")) {
    const end = source.indexOf("</dialog>", d.index);
    const body = source.slice(d.index, end === -1 ? undefined : end);
    const holdsCredential = /type="password"/.test(body) || /<\w*(Account|Password|Login|SignIn|Credential)\w*Form\b/.test(body) || (hasPassword && /type="password"/.test(source));
    if (!holdsCredential) continue;
    // モーダル（showModal）か。直接の呼び出しは誤り。共通フックで開く実装は、第2引数false等の非モーダル指定が見えなければ確認を促す。
    if (/\.showModal\s*\(/.test(source) && !/\.show\s*\(/.test(source)) {
      add("ERROR", rel, source, d.index, "パスワード欄を含むダイアログがモーダル（showModal）。トップレイヤーが拡張機能の候補表示を隠す（dialog.show()で開く）");
    } else if (!/\.show\s*\(|use\w*Dialog\w*\([^)]*,\s*false|modal=\{false\}/.test(source)) {
      add("WARN", rel, source, d.index, "ダイアログの開き方（モーダルか）をこのファイルから判定できない。パスワード欄を持つなら非モーダル（show()）で開くこと");
    }
    if (!/open\s*(\?|&&)/.test(body) && !/!open\s*\?/.test(body)) {
      add("ERROR", rel, source, d.index, "閉じている間もフォームを描画している。閉じた<dialog>内のフォームは再検出されない（{open ? <Form /> : null}）");
    }
  }
}

if (findings.length === 0) {
  console.log("指摘なし");
} else {
  for (const f of findings) console.log(`${f.level} ${f.file}:${f.line} ${f.message}`);
  console.log(`\nERROR ${findings.filter((f) => f.level === "ERROR").length}件 / WARN ${findings.filter((f) => f.level === "WARN").length}件`);
}
process.exit(findings.some((f) => f.level === "ERROR") ? 1 : 0);
