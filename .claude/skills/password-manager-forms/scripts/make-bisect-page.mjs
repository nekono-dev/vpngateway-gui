#!/usr/bin/env node
// 責務: パスワードマネージャ（Proton Pass）の挙動を切り分けるための並置テストページを生成する。
// 使い方: node make-bisect-page.mjs [出力先]（既定: ./pw-test.html）。生成したファイルを、静的に配信される場所（例: Viteの`public/`）へ置いて検証環境へ反映し、
// 利用者に各ブロックの「ユーザー名」欄で候補を選んでもらい、ブロックごとに結果（両方入った／ユーザー名だけ／どちらも入らない）を聞く。
// 切り分け後は必ず削除する（コミットしない）。ブロックはVARIANTSを編集して増やす（1回に1要因だけ変える）。
import { writeFileSync } from "node:fs";

const out = process.argv[2] ?? "pw-test.html";

const USER = '<label>ユーザー名<input type="text" name="username" autocomplete="username"></label>';
const PASS = '<label>パスワード<input type="password" name="password" autocomplete="current-password"></label>';
const OTP = (extra = "") => `<label>2段階認証<input type="text" name="twoFactorCode" inputmode="numeric" autocomplete="off"${extra}></label>`;
const BTN = "<button>ログイン</button>";

// [ID, 説明, HTML]。基準Aが「両方入る」ことを最初に確認する。
const VARIANTS = [
  ["A", "基準: ユーザー名＋パスワード＋ボタンのみ", `<form onsubmit="return false">${USER}${PASS}${BTN}</form>`],
  ["B", "A＋2段階認証欄を同じformに最初から置く（autocomplete=one-time-code）", `<form onsubmit="return false">${USER}${PASS}${OTP().replace('autocomplete="off"', 'autocomplete="one-time-code"')}${BTN}</form>`],
  ["C", "A＋2段階認証欄を同じformに最初から置く（autocomplete=off）", `<form onsubmit="return false">${USER}${PASS}${OTP()}${BTN}</form>`],
  [
    "E",
    "Aと同じ。「2段階認証を使う」ボタンで欄を後から同じformへ追加する（アプリが採用した構成）",
    `<form onsubmit="return false">${USER}${PASS}<div class="slot"></div><button type="button" onclick="this.previousElementSibling.innerHTML=this.dataset.otp;this.hidden=true" data-otp='${OTP().replace(/'/g, "&#39;")}'>2段階認証を使う</button> ${BTN}</form>`,
  ],
  [
    "F",
    "form内はユーザー名とパスワードのみ。2段階認証欄はform外に置きform属性で関連づけ（静的では通るが、アプリ内では通らなかった）",
    `<form id="ff" onsubmit="return false">${USER}${PASS}${BTN}</form>${OTP(' form="ff"')}`,
  ],
  ["D", "ボタンを押すとAと同じフォームを動的に追加（読み込み後の追加でも検出されるかの確認）", `<button onclick="var f=document.createElement('form');f.onsubmit=function(){return false};f.innerHTML=this.dataset.html;this.after(f);this.hidden=true" data-html='${(USER + PASS + BTN).replace(/'/g, "&#39;")}'>フォームを開く</button>`],
];

const blocks = VARIANTS.map(([id, desc, html]) => `<div class="box"><b>${id}: ${desc}</b>${html}</div>`).join("\n");
writeFileSync(
  out,
  `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>pw-test</title>
<style>body{font:14px sans-serif;margin:16px;max-width:520px}.box{border:1px solid #888;padding:8px;margin:12px 0}form{margin:8px 0}label{display:block;margin:4px 0}input{width:100%;box-sizing:border-box;padding:6px}</style></head>
<body>
<h3>パスワードマネージャの入力検証（各ブロックのユーザー名欄で候補を選び、ユーザー名とパスワードが両方入るかを見る）</h3>
${blocks}
</body></html>
`,
);
console.log(`生成しました: ${out}（${VARIANTS.length}ブロック）。検証後は削除してください。`);
