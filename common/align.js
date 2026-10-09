// 現場 AR 位置合わせ：ページの中身と動き（全フォルダ共通）。
// 各フォルダの index.html はこれを読むだけ。フォルダには config.json・model.glb・plan.png を置く。
// ★ここを直すと、すべてのフォルダのページに効く。
//
// three.js は jsDelivr の +esm で読む（import map が要らないので、各フォルダの index.html を短くできる）。
// GLTFLoader の +esm は three を同じ URL で読むので、THREE は 1 つにそろう
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/+esm';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/GLTFLoader.js/+esm';
// meshopt で詰めた GLB（tools/compress.mjs）を戻す。詰めていない GLB はそのまま読める
import { MeshoptDecoder } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/meshopt_decoder.module.js/+esm';

// ---------- 画面の部品 ----------
document.body.insertAdjacentHTML('afterbegin', `
<div class="page">
  <h1 id="title">現場 AR 位置合わせ</h1>
  <div class="muted" id="coords"></div>

  <div class="card" id="pwcard" hidden>
    <h2>パスワード</h2>
    <form id="pwform">
      <input type="password" id="pw" autocomplete="current-password" placeholder="パスワードを入れて「開く」">
      <button class="start" id="pwok" type="submit">開く</button>
    </form>
    <div id="pwmsg"></div>
  </div>

  <div class="card simpleonly" hidden>
    <h2>使い方</h2>
    <ol>
      <li>下の地図で、<b>AR を始める場所</b>（いま立っている所のあたり）をタップしてから「AR を始める」</li>
      <li>地面を映してスマホをゆっくり動かす。十字が地面に張り付くと、選んだ場所が十字の所に来るように点群とモデルが出る。
        <b>1 本指でなぞる</b>＝点群を動かす・<b>2 本指でひねる</b>＝回す</li>
      <li>「<b>P1 を選ぶ</b>」が黄色の枠のときに点群をタップすると、そこが P1（青い旗）になる。
        十字を現地の同じ場所に当てて「① P1 をここ」</li>
      <li>「<b>P2 を選ぶ</b>」に切り替わるので、P1 から離れた所をタップして P2（橙の旗）。十字を現地の同じ場所に当てて「② P2 をここ」</li>
      <li>合ったら「固定する」。選び直すときは「P1 を選ぶ」か「P2 を選ぶ」を押してから点群をタップし、① か ② を押し直す</li>
    </ol>
  </div>

  <div class="card" id="startcard" hidden>
    <h2>AR を始める場所</h2>
    <p class="muted fullonly">基準点を前もって持たない現場です。地図で<b>始める場所</b>（いま立っている所のあたり）をタップすると、
      そこが仮の点 <b>S</b> になります。AR で十字を足もとに当てて「◎ S をここへ」→「点群の点を拾う」で現地で分かる所（白線の角など）を拾うと
      Q1 が固定点になるので、十字を現地の Q1 に当てて「◎ Q1 をここへ」。もう 1 点拾って（Q2）十字を当てて「→ Q2 へ向ける」。
      拾った点はこのスマホに覚えるので、次からは S を使わずに Q で合わせられます。</p>
    <div id="pickview"></div>
    <div id="pickinfo" class="muted">点群を読んでいます…（1 本指で動かす・2 本指で拡大）</div>
  </div>

  <div class="card fullonly">
    <h2>使い方</h2>
    <ol>
      <li>「AR を始める」→ 地面を映してスマホをゆっくり動かす（十字が地面に張り付くまで）</li>
      <li><b>位置合わせモード</b>で始まる（橙の表示）。◀ ▶ で<b>固定する点</b>（青）と<b>向ける点</b>（橙）を選ぶ</li>
      <li>十字を<b>固定する点の印</b>に合わせて「◎ ここへ」</li>
      <li>十字を<b>向ける点の印</b>に合わせて「→ 向ける」。固定した点を中心にモデルが回る</li>
      <li>基準点が 3 点以上あるときは、向ける点を替えて十字を当て「＋ 足す」。
        <b>記録した全部の点で</b>いちばん合う位置に置き直し、点ごとのずれが出る。「近い点」で十字に近い点を選べる</li>
      <li>画面を指でなぞる・ひねると、固定した点を中心に回る</li>
      <li>合ったら「固定する」（緑の表示）。固定中は画面に触ってもモデルは動かない。直すときは「位置合わせ」</li>
      <li class="cloudonly"><b>点群</b>があるときは、モデルと一緒に点群も出る。十字の下に「点群まで ◯ cm」が出て、
        20 cm を超えると赤になる（基準点を合わせ直す目安）。
        「点群の点を拾う」→ 画面で点群の目印（白線の角など）をタップすると、その点が新しい基準点（Q1, Q2 …）になる。
        十字を現実の同じ場所へ当てて「→ 向ける」か「＋ 足す」</li>
    </ol>
  </div>

  <div class="card fullonly">
    <h2>基準点</h2>
    <table id="points"><thead><tr><th>点</th><th>X</th><th>Y</th><th>標高</th><th>目印</th><th></th></tr></thead><tbody></tbody></table>
    <p class="muted" id="qnote" hidden>Q で始まる点は、このスマホで点群から拾って覚えている点です。
      <button id="qclear" type="button">拾った点を消す</button></p>
  </div>

  <div class="card" id="plancard">
    <h2>平面図</h2>
    <img class="plan" id="plan" alt="基準点とモデルの位置関係の平面図">
  </div>

  <div class="card scbox" id="scalecard">
    <h2>縮尺</h2>
    <p class="scline"><input class="scn" data-i="0" type="number" inputmode="decimal" min="0" step="any" value="1" aria-label="縮尺の分子"><span class="sl">/</span><input class="scn" data-i="1" type="number" inputmode="decimal" min="0" step="any" value="1" aria-label="縮尺の分母"><span class="muted">（既定 1/1＝実寸。例 1/10・1/50）</span></p>
    <p class="muted">モデルと点群をまとめて、固定点を中心に縮めます。AR の中の位置合わせの画面でも変えられます。</p>
  </div>

  <p class="disclaimer" role="note"><strong>ご注意：AR で表示するモデルの配置精度（位置・向き・高さ）は保証しません。</strong>
    スマホのカメラとセンサーで合わせるため、数十 cm 以上ずれることがあります。
    施工・測量・出来形の判断には使わず、必ず設計図面と現地の測量で確かめてください。</p>
  <button class="start" id="start" disabled>AR を始める</button>
  <div id="support"></div>
  <p class="muted">Android の Chrome（ARCore 対応機）と iPhone で動きます。</p>
</div>

<div id="overlay">
  <div id="gest"></div>
  <div class="top">
    <button id="fold" type="button" aria-label="ガイドを畳む">▲ 畳む</button>
    <div id="step"></div>
    <div id="info"></div>
    <div id="check"></div>
    <div id="live"></div>
  </div>
  <div class="panel">
    <!-- config.json の ui が simple のとき -->
    <div class="row simplerow">
      <span class="lbl">タップで選ぶ点</span>
      <button id="sel1" class="sel">P1 を選ぶ</button>
      <button id="sel2">P2 を選ぶ</button>
    </div>
    <div class="row simplerow">
      <button id="s1b" class="big blue" disabled>① P1 をここ</button>
      <button id="s2b" class="big orange" disabled>② P2 をここ</button>
    </div>
    <div class="row simplerow">
      <button id="slock" class="big green" disabled>固定する</button>
      <button id="sexit1">終わる</button>
    </div>
    <div class="row simplelock">
      <button id="sadj" class="big orange">位置合わせ</button>
      <button id="sexit2">終わる</button>
    </div>
    <!-- 位置合わせモード -->
    <div class="row adjonly">
      <button id="pp">◀</button><button id="pivBtn" class="blue">固定 P1</button><button id="pn">▶</button>
      <button id="tp">◀</button><button id="tgtBtn" class="orange">向ける P2</button><button id="tn">▶</button>
    </div>
    <div class="row adjonly">
      <button id="here" disabled>◎ P1 をここへ</button>
      <button id="aim" disabled>→ P2 へ向ける</button>
      <button id="add" disabled>＋ P2 を足す</button>
    </div>
    <div class="row adjonly">
      <button id="near" disabled>近い点</button>
      <button id="clr" disabled>記録を消す</button>
      <button id="delq" disabled>Q を消す</button>
      <button id="scaleTgl" class="finetune">拡大：なし</button>
    </div>
    <!-- 縮尺 □/□（モデル・点群・旗をまとめて固定点を中心に縮める）。config.json の "scales": false で出さない -->
    <div class="row adjonly scbox" id="scalerow"><span class="lbl">縮尺</span><input class="scn" data-i="0" type="number" inputmode="decimal" min="0" step="any" value="1" aria-label="縮尺の分子"><span class="sl">/</span><input class="scn" data-i="1" type="number" inputmode="decimal" min="0" step="any" value="1" aria-label="縮尺の分母"></div>
    <div class="row adjonly cloudonly">
      <button id="pick" disabled>点群の点を拾う</button>
      <button id="cloud1">点群：小</button>
      <button id="range1">範囲 50m</button>
    </div>
    <!-- 微調整（回転・高さ・拡大）は config.json の "finetune": true のときだけ出す -->
    <div class="row adjonly finetune">
      <button id="rl">⟲ 0.5°</button>
      <button id="rr">⟳ 0.5°</button>
      <button id="rl2">⟲ 0.1°</button>
      <button id="rr2">⟳ 0.1°</button>
      <button id="up">▲ 5cm</button>
      <button id="dn">▼ 5cm</button>
    </div>
    <div class="row scaleonly finetune">
      <button id="sm">縮小 1%</button>
      <button id="sp">拡大 1%</button>
      <button id="sm2">縮小 0.1%</button>
      <button id="sp2">拡大 0.1%</button>
      <button id="s1">実寸に戻す</button>
    </div>
    <div class="row adjonly">
      <button id="lock" class="big green" disabled>固定する</button>
      <button id="exit1">終わる</button>
    </div>
    <!-- 固定中 -->
    <div class="row lockonly">
      <button id="adjust" class="big orange">位置合わせ</button>
      <button id="toggle">半透明</button>
      <button id="cloud2" class="cloudonly">点群：小</button>
      <button id="range2" class="cloudonly">範囲 50m</button>
      <button id="exit2">終わる</button>
    </div>
  </div>
</div>

`);


