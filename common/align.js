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

  <div class="card">
    <h2>使い方</h2>
    <ol>
      <li>「AR を始める」→ 地面を映してスマホをゆっくり動かす（十字が地面に張り付くまで）</li>
      <li><b>位置合わせモード</b>で始まる（橙の表示）。◀ ▶ で<b>固定する点</b>（青）と<b>向ける点</b>（橙）を選ぶ</li>
      <li>十字を<b>固定する点の印</b>に合わせて「◎ ここへ」</li>
      <li>十字を<b>向ける点の印</b>に合わせて「→ 向ける」。固定した点を中心にモデルが回る</li>
      <li>基準点が 3 点以上あるときは、向ける点を替えて十字を当て「＋ 足す」。
        <b>記録した全部の点で</b>いちばん合う位置に置き直し、点ごとのずれが出る。「近い点」で十字に近い点を選べる</li>
      <li>画面を指でなぞる・ひねると、固定した点を中心に回る（微調整は ⟲ ⟳ ボタン）。
        拡大を「あり」にすると、2 本指で広げる・つまむ、または「→ 向ける」「＋ 足す」で大きさも合わせる</li>
      <li>合ったら「固定する」（緑の表示）。固定中は画面に触ってもモデルは動かない。直すときは「位置合わせ」</li>
      <li class="cloudonly"><b>点群</b>があるときは、モデルと一緒に点群も出る。十字の下に「点群まで ◯ cm」が出て、
        20 cm を超えると赤になる（基準点を合わせ直す目安）。
        「点群の点を拾う」→ 画面で点群の目印（白線の角など）をタップすると、その点が新しい基準点（Q1, Q2 …）になる。
        十字を現実の同じ場所へ当てて「→ 向ける」か「＋ 足す」</li>
    </ol>
  </div>

  <div class="card">
    <h2>基準点</h2>
    <table id="points"><thead><tr><th>点</th><th>X</th><th>Y</th><th>標高</th><th>目印</th></tr></thead><tbody></tbody></table>
    <p class="muted" id="qnote" hidden>Q で始まる点は、このスマホで点群から拾って覚えている点です。
      <button id="qclear" type="button">拾った点を消す</button></p>
  </div>

  <div class="card" id="plancard">
    <h2>平面図</h2>
    <img class="plan" id="plan" alt="基準点とモデルの位置関係の平面図">
  </div>

  <button class="start" id="start" disabled>AR を始める</button>
  <div id="support"></div>
  <p class="muted">Android の Chrome（ARCore 対応機）と iPhone で動きます。</p>
</div>

<div id="overlay">
  <div id="gest"></div>
  <div class="top">
    <div id="step"></div>
    <div id="info"></div>
    <div id="check"></div>
    <div id="live"></div>
  </div>
  <div class="panel">
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
      <button id="scaleTgl">拡大：なし</button>
    </div>
    <div class="row adjonly cloudonly">
      <button id="pick" disabled>点群の点を拾う</button>
      <button id="cloud1">点群：小</button>
    </div>
    <div class="row adjonly">
      <button id="rl">⟲ 0.5°</button>
      <button id="rr">⟳ 0.5°</button>
      <button id="rl2">⟲ 0.1°</button>
      <button id="rr2">⟳ 0.1°</button>
      <button id="up">▲ 5cm</button>
      <button id="dn">▼ 5cm</button>
    </div>
    <div class="row scaleonly">
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
      <button id="exit2">終わる</button>
    </div>
  </div>
</div>

