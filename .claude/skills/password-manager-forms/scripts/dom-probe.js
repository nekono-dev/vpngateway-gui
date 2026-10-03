// 責務: 利用者のブラウザの開発者ツール（コンソール）に貼り付けて、フォームの実状態を取得する。
// ファイル全体は貼らない。「1.」〜「4.」の該当する1つのブロック（1行の式）だけを貼り、出力を貼り返してもらう。
// 値（パスワード等）は出力しない。文字数だけを出す。

// ---- 1. 入力欄の一覧（フォームを開いた状態で、入力欄は未クリックのまま実行する） ----
console.log(JSON.stringify([...document.querySelectorAll('input,textarea,select')].map(e=>({tag:e.tagName,type:e.type,name:e.name,ac:e.autocomplete,form:e.form?.id||e.form?.className||null,dlg:!!e.closest('dialog'),vis:e.offsetWidth+'x'+e.offsetHeight})),null,1))

// ---- 2. 対象フォームの祖先と、Passが付けた印（data-protonpass-form）を見る。クラス名`.login-form`は対象に合わせて変える ----
(()=>{const f=document.querySelector('.login-form');const c=[];for(let e=f;e&&e!==document.documentElement;e=e.parentElement)c.push(e.tagName+(e.id?'#'+e.id:'')+(e.className?'.'+String(e.className).replace(/ /g,'.'):'')+[...e.attributes].filter(a=>!['id','class'].includes(a.name)).map(a=>'['+a.name+'='+a.value+']').join(''));console.log('祖先: '+c.join(' < '));console.log(f.parentElement.outerHTML)})()

// ---- 3. 自動入力の記録（実行後に、ユーザー名欄で候補を選び、出た行を全部貼り返してもらう）。
//         パスワード欄にイベントが1つも出なければ、Passはパスワードを入力しようとしていない（フォーム分類の問題） ----
(()=>{const f=document.querySelector('.login-form');const u=f.querySelector('input[name=username]'),p=f.querySelector('input[name=password]');['focus','blur','input','change','keydown','keyup'].forEach(t=>{u.addEventListener(t,e=>console.log('USER',t,'trusted='+e.isTrusted,'len='+u.value.length));p.addEventListener(t,e=>console.log('PASS',t,'trusted='+e.isTrusted,'len='+p.value.length))});new MutationObserver(m=>console.log('DOM変化',m.map(x=>x.type+':'+x.target.nodeName+(x.attributeName?'.'+x.attributeName:'')).join(',')+' pass接続中='+p.isConnected+' user接続中='+u.isConnected)).observe(document.body,{subtree:true,childList:true,attributes:true});console.log('記録を開始しました')})()

// ---- 4. フォームを写す（元のフォームの下と、ページ先頭に静的な複製を置く）。複製の結果は、毎回再読み込みした直後に試す ----
(()=>{const f=document.querySelector('.login-form');const mk=t=>{const d=document.createElement('div');d.innerHTML='<b style="display:block;margin-top:12px">'+t+'</b>'+f.outerHTML;return d};f.after(mk('複製X: 元のフォームのすぐ下（祖先は同じ）'));document.body.prepend(mk('複製Y: ページの先頭（祖先なし）'));window.scrollTo(0,0)})()