const $ = id => document.getElementById(id);
const DEG = Math.PI / 180;

// ---------- 試験：ゲームコントローラーが読めるか（URL に ?pad を付けたときだけ。2026-10-08） ----------
// 起動画面と AR の中の両方に、つながっているコントローラー・スティックの値・押しているボタンを出す。
// AR の中は dom-overlay の中だけが見えるので、overlay の中にも同じ欄を置く。
// ★ページの読み込みの最初に置く（後ろの await＝AR に対応しているかの問い合わせ等で止まると欄が出なかった）
if (new URLSearchParams(location.search).has('pad')) {
  const mk = parent => {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;left:8px;right:8px;top:8px;z-index:99;padding:8px 10px;border-radius:10px;'
      + 'background:rgba(0,0,0,.72);color:#9ff59f;font:12px/1.45 monospace;white-space:pre-wrap;pointer-events:none';
    parent.appendChild(d);
    return d;
  };
  const boxes = [mk(document.body), mk($('overlay'))];
  let events = [];
  addEventListener('gamepadconnected', e => events.unshift(`つながった：${e.gamepad.id}`));
  addEventListener('gamepaddisconnected', e => events.unshift(`切れた：${e.gamepad.id}`));
  const show = () => {
    const pads = [...(navigator.getGamepads ? navigator.getGamepads() : [])].filter(Boolean);
    let ses = null;
    try { ses = session; } catch (e) { /* まだ AR の準備のところまで読み込みが進んでいない */ }
    const xr = ses ? [...ses.inputSources].filter(i => i.gamepad).length : 0;
    let t = `コントローラー試験（?pad）　AR中=${ses ? 'はい' : 'いいえ'}　getGamepads=${navigator.getGamepads ? 'あり' : 'なし'}　読めた台数=${pads.length}`
      + (ses ? `　XRの入力=${xr}` : '') + '\n';
    if (!pads.length) t += 'まだ読めていません。コントローラーのボタンを 1 回押してください\n';
    for (const g of pads) {
      t += `#${g.index} ${g.id.slice(0, 40)}（${g.mapping || '配置不明'}）\n`;
      t += `  スティック ${g.axes.map(a => (a >= 0 ? '+' : '') + a.toFixed(2)).join(' ')}\n`;
      const on = g.buttons.map((b, i) => (b.pressed || b.value > 0.1 ? `${i}${b.value < 1 && b.value > 0 ? '(' + b.value.toFixed(1) + ')' : ''}` : null)).filter(Boolean);
      t += `  押しているボタン ${on.length ? on.join(' ') : '－'}\n`;
    }
    if (events.length) t += events.slice(0, 3).join('\n');
    for (const b of boxes) if (b.textContent !== t) b.textContent = t;
  };
  setInterval(show, 150);                       // AR の最中も timer は動く（rAF は止まる）
}

const cfg = await (await fetch('config.json', { cache: 'no-cache' })).json();
$('title').textContent = cfg.title || '現場 AR 位置合わせ';
$('coords').textContent = cfg.coords || '';
document.title = `${cfg.title} | 現場 AR`;
// 版を付けて読む：同じ名前だとスマホが前の画像・モデルを使い続ける
const ver = u => u + (u.includes('?') ? '&' : '?') + 'v=' + encodeURIComponent(cfg.version || Date.now());

// ---------- 暗号化（config.json の enc があるフォルダだけ） ----------
// tools/encrypt_site.py が作る。鍵＝パスワードから PBKDF2（SHA-256・enc.iter 回・enc.salt）。
// 中身は AES-GCM（先頭 12 バイトが IV）。基準点と origin は enc.secret に、ファイルは .enc で置く。
// パスワードが違うと GCM の検査で復号が失敗する（それで見分ける）
const b64 = t => Uint8Array.from(atob(t), c => c.charCodeAt(0));
let KEY = null;
async function deriveKey(pw) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: b64(cfg.enc.salt), iterations: cfg.enc.iter },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt', 'encrypt']);
}
const decrypt = (key, buf) => {
  const u = new Uint8Array(buf);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.subarray(0, 12) }, key, u.subarray(12));
};
if (cfg.enc) {
  if (!crypto.subtle) throw new Error('この画面では復号できません（https で開いてください）');
  $('pwcard').hidden = false;
  $('start').hidden = true;
  await new Promise(done => {
    $('pwform').onsubmit = async e => {
      e.preventDefault();
      $('pwok').disabled = true; $('pwmsg').textContent = '確かめています…';
      try {
        const key = await deriveKey($('pw').value);
        const sec = JSON.parse(new TextDecoder().decode(await decrypt(key, b64(cfg.enc.secret))));
        Object.assign(cfg, sec);
        KEY = key; $('pwcard').hidden = true; $('start').hidden = false; done();
      } catch (err) {
        $('pwmsg').textContent = 'パスワードが違います';
        $('pwok').disabled = false;
      }
    };
  });
}
// ファイルを ArrayBuffer で読む（暗号化してあれば復号する）
async function fetchBuf(url) {
  const r = await fetch(ver(url));
  if (!r.ok) throw new Error(url + ' ' + r.status);
  const b = await r.arrayBuffer();
  return KEY ? decrypt(KEY, b) : b;
}
const PT = cfg.points || [];                  // 基準点（2 点以上。全部使う。点群から拾った点は後ろへ足す）
// ui: "simple"：基準点を前もって持たず、AR の前に点群の上で 2 点を選ぶ。AR の中のボタンは「① P1 をここ」「② P2 をここ」だけ
const SIMPLE = cfg.ui === 'simple';
if (SIMPLE) document.body.classList.add('simple');
if (cfg.finetune) document.body.classList.add('finetune');
// start: "pick"（または simple）：起動画面の地図で AR を始める場所を選ぶ。基準点を前もって持たない現場向け
const STARTPICK = SIMPLE || cfg.start === 'pick';
if (STARTPICK) $('startcard').hidden = false;

// 点群から拾った点（Q1, Q2 …）はこのスマホに覚えておく（フォルダごと。localStorage）。
// 暗号化したフォルダでは、覚えるときも同じ鍵で暗号化する（スマホの中でも座標を平文で置かない）
const QKEY = 'arq:' + location.pathname;
const u8b64 = u => btoa(String.fromCharCode(...new Uint8Array(u)));
async function saveQ() {
  try {
    const q = PT.filter(p => p.picked);
    if (!q.length) { localStorage.removeItem(QKEY); return; }
    let t = JSON.stringify(q);
    if (KEY) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, KEY, new TextEncoder().encode(t));
      t = 'enc:' + u8b64(iv) + ':' + u8b64(ct);
    }
    localStorage.setItem(QKEY, t);
  } catch (e) { /* 覚えられなくても AR は続ける */ }
}
let nPicked = 0;
if (!SIMPLE) try {
  let t = localStorage.getItem(QKEY);
  if (t) {
    if (t.startsWith('enc:')) {
      const [, iv, ct] = t.split(':');
      const u = new Uint8Array([...b64(iv), ...b64(ct)]);
      t = new TextDecoder().decode(await decrypt(KEY, u));
    }
    for (const q of JSON.parse(t)) {
      PT.push(q);
      nPicked = Math.max(nPicked, +String(q.name).replace(/\D/g, '') || 0);
    }
  }
} catch (e) { /* 読めなければ（パスワードを変えた等）覚えていないものとして進める */ }

// ---------- 準備画面 ----------
if (cfg.plan) {
  if (KEY) fetchBuf(cfg.plan).then(b => { $('plan').src = URL.createObjectURL(new Blob([b], { type: 'image/png' })); })
    .catch(() => $('plancard').remove());
  else $('plan').src = ver(cfg.plan);
} else $('plancard').remove();
const f3 = v => Number(v).toFixed(3);
function addRow(p) {
  $('points').querySelector('tbody').insertAdjacentHTML('beforeend',
    `<tr data-n="${p.name}"><td>${p.name}</td><td>${f3(p.x)}</td><td>${f3(p.y)}</td><td>${f3(p.z)}</td><td>${p.note || ''}</td>`
    + `<td>${p.picked ? `<button class="qdel" type="button" data-n="${p.name}">消す</button>` : ''}</td></tr>`);
  if (p.picked) $('qnote').hidden = false;
}
PT.forEach(addRow);
// 消す前の確かめは confirm() を使わず「もう一度押す」にする。
// iPhone の Variant Launch（App Clip）の中では confirm() のダイアログが出ないことがあり、拾った点が消せなかった（2026-10-07 報告）
function tapTwice(b, text, act) {
  if (b.dataset.armed) { clearTimeout(+b.dataset.armed); delete b.dataset.armed; act(); return; }
  const was = b.textContent;
  b.textContent = text; b.classList.add('armed');
  b.dataset.armed = setTimeout(() => { delete b.dataset.armed; b.textContent = was; b.classList.remove('armed'); }, 3000);
}
// 拾った点を 1 つずつ消す（表の「消す」。AR の中は「Qn を消す」）
$('points').querySelector('tbody').addEventListener('click', e => {
  const b = e.target.closest('.qdel');
  if (!b) return;
  tapTwice(b, 'もう一度押すと消す', () => removePoint(PT.findIndex(p => p.name === b.dataset.n)));
});
$('qclear').onclick = e => tapTwice(e.currentTarget, 'もう一度押すと全部消す', () => {
  try { localStorage.removeItem(QKEY); } catch (e) {}
  location.reload();
});
if (cfg.pointcloud) document.body.classList.add('hascloud');