`);


const $ = id => document.getElementById(id);
const DEG = Math.PI / 180;
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
const PT = cfg.points;                        // 基準点（2 点以上。全部使う。点群から拾った点は後ろへ足す）

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
try {
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
    `<tr><td>${p.name}</td><td>${f3(p.x)}</td><td>${f3(p.y)}</td><td>${f3(p.z)}</td><td>${p.note || ''}</td></tr>`);
  if (p.picked) $('qnote').hidden = false;
}
PT.forEach(addRow);
$('qclear').onclick = () => {
  if (!confirm('このスマホで拾った点（Q）を全部消します')) return;
  try { localStorage.removeItem(QKEY); } catch (e) {}
  location.reload();
};
if (cfg.pointcloud) document.body.classList.add('hascloud');

// 現場座標（X=東, Y=北, Z=標高）⇔ glTF（x, y=上, z=南）
// origin（任意）：model.glb は現場座標から origin を引いた値で入っている。
// 平面直角座標（10 万 m）のままだと float32 で 1 cm 近く丸まるため
const O = { x: 0, y: 0, z: 0, ...(cfg.origin || {}) };
const siteToGl = p => new THREE.Vector3(p.x - O.x, p.z - O.z, -(p.y - O.y));
const glToSite = v => ({ x: v.x + O.x, y: -v.z + O.y, z: v.y + O.z });
const P = PT.map(siteToGl);                   // モデル側の点

// ---------- three.js ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
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

// モデル（現場座標のまま）
const group = new THREE.Group();
group.matrixAutoUpdate = false;
group.visible = false;
scene.add(group);
let modelRoot = null;
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const loadGlb = async url => (await loader.parseAsync(await fetchBuf(url), '')).scene;
loadGlb(cfg.model).then(sc => { modelRoot = sc; group.add(modelRoot); })
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
    cloud = sc; group.add(cloud);
    $('support').textContent = '';
  }).catch(() => { $('support').textContent = '点群を読めませんでした（' + cfg.pointcloud + '）'; });
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
const flagMats = [];
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
}
PT.forEach((pt, i) => addFlag(pt, P[i]));
function paintFlags() {
  flagMats.forEach(([solid, flat], i) => {
    const c = i === pivot ? FLAG_COL.pivot : i === target ? FLAG_COL.target : FLAG_COL.other;
    solid.color.setHex(c); solid.emissive.setHex(c); flat.color.setHex(c);
  });
}

// ---------- 置き方の値 ----------
// モデルの点 x は  w + R(θ)·s·(x − P[pivot])  に置く（固定点が w に来る）
let placed = false, w = new THREE.Vector3(), theta = 0, s = 1, pivot = 0, target = 1;
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
const step = (i, d, skip) => { do { i = (i + d + PT.length) % PT.length; } while (i === skip); return i; };
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
  if (!lastHit || !placed) return;
  const o = target;
  obs.set(o, lastHit.clone());
  const d = P[o].clone().sub(P[pivot]);
  const q = lastHit.clone().sub(w);
  theta = Math.atan2(d.z, d.x) - Math.atan2(q.z, q.x);
  const dh = Math.hypot(d.x, d.z), qh = Math.hypot(q.x, q.z);
  if (allowScale) s = qh / dh;
  const diff = (qh - dh * s) * 100;
  const bad = Math.abs(qh - dh) > 0.2;
  $('check').className = bad ? 'bad' : '';
  $('check').textContent = `${PT[pivot].name}–${PT[o].name} の距離　現地 ${qh.toFixed(2)} m ／ 図面 ${dh.toFixed(2)} m`
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
  ov.classList.toggle('aligning', aligning);
  ov.classList.toggle('scaling', allowScale);
  const a = PT[pivot].name, b = PT[target].name;
  $('pivBtn').textContent = `固定 ${a}`;
  $('tgtBtn').textContent = `向ける ${b}`;
  $('here').textContent = `◎ ${a} をここへ`;
  $('aim').textContent = `→ ${b} へ向ける`;
  $('add').textContent = `＋ ${b} を足す`;
  $('here').disabled = !lastHit;
  $('aim').disabled = !lastHit || !placed;
  $('add').disabled = !lastHit || !placed || PT.length < 3;
  $('near').disabled = !lastHit || !placed;
  $('clr').disabled = obs.size === 0;
  $('pick').disabled = !placed || !cloud;
  $('lock').disabled = !placed;
  $('scaleTgl').textContent = allowScale ? '拡大：あり' : '拡大：なし';

  let st;
  if (!aligning) st = '<span class="mode lock">固定中</span><b>画面に触ってもモデルは動きません</b><br>十字を当てた場所の座標が出ます。直すときは「位置合わせ」';
  else if (!lastHit) st = '<span class="mode adj">位置合わせ</span><b>地面を探しています…</b><br>スマホをゆっくり左右に動かしてください';
  else if (!placed) st = `<span class="mode adj">位置合わせ</span><b>十字を ${a} の印に合わせて「◎ ${a} をここへ」</b>`;
  else if (obs.size < 2) st = `<span class="mode adj">位置合わせ</span><b>十字を ${b} の印に合わせて「→ ${b} へ向ける」</b><br>画面をなぞる・ひねると ${a} を中心に回る。合ったら「固定する」`;
  else st = `<span class="mode adj">位置合わせ</span><b>記録 ${obs.size} 点。ほかの点も十字を当てて「＋ 足す」</b><br>十分に合ったら「固定する」`;
  $('step').innerHTML = st;
  $('info').textContent = placed
    ? `固定点 ${a}　向き ${(((theta / DEG) % 360 + 540) % 360 - 180).toFixed(1)}°　大きさ ${(s * 100).toFixed(1)}%${allowScale ? '' : '（実寸）'}`
    : '';
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
gest.addEventListener('pointerdown', e => {
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY }); g0 = gstate();
  tap0 = touches.size === 1 ? { x: e.clientX, y: e.clientY, t: performance.now() } : null;
});
gest.addEventListener('pointermove', e => {
  if (!touches.has(e.pointerId) || !placed || !aligning || picking) return;
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const g = gstate();
  if (g.n !== g0.n) { g0 = g; return; }
  if (g.n === 1) theta = g0.theta - (g.x - g0.x) * 0.15 * DEG;        // 右へなぞる＝右回り
  else {
    theta = g0.theta - (g.ang - g0.ang);
    if (allowScale) s = g0.s * g.dist / g0.dist;
  }
  apply();
});
const up = e => {
  touches.delete(e.pointerId); g0 = touches.size ? gstate() : null;
  if (picking && tap0 && e.type === 'pointerup' && performance.now() - tap0.t < 600
      && Math.hypot(e.clientX - tap0.x, e.clientY - tap0.y) < 15) pickAt(e.clientX, e.clientY);
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
  ray.params.Points.threshold = 0.15;
  const hits = ray.intersectObject(cloud, true);
  if (!hits.length) { $('check').className = 'bad'; $('check').textContent = '点群に当たりませんでした。点の上をタップしてください'; return; }
  const near = hits.filter(h => h.distance <= hits[0].distance + 1.0);       // いちばん手前のかたまりの中で
  const h = near.reduce((a, b) => (b.distanceToRay < a.distanceToRay ? b : a));
  const v = new THREE.Vector3().fromBufferAttribute(h.object.geometry.getAttribute('position'), h.index)
    .applyMatrix4(h.object.matrixWorld).applyMatrix4(tmpM.copy(group.matrixWorld).invert());
  const site = glToSite(v);
  const now = new Date();
  const pt = { name: `Q${++nPicked}`, ...site, picked: true,
    note: `点群から拾った点（${now.getMonth() + 1}/${now.getDate()} ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}）` };
  PT.push(pt); P.push(v); addFlag(pt, v);
  saveQ();
  addRow(pt);
  setPicking(false);
  setTarget(PT.length - 1);
  $('check').className = '';
  $('check').textContent = `${pt.name} を拾った（X ${site.x.toFixed(2)}　Y ${site.y.toFixed(2)}　標高 ${site.z.toFixed(2)}）。`
    + `十字を現実の同じ場所へ当てて「→ ${pt.name} へ向ける」か「＋ ${pt.name} を足す」`;
}
$('pick').onclick = () => setPicking(!picking);
$('cloud1').onclick = $('cloud2').onclick = () => setCloudSize((cloudSize + 1) % 3);
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
  renderer.domElement.style.display = 'block';
  await renderer.xr.setSession(session);
  refSpace = renderer.xr.getReferenceSpace();
  const viewer = await session.requestReferenceSpace('viewer');
  hitSource = await session.requestHitTestSource({ space: viewer });
  session.addEventListener('end', () => {
    hitSource = null; session = null; lastHit = null; reticle.visible = false;
    anchor = null; anchorOffset = null; anchorWant = false;
    placed = false; aligning = true; theta = 0; s = 1; obs.clear();
    overlay.classList.remove('on'); renderer.domElement.style.display = 'none';
    $('check').textContent = ''; $('live').textContent = '';
    apply();
  });
  apply();
}
$('start').onclick = () => startAR().catch(e => { $('support').textContent = 'AR を始められませんでした：' + e.message; });

// iPhone：Variant Launch の中で開き直すと WebXR が使える
function launchReady(d) {
  if (!d || !d.launchRequired) return false;
  $('start').textContent = 'AR を始める（iPhone：「開く」を押してください）';
  $('start').disabled = false;
  $('start').onclick = () => { location.href = d.launchUrl; };
  return true;
}
if (navigator.xr && await navigator.xr.isSessionSupported('immersive-ar').catch(() => false)) {
  $('start').disabled = false;
} else if (!launchReady(window.__vl)) {
  $('support').innerHTML = IS_IOS && VL_KEY
    ? '準備中です。少し待ってから再読み込みしてください。'
    : 'この端末・ブラウザでは AR を始められません（Android の Chrome・ARCore 対応機か、iPhone で開いてください）。';
  window.addEventListener('vlaunch-initialized', e => { if (launchReady(e.detail)) $('support').textContent = ''; });
}

// ---------- 毎フレーム ----------
const tmpM = new THREE.Matrix4();
renderer.setAnimationLoop((time, frame) => {
  if (frame && hitSource) {
    const hits = frame.getHitTestResults(hitSource);
    const had = !!lastHit;
    if (hits.length) {
      reticle.matrix.fromArray(hits[0].getPose(refSpace).transform.matrix);
      reticle.matrixWorldNeedsUpdate = true;
      reticle.visible = true;
      lastHit = new THREE.Vector3().setFromMatrixPosition(reticle.matrix);
    } else {
      reticle.visible = false;
      lastHit = null;
    }
    if (had !== !!lastHit) showUI();

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

    // 十字の位置を現場座標で
    if (placed && lastHit) {
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
    } else $('live').textContent = '';
  }
  renderer.render(scene, camera);
});