// 現場座標（X=東, Y=北, Z=標高）⇔ glTF（x, y=上, z=南）
// origin（任意）：model.glb は現場座標から origin を引いた値で入っている。
// 平面直角座標（10 万 m）のままだと float32 で 1 cm 近く丸まるため
const O = { x: 0, y: 0, z: 0, ...(cfg.origin || {}) };
const siteToGl = p => new THREE.Vector3(p.x - O.x, p.z - O.z, -(p.y - O.y));
const glToSite = v => ({ x: v.x + O.x, y: -v.z + O.y, z: v.y + O.z });
// simple：2 点は AR の中で点群をタップして選ぶ。選ぶまでは仮の点（P1 は起動画面で選んだ始める場所の地面。旗は出さない）
// 始める場所はこのスマホに覚える（フォルダごと）。暗号化したフォルダでは覚えない
const SKEY = 'arstart:' + location.pathname;
let startAt = null;                             // 始める場所（現場座標）
let xrOK = false;                               // AR を始められる端末か（下で調べる）
// QR から開く（机の上で縮めて見る。2026-10-09）：URL の ?at= で始める場所を決め、地図で選ばなくてよくする。
//   ?at=c … 点群の真ん中の地面　?at=X,Y,Z … 現場座標。AR の中では十字を QR の真ん中に当てて「◎ S をここへ」。
//   縮尺は ?scale=1/100。向きは 2 本指でひねって合わせる。この始める場所はスマホに覚えない
const QS = new URLSearchParams(location.search);
const AT = STARTPICK ? QS.get('at') : null;
if (AT && AT !== 'c') {
  const [x, y, z] = AT.split(',').map(Number);
  if (isFinite(x) && isFinite(y)) startAt = { x, y, z: isFinite(z) ? z : O.z };
}
if (STARTPICK && !KEY && !AT) try { startAt = JSON.parse(localStorage.getItem(SKEY)); } catch (e) {}
if (SIMPLE) {
  PT.length = 0;
  for (const k of [0, 1]) PT.push({ name: `P${k + 1}`, x: O.x, y: O.y, z: O.z, ...(k === 0 ? startAt : null), unset: true });
} else if (STARTPICK) {
  // 始める場所を仮の点 S として先頭に置く（拾った Q はこのあと。S は覚えない・表にも出さない）
  PT.unshift({ name: 'S', ...(startAt || O), start: true, note: '始める場所（地図で選んだ大まかな場所）' });
}
const isStart = k => (SIMPLE ? PT[k]?.unset : PT[k]?.start) && k === 0;   // 始める場所で動かしてよい点
const P = PT.map(siteToGl);                   // モデル側の点

// ---------- three.js ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
// AR の画面の細かさを 0.8 倍に（描く画素が 4 割ほど減る）。10 分ほどで熱くなりブラウザが落ちた（2026-10-07 Android・点群のある現場）
renderer.xr.setFramebufferScaleFactor(0.8);
renderer.xr.setReferenceSpaceType('local');
renderer.domElement.style.display = 'none';
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 300);
scene.add(new THREE.HemisphereLight(0xffffff, 0x777766, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(3, 8, 2); scene.add(sun);

// 十字
const reticle = new THREE.Group();
{
  const m = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false });
  const parts = [
    new THREE.Mesh(new THREE.RingGeometry(0.09, 0.11, 40).rotateX(-Math.PI / 2), m),
    new THREE.Mesh(new THREE.PlaneGeometry(0.30, 0.012).rotateX(-Math.PI / 2), m),
    new THREE.Mesh(new THREE.PlaneGeometry(0.012, 0.30).rotateX(-Math.PI / 2), m),
    new THREE.Mesh(new THREE.CircleGeometry(0.012, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff3b30, depthTest: false })),
  ];
  parts.forEach(o => { o.renderOrder = 10; reticle.add(o); });
}
reticle.matrixAutoUpdate = false;
reticle.visible = false;
scene.add(reticle);

let picker = null;                              // simple：起動画面で始める場所を選ぶ地図（下で作る）

// モデル（現場座標のまま）
const group = new THREE.Group();
group.matrixAutoUpdate = false;
group.visible = false;
scene.add(group);
let modelRoot = null;
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const loadGlb = async url => (await loader.parseAsync(await fetchBuf(url), '')).scene;
loadGlb(cfg.model).then(sc => { modelRoot = sc; group.add(modelRoot); picker?.addModel(sc); })
  .catch(() => { $('support').textContent = 'モデルを読めませんでした（' + cfg.model + '）'; });

// 点群（任意。config.json の pointcloud。tools/las_to_points.py で作る）。
// 点の大きさは画面の画素で決める（遠くても小さくならない）。cloudSize：0＝出さない
const CLOUD_PX = [0, 2, 4];
let cloud = null, cloudSize = 1;
const cloudGrid = new Map();                    // 0.5 m 角の升 → その升の点（group の中の座標・x,y,z の並び）
const CELL = 0.5;
const cellKey = (x, z) => (Math.floor(x / CELL) + 32768) * 65536 + (Math.floor(z / CELL) + 32768);
if (cfg.pointcloud) {
  $('support').textContent = '点群を読んでいます…';
  loadGlb(cfg.pointcloud).then(sc => {
    sc.updateWorldMatrix(false, true);          // まだ group に入れていないので、matrixWorld は点群の中での位置
    const v = new THREE.Vector3();
    sc.traverse(o => {
      if (!o.isPoints) return;
      o.material = new THREE.PointsMaterial({ size: CLOUD_PX[cloudSize], sizeAttenuation: false, vertexColors: true });
      const a = o.geometry.getAttribute('position');
      for (let i = 0; i < a.count; i++) {
        v.fromBufferAttribute(a, i).applyMatrix4(o.matrixWorld);
        const k = cellKey(v.x, v.z);
        let c = cloudGrid.get(k);
        if (!c) cloudGrid.set(k, c = []);
        c.push(v.x, v.y, v.z);
      }
    });
    cloud = splitTiles(sc); group.add(cloud);
    $('support').textContent = '';
    if (isStart(0) && AT === 'c') {               // QR（?at=c）：点群の真ん中の地面を始める場所にする
      const v = cloudCenterGround();
      startAt = glToSite(v); moveStart(v); updateStart();
    } else if (isStart(0) && !startAt) moveStart(cloudCenterGround());   // 選ぶまでは点群の真ん中の地面
    picker?.addCloud(cloud);
    sc.traverse(o => o.geometry?.dispose());     // 元の 1 本は使わない（升に分けた写しを使う）
    paintRange(); thinCloud();
  }).catch(() => { $('support').textContent = '点群を読めませんでした（' + cfg.pointcloud + '）'; });
}
// 点群の外接箱の真ん中にいちばん近い地面の点（真ん中の 3 m 以内でいちばん低い点。無ければ箱の底）
function cloudCenterGround() {
  const box = new THREE.Box3().setFromObject(cloud);
  const c = box.getCenter(new THREE.Vector3());
  let best = null;
  for (let r = 3; r <= 48 && !best; r *= 2) {
    const i0 = Math.floor(c.x / CELL), k0 = Math.floor(c.z / CELL), n = Math.ceil(r / CELL);
    for (let di = -n; di <= n; di++) for (let dk = -n; dk <= n; dk++) {
      const a = cloudGrid.get((i0 + di + 32768) * 65536 + (k0 + dk + 32768));
      if (!a) continue;
      for (let j = 0; j < a.length; j += 3) if (!best || a[j + 1] < best.y) best = new THREE.Vector3(a[j], a[j + 1], a[j + 2]);
    }
  }
  return best || new THREE.Vector3(c.x, box.min.y, c.z);
}
// group の中の点 c にいちばん近い点群の点までの距離（m・group の中の長さ）。1 m より遠ければ null
function cloudDist(c) {
  let best = 1;
  const i0 = Math.floor(c.x / CELL), k0 = Math.floor(c.z / CELL);
  for (let di = -2; di <= 2; di++) for (let dk = -2; dk <= 2; dk++) {
    const a = cloudGrid.get((i0 + di + 32768) * 65536 + (k0 + dk + 32768));
    if (!a) continue;
    for (let j = 0; j < a.length; j += 3) {
      const d = Math.hypot(a[j] - c.x, a[j + 1] - c.y, a[j + 2] - c.z);
      if (d < best) best = d;
    }
  }
  return best < 1 ? best : null;
}
// ---------- 点群を升（TILE m 角）に分け、いる所の近くの升だけ描く ----------
// 全部を描くと点の数が多く、スマホが熱くなって落ちた（2026-10-07〜08）。描く点の数を「見える範囲」で絞る。
// 範囲は 25 / 50 / 100 m / 全部（ボタンで切り替え。config.json の "cloudRange" で初めの値、既定 50）
const TILE = 20;
const RANGES = [25, 50, 100, 0];                // 0＝全部
let cloudRange = RANGES.includes(cfg.cloudRange) ? cfg.cloudRange : 50;
let tiles = [];                                 // { obj, n, x0, x1, z0, z1 }（group の中の座標・n＝点の数）
// 縮尺に合わせて間引く：机の上で点の間隔が CLOUD_GAP（m）より詰まる分だけ描かない（2026-10-08）。
// 升ごとに点の順番を混ぜておき、先頭から何点まで描くか（drawRange）だけ変える＝縮尺を変えても計算は要らない。
// 描く割合＝min(1, (点の間隔×縮尺 ÷ CLOUD_GAP)²)。10 cm 間隔なら 1/100 で 44%・1/200 で 11%・1/500 で 2%
const CLOUD_GAP = (cfg.cloudGap || 1.5) / 1000;   // config.json の "cloudGap"（mm）。既定 1.5 mm
let cloudStep = 0.1;                            // 点の間隔の目安（m）。読み込んだときに数える
function splitTiles(sc) {
  const buckets = new Map();
  const v = new THREE.Vector3();
  let mat = null;
  sc.traverse(o => {
    if (!o.isPoints) return;
    mat = o.material;
    const a = o.geometry.getAttribute('position'), c = o.geometry.getAttribute('color');
    for (let i = 0; i < a.count; i++) {
      v.fromBufferAttribute(a, i).applyMatrix4(o.matrixWorld);
      const k = (Math.floor(v.x / TILE) + 32768) * 65536 + (Math.floor(v.z / TILE) + 32768);
      let b = buckets.get(k);
      if (!b) buckets.set(k, b = { p: [], c: [], ix: Math.floor(v.x / TILE), iz: Math.floor(v.z / TILE) });
      b.p.push(v.x, v.y, v.z);
      if (c) b.c.push(c.getX(i), c.getY(i), c.getZ(i));
    }
  });
  const g = new THREE.Group();
  tiles = [];
  for (const b of buckets.values()) {
    const n = b.p.length / 3;
    for (let i = n - 1; i > 0; i--) {             // 点の順番を混ぜる（先頭から取れば全体から均等に間引いたことになる）
      const j = Math.floor(Math.random() * (i + 1));
      for (let k = 0; k < 3; k++) {             // 配列を作らずに入れ替える（93 万点で遅くならないように）
        const a = i * 3 + k, c = j * 3 + k;
        let t = b.p[a]; b.p[a] = b.p[c]; b.p[c] = t;
        if (b.c.length) { t = b.c[a]; b.c[a] = b.c[c]; b.c[c] = t; }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
    if (b.c.length) geo.setAttribute('color', new THREE.Uint8BufferAttribute(b.c.map(x => Math.round(x * 255)), 3, true));
    const obj = new THREE.Points(geo, mat);
    g.add(obj);
    tiles.push({ obj, n, x0: b.ix * TILE, x1: (b.ix + 1) * TILE, z0: b.iz * TILE, z1: (b.iz + 1) * TILE });
  }
  // 点の間隔の目安＝1 / √(点の数 ÷ 点のある升（0.5 m 角）の面積)。2 cm〜50 cm に収める
  let nPts = 0;
  for (const t of tiles) nPts += t.n;
  if (cloudGrid.size) cloudStep = Math.min(0.5, Math.max(0.02, 1 / Math.sqrt(nPts / (cloudGrid.size * CELL * CELL))));
  return g;
}
// 縮尺に合わせて各升の描く点の数を決める（apply のたびに呼ぶ。数が変わったときだけ書き換える）
function thinCloud() {
  if (!tiles.length) return;
  let k = 1;
  try { k = mcBoarded ? 1 : s; } catch (e) { /* 点群のほうが置き方の値（s）より先に読み終わったとき */ }
  const f = Math.min(1, (cloudStep * k / CLOUD_GAP) ** 2);
  for (const t of tiles) {
    const c = Math.max(1, Math.ceil(t.n * f));
    if (t.obj.geometry.drawRange.count !== c) t.obj.geometry.setDrawRange(0, c);
  }
}
// いる所（カメラの真下）から範囲の外の升を隠す。升の四角までの水平の距離で見る（縮尺 s も掛ける）
const camLocal = new THREE.Vector3();
function updateTiles(cam) {
  if (!tiles.length || !placed) return;
  camLocal.setFromMatrixPosition(cam.matrixWorld).applyMatrix4(tmpM.copy(group.matrix).invert());
  for (const t of tiles) {
    if (!cloudRange) { t.obj.visible = true; continue; }
    const dx = Math.max(t.x0 - camLocal.x, 0, camLocal.x - t.x1), dz = Math.max(t.z0 - camLocal.z, 0, camLocal.z - t.z1);
    t.obj.visible = Math.hypot(dx, dz) * (mcBoarded ? 1 : s) <= cloudRange;   // 重機に乗っているあいだは実寸
  }
}
function paintRange() {
  const t = cloudRange ? `範囲 ${cloudRange}m` : '範囲 全部';
  $('range1').textContent = $('range2').textContent = t;
}
function setCloudSize(k) {
  cloudSize = k;
  const t = ['点群：なし', '点群：小', '点群：大'][k];
  $('cloud1').textContent = $('cloud2').textContent = t;
  if (!cloud) return;
  cloud.visible = k > 0;
  cloud.traverse(o => { if (o.isPoints) o.material.size = CLOUD_PX[k]; });
}

// 固定している点の目印（黄色の輪。モデルの中に置く）
const pivMark = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.40, 48).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xffd43b, side: THREE.DoubleSide, depthTest: false }));
pivMark.renderOrder = 6;
group.add(pivMark);
const tgtMark = new THREE.Mesh(new THREE.RingGeometry(0.26, 0.32, 48).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xff8a3d, side: THREE.DoubleSide, depthTest: false }));
tgtMark.renderOrder = 6;
group.add(tgtMark);

// すべての基準点に旗（高さ 1.5 m の竿＋玉、足もとの輪と中心の点）と名前の札。
// 竿は遠くから見つけるため、輪は足もとで十字を合わせるため（make_site_test.py の試験と同じ形）。
// 色：固定点＝青、向ける点＝橙、ほか＝白（paintFlags で塗り替える）
const FLAG_H = 1.5;
const FLAG_COL = { pivot: 0x1a6fd6, target: 0xf08c00, other: 0xf1f3f5 };
const ptMarks = new THREE.Group();
group.add(ptMarks);
const flagMats = [], flagObjs = [];
const poleG = new THREE.CylinderGeometry(0.02, 0.02, FLAG_H, 12).translate(0, FLAG_H / 2, 0);
const ballG = new THREE.SphereGeometry(0.08, 20, 14).translate(0, FLAG_H, 0);
const ringG = new THREE.RingGeometry(0.10, 0.15, 40).rotateX(-Math.PI / 2).translate(0, 0.004, 0);
const dotG = new THREE.CircleGeometry(0.02, 16).rotateX(-Math.PI / 2).translate(0, 0.005, 0);
function addFlag(pt, at) {                      // flagMats の並びは PT と同じ
  const solid = new THREE.MeshStandardMaterial({ color: FLAG_COL.other, emissive: FLAG_COL.other, emissiveIntensity: 0.35 });
  const flat = new THREE.MeshBasicMaterial({ color: FLAG_COL.other, side: THREE.DoubleSide, depthTest: false });
  flagMats.push([solid, flat]);
  const f = new THREE.Group();
  f.position.copy(at);
  const ring = new THREE.Mesh(ringG, flat), dot = new THREE.Mesh(dotG, flat);
  ring.renderOrder = dot.renderOrder = 5;
  f.add(new THREE.Mesh(poleG, solid), new THREE.Mesh(ballG, solid), ring, dot);
  ptMarks.add(f);
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 96;
  const c = cv.getContext('2d');
  c.fillStyle = 'rgba(15,18,22,.8)'; c.beginPath(); c.roundRect(4, 4, 248, 88, 20); c.fill();
  c.fillStyle = '#fff'; c.font = 'bold 60px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(pt.name, 128, 50);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false }));
  sp.scale.set(0.6, 0.225, 1);
  sp.position.copy(at); sp.position.y += FLAG_H + 0.3; sp.renderOrder = 7;
  ptMarks.add(sp);
  f.visible = sp.visible = !pt.unset;
  flagObjs.push({ f, sp });
}
PT.forEach((pt, i) => addFlag(pt, P[i]));
// 始める場所の点（simple の仮の P1・start の S）を v（group の中の座標）へ動かす。旗もいっしょに
function moveStart(v) {
  P[0].copy(v);
  if (!SIMPLE) Object.assign(PT[0], glToSite(v));
  const o = flagObjs[0];
  o.f.position.copy(v); o.sp.position.copy(v); o.sp.position.y += FLAG_H + 0.3;
}
function paintFlags() {
  flagMats.forEach(([solid, flat], i) => {
    const c = i === pivot ? FLAG_COL.pivot : i === target ? FLAG_COL.target : FLAG_COL.other;
    solid.color.setHex(c); solid.emissive.setHex(c); flat.color.setHex(c);
  });
}

// ---------- simple：AR の中で点群をタップして 2 点を選ぶ ----------
// v は group の中の座標。見た目を変えずに点だけ替える（固定点を替えるときは w を付け直す）
let pickSlot = 0;                               // タップで選ぶ点（0＝P1・1＝P2）
function setSlot(k) {
  pickSlot = k;
  $('sel1').classList.toggle('sel', k === 0);
  $('sel2').classList.toggle('sel', k === 1);
  showUI();
}
function setSimplePoint(k, v) {
  if (placed && k === pivot) w = v.clone().applyMatrix4(group.matrix);
  if (k === 0) obs.clear(); else obs.delete(1);  // 選び直した点は ① ／ ② を押し直す
  const site = glToSite(v);
  PT[k] = { name: `P${k + 1}`, x: site.x, y: site.y, z: site.z, note: '点群から選んだ点' };
  P[k].copy(v);
  const o = flagObjs[k];
  o.f.position.copy(v); o.sp.position.copy(v); o.sp.position.y += FLAG_H + 0.3;
  o.f.visible = o.sp.visible = true;
  $('check').className = '';
  $('check').textContent = `${PT[k].name} を選んだ（X ${site.x.toFixed(2)}　Y ${site.y.toFixed(2)}　標高 ${site.z.toFixed(2)}）`;
  apply();
}
// 十字の所へ最初に出す（点群を読み終え、十字が地面に張り付いたら 1 回だけ）
function autoPlace() {
  w = lastHit.clone(); theta = 0; s = 1; placed = true;
  apply();
}
// 1 本指でなぞる＝点群を地面の上で動かす（指の下の地面がついてくる）
const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function groundAt(x, y) {
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  ray.setFromCamera(new THREE.Vector2(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1), cam);
  ground.constant = -w.y;
  return ray.ray.intersectPlane(ground, new THREE.Vector3());
}

// ---------- simple：起動画面で AR を始める場所を選ぶ ----------
// 真上から見た点群（北が上）。1 本指で動かす・2 本指（ホイール）で拡大。タップした所のいちばん低い点（地面）を取る
if (STARTPICK) {
  const { MapControls } = await import('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/controls/MapControls.js/+esm');
  const view = $('pickview');
  const pr = new THREE.WebGLRenderer({ antialias: true });
  pr.setPixelRatio(window.devicePixelRatio);
  view.appendChild(pr.domElement);
  const ps = new THREE.Scene();
  ps.background = new THREE.Color(0x1d2128);
  ps.add(new THREE.HemisphereLight(0xffffff, 0x777766, 2.5));
  const pc = new THREE.OrthographicCamera(-1, 1, 1, -1, -2000, 2000);
  pc.up.set(0, 0, -1);                            // 北（glTF の −z）を画面の上に
  const ctl = new MapControls(pc, pr.domElement);
  ctl.enableRotate = false; ctl.screenSpacePanning = true; ctl.zoomToCursor = true; ctl.enableDamping = false;
  ctl.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
  let pcloud = null, box = null;
  const marks = new THREE.Group();
  ps.add(marks);
  const render = () => pr.render(ps, pc);
  ctl.addEventListener('change', render);
  function resize() {
    const wv = view.clientWidth || 320, hv = Math.round(Math.min(window.innerHeight * 0.6, wv * 1.2));
    pr.setSize(wv, hv);
    const a = wv / hv, r = box ? Math.max(box.max.x - box.min.x, (box.max.z - box.min.z) * a) / 2 * 1.05 : 50;
    pc.left = -r; pc.right = r; pc.top = r / a; pc.bottom = -r / a;
    pc.updateProjectionMatrix();
    render();
  }
  function fit() {
    const c = box.getCenter(new THREE.Vector3());
    ctl.target.set(c.x, 0, c.z);
    pc.position.set(c.x, 1000, c.z);
    pc.zoom = 1;
    pc.lookAt(ctl.target);
    resize();
    ctl.update();
  }
  window.addEventListener('resize', resize);
  function info() {
    $('pickinfo').innerHTML = startAt
      ? `始める場所　X ${f3(startAt.x)}　Y ${f3(startAt.y)}　標高 ${f3(startAt.z)}<br>ほかの所をタップすると選び直せる`
      : '<b>AR を始める場所（いま立っている所のあたり）をタップしてください</b><br>1 本指で動かす・2 本指で拡大';
  }
  const rc = new THREE.Raycaster();
  let down = null;
  pr.domElement.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  pr.domElement.addEventListener('pointerup', e => {
    if (!down || !pcloud || performance.now() - down.t > 500 || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) return;
    down = null;
    const rect = pr.domElement.getBoundingClientRect();
    rc.setFromCamera(new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1), pc);
    const wpp = (pc.right - pc.left) / pc.zoom / rect.width;       // 1 画素が何 m か
    rc.params.Points.threshold = wpp * 10;
    const hits = rc.intersectObject(pcloud, true);
    if (!hits.length) { $('pickinfo').textContent = '点群の上をタップしてください'; return; }
    const dmin = Math.min(...hits.map(h => h.distanceToRay));
    const pos = h => new THREE.Vector3().fromBufferAttribute(h.object.geometry.getAttribute('position'), h.index).applyMatrix4(h.object.matrixWorld);
    const v = hits.filter(h => h.distanceToRay <= dmin + wpp * 2).map(pos).reduce((a, b) => (b.y < a.y ? b : a));  // いちばん低い点＝地面
    startAt = glToSite(v);
    if (!KEY) try { localStorage.setItem(SKEY, JSON.stringify(startAt)); } catch (e) {}
    if (isStart(0)) moveStart(v);
    picker.mark(); info(); updateStart();
  });
  picker = {
    addCloud(sc) {
      pcloud = sc.clone();
      pcloud.traverse(o => { if (o.isPoints) o.material = new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true }); });
      ps.add(pcloud);
      box = new THREE.Box3().setFromObject(pcloud);
      fit(); info(); this.mark();
    },
    addModel(sc) {                                // モデルは点群の上に半透明で重ねる（埋まっている物も見えるように）
      const m = sc.clone();
      m.traverse(o => {
        if (!o.isMesh) return;
        o.material = o.material.clone();
        o.material.transparent = true; o.material.opacity = 0.55; o.material.depthTest = false;
        o.renderOrder = 2;
      });
      ps.add(m);
      if (box) render();
    },
    release() {                                   // AR を始めたら地図の側の点群を GPU から下ろす（起動画面に戻れば描き直すときに積み直す）
      pcloud?.traverse(o => o.geometry?.dispose());
    },
    mark() {                                      // 始める場所（白の縁取り＋黄）
      marks.clear();
      if (startAt) {
        const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(siteToGl(startAt).toArray(), 3));
        for (const [size, col, ro] of [[24, 0xffffff, 5], [16, 0xffd43b, 6]]) {
          const pt = new THREE.Points(g, new THREE.PointsMaterial({ size, color: col, sizeAttenuation: false, depthTest: false }));
          pt.renderOrder = ro;
          marks.add(pt);
        }
      }
      render();
    },
  };
  // MapControls を読んでいる間に読み終わっていたもの
  if (cloud) picker.addCloud(cloud);
  if (modelRoot) picker.addModel(modelRoot);
  if (!cfg.pointcloud) $('pickinfo').textContent = 'この現場には点群がありません（config.json の pointcloud）';
}

// ---------- 置き方の値 ----------
// モデルの点 x は  w + R(θ)·s·(x − P[pivot])  に置く（固定点が w に来る）
let placed = false, w = new THREE.Vector3(), theta = 0, s = 1, pivot = 0, target = PT.length > 1 ? 1 : 0;
// S（始める場所）のほかに前回拾った Q があれば、Q1 を固定点・Q2 を向ける点にして始める（S は ◀ ▶ で選べる）
if (PT[0]?.start && PT.length > 1) { pivot = 1; target = PT.length > 2 ? 2 : 0; }
if (AT) { pivot = 0; target = 0; }                // QR から開いたときは、拾った Q があっても S（QR の場所）を固定点にする
const obs = new Map();                          // 記録した点：番号 → 十字を当てた位置（AR の座標）
let aligning = true, allowScale = false, translucent = false;

function matrixOf() {
  const p = P[pivot];
  return new THREE.Matrix4().makeTranslation(w.x, w.y, w.z)
    .multiply(new THREE.Matrix4().makeRotationY(theta))
    .multiply(new THREE.Matrix4().makeScale(s, s, s))
    .multiply(new THREE.Matrix4().makeTranslation(-p.x, -p.y, -p.z));
}
function apply() {
  if (placed) { group.matrix.copy(matrixOf()); group.matrixWorldNeedsUpdate = true; }
  group.visible = placed;
  pivMark.position.copy(P[pivot]); pivMark.position.y += 0.006;
  pivMark.visible = aligning;
  tgtMark.position.copy(P[target]); tgtMark.position.y += 0.006;
  tgtMark.visible = aligning;
  paintFlags();
  thinCloud();
  showUI();
}
// 固定中に（アンカーで）動いた行列から値を読み直す
function syncFromMatrix() {
  const e = group.matrix.elements;
  s = Math.hypot(e[0], e[1], e[2]);
  theta = Math.atan2(-e[2], e[0]);
  w = P[pivot].clone().applyMatrix4(group.matrix);
}
function setPivot(i) {
  if (placed) w = P[i].clone().applyMatrix4(group.matrix);   // 見た目を変えずに固定点だけ替える
  pivot = i;
  if (target === pivot) target = (pivot + 1) % PT.length;
  apply();
}
const step = (i, d, skip) => {
  if (PT.length < 2) return i;                  // 点が 1 つ（S だけ）のときは動かさない
  do { i = (i + d + PT.length) % PT.length; } while (i === skip);
  return i;
};
function setTarget(i) { target = i; apply(); }

// ---------- 操作 ----------
let lastHit = null;
function placeHere() {                          // 固定点を十字の位置へ（記録はここから取り直す）
  if (!lastHit) return;
  w = lastHit.clone();
  placed = true;
  obs.clear(); obs.set(pivot, lastHit.clone());
  $('check').className = '';
  $('check').textContent = '';
  apply();
}
function aimOther() {                           // 向ける点を十字の方向へ（拡大ありなら距離も）
  if (!lastHit || !placed || target === pivot) return;
  const o = target;
  obs.set(o, lastHit.clone());
  const d = P[o].clone().sub(P[pivot]);
  const q = lastHit.clone().sub(w);
  theta = Math.atan2(d.z, d.x) - Math.atan2(q.z, q.x);
  const dh = Math.hypot(d.x, d.z), qh = Math.hypot(q.x, q.z);
  if (allowScale) s = qh / dh;
  const diff = (qh - dh * s) * 100;
  const bad = Math.abs(qh - dh * s) > 0.2;
  $('check').className = bad ? 'bad' : '';
  $('check').textContent = `${PT[pivot].name}–${PT[o].name} の距離　現地 ${qh.toFixed(2)} m ／ 図面 ${dh.toFixed(2)} m`
    + (!allowScale && Math.abs(s - 1) > 1e-9 ? `×${fmt(scN)}/${fmt(scD)}＝${(dh * s).toFixed(2)} m` : '')
    + (allowScale ? `（大きさを ${(s * 100).toFixed(1)}% に合わせた）` : `（差 ${diff >= 0 ? '+' : ''}${diff.toFixed(0)} cm）`)
    + (bad && !allowScale ? '　★差が大きい。点の取り違えか、十字の当て違い' : '');
  apply();
}
// 記録した全部の点で合わせる（水平は回転＋移動〔＋拡大〕の最小二乗、高さは平均）
function fitAll() {
  const ids = [...obs.keys()];
  if (ids.length < 2) return;
  const m = ids.map(i => P[i]), q = ids.map(i => obs.get(i));
  const avg = (a, k) => a.reduce((t, v) => t + v[k], 0) / a.length;
  const mc = { x: avg(m, 'x'), z: avg(m, 'z') }, qc = { x: avg(q, 'x'), z: avg(q, 'z') };
  let re = 0, im = 0, mm = 0;
  m.forEach((v, k) => {
    const ax = v.x - mc.x, az = v.z - mc.z, bx = q[k].x - qc.x, bz = q[k].z - qc.z;
    re += ax * bx + az * bz; im += az * bx - ax * bz; mm += ax * ax + az * az;
  });
  theta = Math.atan2(im, re);                   // makeRotationY(θ) で m を q の向きへ
  if (allowScale && mm > 1e-9) s = Math.hypot(re, im) / mm;
  const R = new THREE.Matrix4().makeRotationY(theta);
  const rc = new THREE.Vector3(mc.x, 0, mc.z).applyMatrix4(R).multiplyScalar(s);
  const ty = q.reduce((t, v, k) => t + v.y - s * m[k].y, 0) / q.length;
  const t = new THREE.Vector3(qc.x - rc.x, ty, qc.z - rc.z);
  w = P[pivot].clone().applyMatrix4(R).multiplyScalar(s).add(t);   // 固定点の行き先
  placed = true;
  apply();
  report();
}
// 記録した点ごとのずれ（モデルの点 − 十字を当てた位置）
function report() {
  const M = matrixOf();
  const rows = [...obs.entries()].map(([i, h]) => {
    const v = P[i].clone().applyMatrix4(M);
    return { i, dh: Math.hypot(v.x - h.x, v.z - h.z), dz: v.y - h.y };
  });
  const rms = Math.sqrt(rows.reduce((t, r) => t + r.dh * r.dh, 0) / rows.length);
  const worst = rows.reduce((a, b) => (b.dh > a.dh ? b : a));
  const bad = worst.dh > 0.2;
  $('check').className = bad ? 'bad' : '';
  $('check').innerHTML = `記録 ${rows.length} 点で合わせた　水平のずれ 平均 ${(rms * 100).toFixed(0)} cm・最大 ${PT[worst.i].name} ${(worst.dh * 100).toFixed(0)} cm`
    + (allowScale ? `（大きさ ${(s * 100).toFixed(1)}%）` : '')
    + '<br>' + rows.map(r => `${PT[r.i].name} ${(r.dh * 100).toFixed(0)}/${r.dz >= 0 ? '+' : ''}${(r.dz * 100).toFixed(0)}`).join('　')
    + '（水平/高さ cm）' + (bad ? '<br>★ずれの大きい点は取り違えか当て違い。「記録を消す」でやり直せる' : '');
}
function addPoint() {
  if (!lastHit || !placed) return;
  obs.set(target, lastHit.clone());
  if (obs.size >= 2) fitAll();
}
// 十字にいちばん近い基準点（モデルの上で水平距離）
function nearest(skip) {
  if (!placed || !lastHit) return null;
  const c = lastHit.clone().applyMatrix4(new THREE.Matrix4().copy(group.matrix).invert());
  let best = null;
  P.forEach((p, i) => {
    if (i === skip) return;
    const d = Math.hypot(p.x - c.x, p.z - c.z) * s;
    if (!best || d < best.d) best = { i, d };
  });
  return best;
}
const rotate = deg => { theta += deg * DEG; apply(); };
const lift = m => { w.y += m; apply(); };
const scaleBy = k => { if (allowScale) { s *= k; apply(); } };

let anchor = null, anchorWant = false, anchorOffset = null;
function lock() {
  if (!placed) return;
  aligning = false;
  anchorWant = true;                            // 次のフレームでアンカーを作る
  apply();
}
function unlock() {
  if (anchor) { syncFromMatrix(); try { anchor.delete(); } catch (e) {} }
  anchor = null; anchorOffset = null; anchorWant = false;
  aligning = true;
  apply();
}

function showUI() {
  const ov = $('overlay');
  ov.classList.toggle('simple', SIMPLE);
  if (SIMPLE) {
    ov.classList.toggle('aligning', aligning);
    const done1 = obs.has(0), done2 = obs.has(1);
    $('s1b').disabled = !lastHit || PT[0].unset;
    $('s2b').disabled = !lastHit || !done1 || PT[1].unset;
    $('slock').disabled = !placed;
    const mode = '<span class="mode adj">位置合わせ</span>';
    let st;
    if (!aligning) st = '<span class="mode lock">固定中</span><b>画面に触ってもモデルは動きません</b><br>直すときは「位置合わせ」';
    else if (!lastHit) st = mode + '<b>地面を探しています…</b><br>スマホをゆっくり左右に動かしてください';
    else if (!placed) st = mode + '<b>点群を読んでいます…</b>';
    else if (pickSlot === 0 && (PT[0].unset || !done1)) st = mode + (PT[0].unset
      ? '<b>点群の中で、現地で分かる所（白線の角など）をタップ → P1</b><br>1 本指でなぞる＝点群を動かす・2 本指でひねる＝回す'
      : '<b>十字を現地の P1 の場所に当てて「① P1 をここ」</b><br>違う所なら、点群をタップし直すと P1 が移る');
    else if (pickSlot === 0) st = mode + '<b>点群をタップすると P1 を選び直す</b><br>選び直したら ① を押し直す。P2 を選ぶなら「P2 を選ぶ」';
    else if (PT[1].unset) st = mode + '<b>P1 から離れた所を点群の中でタップ → P2</b><br>2 本指でひねると P1 を中心に回る';
    else if (!done2) st = mode + '<b>十字を現地の P2 の場所に当てて「② P2 をここ」</b><br>違う所なら、点群をタップし直すと P2 が移る';
    else st = mode + '<b>合ったら「固定する」</b><br>点群をタップすると P2 を選び直す（② を押し直す）';
    $('step').innerHTML = st;
    $('info').textContent = '';
    return;
  }
  ov.classList.toggle('aligning', aligning);
  ov.classList.toggle('scaling', allowScale);
  const a = PT[pivot].name, b = PT[target].name;
  $('pivBtn').textContent = `固定 ${a}`;
  $('tgtBtn').textContent = `向ける ${b}`;
  $('here').textContent = `◎ ${a} をここへ`;
  $('aim').textContent = `→ ${b} へ向ける`;
  $('add').textContent = `＋ ${b} を足す`;
  $('here').disabled = !lastHit;
  const noTgt = target === pivot || PT[target].start;   // 向ける点が無い（S だけ・S は大まかなので向けない）
  $('aim').disabled = !lastHit || !placed || noTgt;
  $('add').disabled = !lastHit || !placed || PT.length < 3 || noTgt;
  $('near').disabled = !lastHit || !placed;
  $('clr').disabled = obs.size === 0;
  $('delq').textContent = `${b} を消す`;
  $('delq').disabled = !PT[target].picked || target === pivot;
  $('pick').disabled = !placed || !cloud;
  $('lock').disabled = !placed;
  $('scaleTgl').textContent = allowScale ? '拡大：あり' : '拡大：なし';

  let st;
  if (!aligning) st = '<span class="mode lock">固定中</span><b>画面に触ってもモデルは動きません</b><br>直すときは「位置合わせ」';
  else if (!lastHit) st = '<span class="mode adj">位置合わせ</span><b>地面を探しています…</b><br>スマホをゆっくり左右に動かしてください';
  else if (!placed && PT[pivot].start && AT) st = `<span class="mode adj">位置合わせ</span><b>十字を QR の真ん中に当てて「◎ ${a} をここへ」</b><br>そのあと 2 本指でひねると向きが回る`;
  else if (!placed && PT[pivot].start) st = `<span class="mode adj">位置合わせ</span><b>十字を足もと（地図で選んだ始める場所）に当てて「◎ ${a} をここへ」</b><br>点群が大まかな位置に出る`;
  else if (!placed) st = `<span class="mode adj">位置合わせ</span><b>十字を ${a} の印に合わせて「◎ ${a} をここへ」</b>`;
  else if (PT[pivot].start && AT) st = `<span class="mode adj">位置合わせ</span><b>2 本指でひねって向きを合わせる</b><br>QR の真ん中が固定点。合ったら「固定する」`;
  else if (PT[pivot].start) st = `<span class="mode adj">位置合わせ</span><b>「点群の点を拾う」→ 現地で分かる所（白線の角など）をタップ</b><br>拾った点が固定点になる。点群は 1 本指でなぞると回る`;
  else if (noTgt) st = `<span class="mode adj">位置合わせ</span><b>「点群の点を拾う」→ ${a} から離れた所をタップして 2 点目を拾う</b><br>拾ったら十字を現地の同じ所に当てて「→ 向ける」`;
  else if (obs.size < 2) st = `<span class="mode adj">位置合わせ</span><b>十字を ${b} の印に合わせて「→ ${b} へ向ける」</b><br>画面をなぞる・ひねると ${a} を中心に回る。合ったら「固定する」`;
  else st = `<span class="mode adj">位置合わせ</span><b>記録 ${obs.size} 点。ほかの点も十字を当てて「＋ 足す」</b><br>十分に合ったら「固定する」`;
  $('step').innerHTML = st;
  $('info').textContent = placed
    ? `固定点 ${a}　向き ${(((theta / DEG) % 360 + 540) % 360 - 180).toFixed(1)}°　大きさ ${(s * 100).toFixed(1)}%${scaleText()}`
    : '';
  paintScales();
}

// ---------- 縮尺（□/□ を数字で入れる。既定 1/1） ----------
// 起動画面と AR の中の 2 か所に同じ欄がある（どちらで入れても同じ）。縮尺は固定点を中心に効く（固定点は動かない）。
// 記録した点が 2 つ以上あれば、その縮尺で合わせ直す。config.json の "scales": false で出さない
let scN = 1, scD = 1;                            // いまの縮尺 scN/scD
if (cfg.scales === false) { $('scalerow').remove(); $('scalecard').remove(); }
const scInputs = () => [...document.querySelectorAll('input.scn')];
const fmt = v => String(+v.toFixed(3));
function setRatio(n, d) {
  scN = n; scD = d;
  allowScale = false;                           // 指で大きさを変える（拡大：あり）は切る
  s = n / d;
  if (obs.size >= 2) fitAll();
  else if (P.length) apply();                   // 起動画面で点がまだ無いときは値だけ覚える
}
scInputs().forEach(el => el.addEventListener('change', () => {
  const box = el.closest('.scbox');
  const [a, b] = [...box.querySelectorAll('input.scn')].map(x => parseFloat(x.value));
  if (!(a > 0) || !(b > 0)) { paintScales(true); return; }   // 0・空・負は受け付けず元に戻す
  setRatio(a, b);
  paintScales(true);
}));
// 欄の数字をいまの縮尺にそろえる（入力中の欄は書き換えない）
function paintScales(force) {
  if (allowScale || Math.abs(scN / scD - s) > 1e-9) {          // 指や「実寸に戻す」で変わったとき
    if (s >= 1) { scN = +s.toFixed(3); scD = 1; } else { scN = 1; scD = +(1 / s).toFixed(3); }
  }
  scInputs().forEach(el => {
    if (!force && el === document.activeElement) return;
    el.value = fmt(el.dataset.i === '0' ? scN : scD);
  });
}
function scaleText() { return allowScale ? '' : (Math.abs(s - 1) < 1e-9 ? '（実寸）' : `（縮尺 ${fmt(scN)}/${fmt(scD)}）`); }
// URL の ?scale=1/100（QR から開いたとき）で縮尺を決める。あとから欄で変えてもよい
{
  const m = /^(\d*\.?\d+)\/(\d*\.?\d+)$/.exec(QS.get('scale') || '');
  if (m && cfg.scales !== false && +m[1] > 0 && +m[2] > 0) { setRatio(+m[1], +m[2]); paintScales(true); }
}

// ボタン
$('pp').onclick = () => setPivot(step(pivot, -1, -1));
$('pn').onclick = () => setPivot(step(pivot, 1, -1));
$('tp').onclick = () => setTarget(step(target, -1, pivot));
$('tn').onclick = () => setTarget(step(target, 1, pivot));
$('pivBtn').onclick = $('tgtBtn').onclick = () => { const o = pivot; setPivot(target); target = o; apply(); };   // 入れ替え
$('add').onclick = addPoint;
$('near').onclick = () => { const n = nearest(pivot); if (n) setTarget(n.i); };
$('clr').onclick = () => { obs.clear(); $('check').textContent = ''; apply(); };
$('delq').onclick = () => removePoint(target);
// 拾った点（Q）を消す。旗・表の行・記録も消し、スマホに覚えた分も書き直す。
// AR で置いたあとは固定点は消せない（固定点を替えてから消す）。置く前なら固定点も消せる
function removePoint(k) {
  if (k < 0 || !PT[k]?.picked || (placed && k === pivot)) return;
  const name = PT[k].name;
  PT.splice(k, 1); P.splice(k, 1); flagMats.splice(k, 1);
  const o = flagObjs.splice(k, 1)[0];
  ptMarks.remove(o.f, o.sp);
  const kept = [...obs].filter(([i]) => i !== k).map(([i, v]) => [i > k ? i - 1 : i, v]);
  obs.clear(); kept.forEach(([i, v]) => obs.set(i, v));
  if (!placed) {                                // 置く前：始めたときと同じ選び方に戻す
    pivot = PT[0]?.start && PT.length > 1 ? 1 : 0;
    target = PT[0]?.start && PT.length > 1 ? (PT.length > 2 ? 2 : 0) : (PT.length > 1 ? 1 : 0);
  } else {
    if (pivot > k) pivot--;
    if (target === k || target >= PT.length) target = PT.length > 1 ? step(pivot, 1, pivot) : pivot;
    else if (target > k) target--;
  }
  saveQ();
  $('points').querySelector(`tr[data-n="${name}"]`)?.remove();
  if (!PT.some(p => p.picked)) $('qnote').hidden = true;
  $('check').className = '';
  $('check').textContent = `${name} を消した`;
  if (obs.size >= 2) fitAll(); else apply();
}
$('scaleTgl').onclick = () => { allowScale = !allowScale; apply(); };
$('here').onclick = placeHere;
$('aim').onclick = aimOther;
$('rl').onclick = () => rotate(0.5);  $('rr').onclick = () => rotate(-0.5);
$('rl2').onclick = () => rotate(0.1); $('rr2').onclick = () => rotate(-0.1);
$('up').onclick = () => lift(0.05);   $('dn').onclick = () => lift(-0.05);
$('sp').onclick = () => scaleBy(1.01);   $('sm').onclick = () => scaleBy(1 / 1.01);
$('sp2').onclick = () => scaleBy(1.001); $('sm2').onclick = () => scaleBy(1 / 1.001);
$('s1').onclick = () => { s = 1; apply(); };
$('lock').onclick = lock;
// simple：① 固定点 P1 を十字へ（やり直しもここから）／② P2 へ向けて、そのまま固定（アンカー）
$('s1b').onclick = () => { placeHere(); setSlot(1); };          // ① のあとは P2 を選ぶ番
$('s2b').onclick = () => { aimOther(); };
$('sel1').onclick = () => setSlot(0);
$('sel2').onclick = () => setSlot(1);
$('slock').onclick = lock;
$('sadj').onclick = unlock;
// 画面上部のガイドを畳む／広げる（畳んだかはこのスマホに覚える）
function setFold(on) {
  document.querySelector('#overlay .top').classList.toggle('folded', on);
  $('fold').textContent = on ? '▼ ガイド' : '▲ 畳む';
  $('fold').setAttribute('aria-label', on ? 'ガイドを広げる' : 'ガイドを畳む');
  try { localStorage.setItem('arfold', on ? '1' : ''); } catch (e) {}
}
$('fold').onclick = () => setFold(!document.querySelector('#overlay .top').classList.contains('folded'));
try { if (localStorage.getItem('arfold')) setFold(true); } catch (e) {}
$('sexit1').onclick = $('sexit2').onclick = () => session?.end();
$('adjust').onclick = unlock;
$('toggle').onclick = () => {
  translucent = !translucent;
  $('toggle').textContent = translucent ? '不透明' : '半透明';
  modelRoot?.traverse(o => {
    if (!o.isMesh) return;
    o.material.transparent = translucent; o.material.opacity = translucent ? 0.45 : 1;
    o.material.depthWrite = !translucent; o.material.needsUpdate = true;
  });
};
$('exit1').onclick = $('exit2').onclick = () => session?.end();

// 指の操作（位置合わせモードで、置いたあとだけ）：なぞる・ひねる＝固定点で回転、2 本指で広げる＝拡大
const touches = new Map();
let g0 = null;
function gstate() {
  const t = [...touches.values()];
  if (t.length >= 2) {
    const dx = t[1].x - t[0].x, dy = t[1].y - t[0].y;
    return { n: 2, ang: Math.atan2(dy, dx), dist: Math.hypot(dx, dy), theta, s };
  }
  return { n: 1, x: t[0].x, theta, s };
}
const gest = $('gest');
let tap0 = null;                                // 点を拾うときのタップ（押した位置と時刻）
let gprev = null;                               // simple：1 本指で動かすときの前の指の位置
gest.addEventListener('pointerdown', e => {
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY }); g0 = gstate();
  gprev = { x: e.clientX, y: e.clientY };
  tap0 = touches.size === 1 ? { x: e.clientX, y: e.clientY, t: performance.now() } : null;
});
gest.addEventListener('pointermove', e => {
  if (!touches.has(e.pointerId) || !placed || !aligning || picking || mcPlacing) return;
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const g = gstate();
  if (g.n !== g0.n) { g0 = g; const t = touches.get(e.pointerId); gprev = { x: t.x, y: t.y }; return; }
  if (SIMPLE && g.n === 1) {                     // 1 本指＝点群を地面の上で動かす
    const t = touches.get(e.pointerId), a = groundAt(gprev.x, gprev.y), b = groundAt(t.x, t.y);
    gprev = { x: t.x, y: t.y };
    if (a && b) w.add(b.sub(a));
  } else if (g.n === 1) theta = g0.theta - (g.x - g0.x) * 0.15 * DEG;        // 右へなぞる＝右回り
  else {
    theta = g0.theta - (g.ang - g0.ang);
    if (allowScale) s = g0.s * g.dist / g0.dist;
  }
  apply();
});
const up = e => {
  touches.delete(e.pointerId); g0 = touches.size ? gstate() : null;
  const isTap = tap0 && e.type === 'pointerup' && performance.now() - tap0.t < 600
    && Math.hypot(e.clientX - tap0.x, e.clientY - tap0.y) < 15;
  if (isTap && mcPlacing) mc?.tap(e.clientX, e.clientY);          // 重機を置く（基準点を拾うのと同じ手順）
  else if (isTap && (picking || (SIMPLE && placed && aligning))) pickAt(e.clientX, e.clientY);
  tap0 = null;
};

// 点群の点を拾って基準点に足す（Q1, Q2 …）。タップした所へ光線を飛ばし、光線にいちばん近い点群の点を取る
let picking = false;
const ray = new THREE.Raycaster();
function setPicking(on) {
  picking = on;
  $('pick').classList.toggle('sel', on);
  $('pick').textContent = on ? '点群の目印をタップ（やめる）' : '点群の点を拾う';
  if (on) { $('check').className = ''; $('check').textContent = '画面で点群の目印（白線の角・継ぎ目の端など）をタップしてください'; }
}
function pickAt(x, y) {
  if (!cloud || !placed) return;
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  ray.setFromCamera(new THREE.Vector2(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1), cam);
  // 光線のまわりを広めに拾い、画面の上でタップした所にいちばん近く見える点を取る。
  // （光線にいちばん近い点で選ぶと、地面を斜めに見たとき光線が手前で地面をかすめ、手前の点を取ってしまう）
  ray.params.Points.threshold = 3;
  const hits = ray.intersectObjects(cloud.children.filter(o => o.visible), false);   // 隠れている升は拾わない
  const inv = new THREE.Matrix4().copy(cam.matrixWorld).invert();
  const cand = hits.map(h => {
    const wp = new THREE.Vector3().fromBufferAttribute(h.object.geometry.getAttribute('position'), h.index).applyMatrix4(h.object.matrixWorld);
    const c = wp.clone().applyMatrix4(inv), n = c.clone().applyMatrix4(cam.projectionMatrix);
    return { wp, depth: -c.z, px: Math.hypot((n.x + 1) / 2 * innerWidth - x, (1 - n.y) / 2 * innerHeight - y) };
  }).filter(c => c.depth > 0 && c.px < 24);
  if (!cand.length) { $('check').className = 'bad'; $('check').textContent = '点群に当たりませんでした。点の上をタップしてください'; return; }
  const pmin = Math.min(...cand.map(c => c.px));
  const best = cand.filter(c => c.px <= pmin + 3).reduce((a, b) => (b.depth < a.depth ? b : a));   // ほぼ同じ所に見えるなら手前の点
  const v = best.wp.applyMatrix4(tmpM.copy(group.matrixWorld).invert());
  if (SIMPLE) { setSimplePoint(pickSlot, v); return; }
  const site = glToSite(v);
  const now = new Date();
  const pt = { name: `Q${++nPicked}`, ...site, picked: true,
    note: `点群から拾った点（${now.getMonth() + 1}/${now.getDate()} ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}）` };
  PT.push(pt); P.push(v); addFlag(pt, v);
  saveQ();
  addRow(pt);
  setPicking(false);
  $('check').className = '';
  if (PT[pivot].start) {                        // 固定点が仮の S なら、拾った点を固定点にする（見た目は変えない）
    obs.clear();                                // S で当てた記録は大まかなので捨てる
    setPivot(PT.length - 1);
    $('check').textContent = `${pt.name} を拾った（X ${site.x.toFixed(2)}　Y ${site.y.toFixed(2)}　標高 ${site.z.toFixed(2)}）。`
      + `${pt.name} が固定点になった。十字を現実の同じ場所へ当てて「◎ ${pt.name} をここへ」`;
    return;
  }
  setTarget(PT.length - 1);
  $('check').textContent = `${pt.name} を拾った（X ${site.x.toFixed(2)}　Y ${site.y.toFixed(2)}　標高 ${site.z.toFixed(2)}）。`
    + `十字を現実の同じ場所へ当てて「→ ${pt.name} へ向ける」か「＋ ${pt.name} を足す」`;
}
$('pick').onclick = () => setPicking(!picking);
$('cloud1').onclick = $('cloud2').onclick = () => setCloudSize((cloudSize + 1) % 3);
$('range1').onclick = $('range2').onclick = () => {
  cloudRange = RANGES[(RANGES.indexOf(cloudRange) + 1) % RANGES.length];
  paintRange(); tileAt = 0;                      // 次のフレームですぐ描き直す
};
gest.addEventListener('pointerup', up);
gest.addEventListener('pointercancel', up);

// ---------- 開始・終了 ----------
let session = null, hitSource = null, refSpace = null;
async function startAR() {
  const overlay = $('overlay');
  session = await navigator.xr.requestSession('immersive-ar', {
    requiredFeatures: ['hit-test'],
    optionalFeatures: ['local', 'dom-overlay', 'anchors'],
    domOverlay: { root: overlay },
  });
  overlay.classList.add('on');
  overlay.addEventListener('beforexrselect', e => e.preventDefault());
  picker?.release?.();                          // 起動画面の地図の点群（2 つ目の写し）を下ろして、メモリと熱を減らす
  renderer.domElement.style.display = 'block';
  await renderer.xr.setSession(session);
  refSpace = renderer.xr.getReferenceSpace();
  const viewer = await session.requestReferenceSpace('viewer');
  hitSource = await session.requestHitTestSource({ space: viewer });
  session.addEventListener('end', () => {
    hitSource = null; session = null; lastHit = null; reticle.visible = false;
    anchor = null; anchorOffset = null; anchorWant = false;
    placed = false; aligning = true; theta = 0; s = 1; obs.clear();
    if (SIMPLE) setSlot(0);
    overlay.classList.remove('on'); renderer.domElement.style.display = 'none';
    $('check').textContent = ''; $('live').textContent = '';
    apply();
  });
  apply();
}
$('start').onclick = () => startAR().catch(e => { $('support').textContent = 'AR を始められませんでした：' + e.message; });

// AR を始めるボタン：simple は始める場所を選んでから
function updateStart() {
  if (!xrOK) return;
  const need = STARTPICK && !startAt;
  $('start').disabled = need;
  $('start').textContent = need ? 'AR を始める（先に始める場所を選んでください）' : 'AR を始める';
}
// iPhone：Variant Launch の中で開き直すと WebXR が使える
function launchReady(d) {
  if (!d || !d.launchRequired) return false;
  $('start').textContent = 'AR を始める（iPhone：「開く」を押してください）';
  $('start').disabled = false;
  $('start').onclick = () => { location.href = d.launchUrl; };
  return true;
}
let xrDone = false;                             // AR に対応しているかを調べ終えたか
// QR から開いたとき（?at=）：起動画面を出さず、画面いっぱいの「タップで AR を始める」にする。
// ブラウザは人がタップしないと AR を始めさせないので、タップ 1 回は残る（iPhone は Variant Launch の「開く」もある）
if (AT) {
  const q = document.createElement('button');
  q.id = 'qrgo'; q.type = 'button';
  q.style.cssText = 'position:fixed;inset:0;z-index:50;border:0;background:rgba(17,20,26,.94);color:#fff;'
    + 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:24px;font:inherit;text-align:center';
  q.innerHTML = '<b style="font-size:26px"></b><span style="font-size:15px;opacity:.85">十字を QR の真ん中に当てて「◎ S をここへ」→ 2 本指でひねって向きを合わせる</span>'
    + '<span style="font-size:13px;color:#ffb020;max-width:30em">AR で表示するモデルの配置精度（位置・向き・高さ）は保証しません。施工・測量・出来形の判断には使わないでください。</span>';
  document.body.appendChild(q);
  const paint = () => {
    const b = $('start');
    const no = xrDone && b.disabled && !xrOK && !(IS_IOS && VL_KEY);   // 始められない端末（iPhone は Variant Launch の準備を待つ）
    q.firstChild.textContent = no ? 'この端末では AR を始められません（タップで戻る）' : b.disabled ? '読み込んでいます…' : 'タップで AR を始める';
    q.dataset.no = no ? '1' : '';
  };
  const iv = setInterval(paint, 300); paint();
  q.onclick = () => {
    if ($('start').disabled) { if (q.dataset.no) { clearInterval(iv); q.remove(); } return; }   // 始められない端末：ふだんの画面に戻して理由を見せる
    clearInterval(iv); q.remove();
    $('start').click();
  };
}
if (navigator.xr && await navigator.xr.isSessionSupported('immersive-ar').catch(() => false)) {
  xrOK = true; updateStart();
} else if (!launchReady(window.__vl)) {
  $('support').innerHTML = IS_IOS && VL_KEY
    ? '準備中です。少し待ってから再読み込みしてください。'
    : 'この端末・ブラウザでは AR を始められません（Android の Chrome・ARCore 対応機か、iPhone で開いてください）。';
  window.addEventListener('vlaunch-initialized', e => { if (launchReady(e.detail)) $('support').textContent = ''; });
}
xrDone = true;

// ---------- 毎フレーム ----------
const tmpM = new THREE.Matrix4();
// ---------- 重機（config.json に "machines" がある現場だけ。中身は machines.js） ----------
let mc = null, mcPlacing = false;                // 重機を置くあいだ（タップを重機へ渡す・指で回さない）
let padMode = false;                              // コントローラーで重機を動かしているあいだ（ボタンと十字を隠す）
let mcBoarded = false;                            // 重機に乗っているあいだ（世界を運転席の目へ動かす・実寸）
if (cfg.machines) {
  import(new URL('machines.js', import.meta.url).href + new URL(import.meta.url).search)
    .then(m => m.initMachines({ THREE, loader, group, siteToGl, cfg,
      getCamera: () => (renderer.xr.isPresenting ? renderer.xr.getCamera() : camera),
      getTargets: () => ({ model: modelRoot, cloud }),
      setPlacing: on => { mcPlacing = on; $('overlay').classList.toggle('mcplace', on); },
      setPadMode: on => { padMode = on; $('overlay').classList.toggle('padmode', on); },
      scene,
      setBoarded: on => { mcBoarded = on; thinCloud(); if (!on) apply(); } }))
    .then(r => { mc = r; })
    .catch(e => { $('support').textContent = '重機を読めませんでした：' + e.message; });
}
let liveAt = 0, tileAt = 0;
renderer.setAnimationLoop((time, frame) => {
  if (frame && hitSource) {
    if (time - tileAt > 500) { tileAt = time; updateTiles(renderer.xr.getCamera()); mc?.frame(!!lastHit, aligning, placed); }
    mc?.tick(time);                              // ゲームコントローラーで重機を動かす（毎フレーム）
    const hits = frame.getHitTestResults(hitSource);
    const had = !!lastHit;
    if (hits.length) {
      reticle.matrix.fromArray(hits[0].getPose(refSpace).transform.matrix);
      reticle.matrixWorldNeedsUpdate = true;
      reticle.visible = aligning && !padMode;    // 固定中・コントローラー操作中は十字（ターゲットマーク）を出さない
      lastHit = new THREE.Vector3().setFromMatrixPosition(reticle.matrix);
    } else {
      reticle.visible = false;
      lastHit = null;
    }
    if (had !== !!lastHit) showUI();
    if (SIMPLE && !placed && lastHit && cloud) autoPlace();

    // 固定したらアンカーを作り、以後はアンカーの動きに合わせる（歩いたときのずれを減らす）
    if (anchorWant && frame.createAnchor) {
      anchorWant = false;
      const at = w.clone(), M = group.matrix.clone();
      frame.createAnchor(new XRRigidTransform({ x: at.x, y: at.y, z: at.z }), refSpace).then(a => {
        if (aligning) { try { a.delete(); } catch (e) {} return; }
        anchor = a;
        anchorOffset = new THREE.Matrix4().makeTranslation(at.x, at.y, at.z).invert().multiply(M);
      }).catch(() => {});
    }
    if (!aligning && anchor && anchorOffset && frame.trackedAnchors?.has(anchor)) {
      const ap = frame.getPose(anchor.anchorSpace, refSpace);
      if (ap) { group.matrix.multiplyMatrices(tmpM.fromArray(ap.transform.matrix), anchorOffset); group.matrixWorldNeedsUpdate = true; }
    }
    // 重機に乗っているあいだは、運転席の目がスマホの所に来るよう世界（group）を動かす（位置合わせ・アンカーより後に上書き）
    if (mcBoarded) mc?.board(frame, refSpace);

    // 十字の位置を現場座標で（文字の書き換えは 0.25 秒ごと。毎フレーム書き換えると重く、熱の元になる）
    if (placed && lastHit && aligning && !mcBoarded) {   // 固定中・乗っているあいだは十字を出さないので座標も出さない
      if (time - liveAt < 250) { renderer.render(scene, camera); return; }
      liveAt = time;
      const loc = lastHit.clone().applyMatrix4(tmpM.copy(group.matrix).invert());
      const c = glToSite(loc);
      const n = nearest(-1);
      // 十字（現実の地面）から点群までの距離＝ずれの目安。20 cm を超えたら赤
      const cd = cloud && cloud.visible ? cloudDist(loc) : undefined;
      const far = cd === null || (cd !== undefined && cd * s > 0.2);
      $('live').className = far ? 'bad' : '';
      $('live').textContent = `十字の位置　X ${c.x.toFixed(2)}　Y ${c.y.toFixed(2)}　標高 ${c.z.toFixed(2)}`
        + (n && n.d < 5 ? `　近い点 ${PT[n.i].name} まで ${(n.d * 100).toFixed(0)} cm` : '')
        + (cd === undefined ? '' : cd === null ? '　点群まで 1 m 以上' : `　点群まで ${(cd * s * 100).toFixed(0)} cm`)
        + (far ? '（ずれが大きい：近くの点で合わせ直す目安）' : '');
    } else if ($('live').textContent) $('live').textContent = '';   // 空なら書き換えない
  }
  renderer.render(scene, camera);
});
