// 机の上ですぐ見る 3D（2026-10-09）。QR から開くと、カメラの映像は出さずに縮めた 3D モデルだけをすぐ出す。
//   開いてすぐ：スマホの傾きで見回せる（向きだけ。Android）。1 本指でなぞる・2 本指でひねる＝モデルを回す
//   「スマホを動かして見る」（タップ 1 回。ブラウザは人のタップが無いとこれを始めさせない）：
//     スマホの位置も追う（WebXR）。近づく・回り込むと見え方が変わる。カメラの映像は空と床で隠す
// URL：?d=/リポジトリ/フォルダ/（config.json の model・pointcloud を読む。同じサイトの中だけ）
//      &s=100（縮尺の分母。既定 100）&p=0.3（点群の何割を描くか。既定 0.3）
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/+esm';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/GLTFLoader.js/+esm';
import { MeshoptDecoder } from 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/meshopt_decoder.module.js/+esm';

const $ = id => document.getElementById(id);
const Q = new URLSearchParams(location.search);
const DIR = Q.get('d') || '';
const SCALE = 1 / (parseFloat(Q.get('s')) > 0 ? parseFloat(Q.get('s')) : 100);
const PART = Math.min(1, parseFloat(Q.get('p')) > 0 ? parseFloat(Q.get('p')) : 0.3);
const ov = $('ov'), msg = $('msg'), go = $('go');
if (!/^\/[^/]/.test(DIR) || DIR.includes('..')) { msg.textContent = 'URL の d が正しくありません'; throw new Error('bad d'); }
const base = new URL(DIR.endsWith('/') ? DIR : DIR + '/', location.origin);

// ---------- three.js ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local');
document.body.insertBefore(renderer.domElement, ov);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.01, 200);
scene.add(new THREE.HemisphereLight(0xffffff, 0x777766, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(3, 8, 2); scene.add(sun);
addEventListener('resize', () => {
  if (renderer.xr.isPresenting) return;
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
});

// 空（カメラの映像を隠す。AR の画面は背景色を透かすので、色ではなく大きな球で包む）
{
  const g = new THREE.SphereGeometry(80, 32, 16), c = [], p = g.getAttribute('position');
  const top = new THREE.Color(0x8fb4dc), bot = new THREE.Color(0xe9eef3);
  for (let i = 0; i < p.count; i++) { const t = Math.max(0, p.getY(i) / 80); const k = bot.clone().lerp(top, t); c.push(k.r, k.g, k.b); }
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  const sky = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, depthWrite: false }));
  sky.renderOrder = -1;
  sky.onBeforeRender = (r, s, cam) => sky.position.setFromMatrixPosition(cam.matrixWorld);   // いつもスマホを中心に
  scene.add(sky);
}

const holder = new THREE.Group();       // 置き場所と向き（原点＝モデルの外接箱の真ん中・底）
const model = new THREE.Group();
holder.add(model); scene.add(holder);
let size = 1;                           // 縮めたあとの大きさ（m・水平の長いほう）
let ready = false;

// ---------- 読む ----------
(async () => {
  const cfg = await (await fetch(new URL('config.json', base) + '?v=' + Date.now())).json();
  if (cfg.enc) throw new Error('暗号化した現場は開けません');
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const url = f => new URL(f, base) + '?v=' + (cfg.version || Date.now());
  const raw = new THREE.Group();
  const jobs = [];
  if (cfg.model) jobs.push(loader.loadAsync(url(cfg.model)).then(g => raw.add(g.scene)));
  if (cfg.pointcloud) jobs.push(loader.loadAsync(url(cfg.pointcloud)).then(g => {
    g.scene.traverse(o => {
      if (!o.isPoints) return;
      o.material = new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true });
      o.geometry.setDrawRange(0, Math.ceil(o.geometry.getAttribute('position').count * PART));   // 点は混ぜてあるので前から取れば間引ける
    });
    raw.add(g.scene);
  }));
  await Promise.all(jobs);
  const box = new THREE.Box3().setFromObject(raw);
  const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
  raw.position.set(-c.x, -box.min.y, -c.z);
  model.add(raw);
  model.scale.setScalar(SCALE);
  size = Math.max(sz.x, sz.z) * SCALE;
  // 床（モデルの下に、模型の台のような板と升目）
  const fl = new THREE.Mesh(new THREE.CircleGeometry(size * 0.75, 64).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: 0xb9c2cc }));
  fl.position.y = -0.002; holder.add(fl);
  const grid = new THREE.GridHelper(size * 1.5, 30, 0x8893a0, 0x9aa4b0); grid.position.y = -0.001; holder.add(grid);
  ready = true;
  viewPlace();
  msg.textContent = `縮尺 1/${Math.round(1 / SCALE)}（約 ${(sz.x * SCALE * 100).toFixed(0)} × ${(sz.z * SCALE * 100).toFixed(0)} cm）　なぞる・ひねる＝回す`;
  paint();
})().catch(e => { msg.textContent = '読めませんでした：' + e.message; });

// 見る位置：モデルの手前・少し上から（開いてすぐの画面）
// 開いてすぐの画面は縦長で横が狭いので遠めに。動かして見るときは近め（歩いて寄れる）
const dist = () => Math.max(0.5, size * (renderer.xr.isPresenting ? 0.7 : 1.3));
function viewPlace() {
  holder.position.set(0, -dist() * 0.6, -dist());
  camera.position.set(0, 0, 0);
}

// ---------- 開いてすぐ：スマホの傾きで見回す（向きだけ） ----------
// deviceorientation の向き → カメラの向き。初めに受けた向きで画面の正面がモデルを向くようにそろえる
const zee = new THREE.Vector3(0, 0, 1), eul = new THREE.Euler(), q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
const qDev = new THREE.Quaternion(), qBase = new THREE.Quaternion(), qLook = new THREE.Quaternion();
let ori = null, based = false;
addEventListener('deviceorientation', e => { if (e.alpha != null) ori = e; });
// iPhone は傾きを読むのに許可が要る（タップで聞く。Safari の決まり）。許可されたらボタンを消す
const DO = window.DeviceOrientationEvent;
if (DO && typeof DO.requestPermission === 'function' && typeof IS_IOS !== 'undefined' && IS_IOS) {   // Chrome にも関数はあるが、許可を聞かずに傾きを送ってくる
  const b = $('tilt');
  b.hidden = false;
  b.onclick = async () => {
    const r = await DO.requestPermission().catch(() => 'denied');
    if (r === 'granted') b.hidden = true;
    else b.textContent = '傾きが使えません（設定で許可）';
  };
}
function deviceQuat() {
  const a = THREE.MathUtils.degToRad(ori.alpha), b = THREE.MathUtils.degToRad(ori.beta), g = THREE.MathUtils.degToRad(ori.gamma);
  const o = THREE.MathUtils.degToRad(screen.orientation?.angle || 0);
  eul.set(b, a, -g, 'YXZ');
  qDev.setFromEuler(eul).multiply(q1).multiply(new THREE.Quaternion().setFromAxisAngle(zee, -o));
  return qDev;
}
function lookDefault() { camera.lookAt(holder.position.x, holder.position.y + size * 0.05, holder.position.z); }

// ---------- スマホを動かして見る（WebXR。位置も追う） ----------
let xrOK = false, session = null;
function paint() {
  go.hidden = !ready || !!session;
  go.textContent = xrOK ? 'スマホを動かして見る'
    : window.__vl?.launchRequired ? 'スマホを動かして見る（iPhone：開く）'
    : (typeof IS_IOS !== 'undefined' && IS_IOS && VL_KEY && !window.__vl) ? 'スマホを動かして見る（準備しています…）'
    : 'スマホを動かして見る（この端末は不可）';
  go.disabled = !xrOK && !window.__vl?.launchRequired;
  $('again').hidden = $('end').hidden = !session;
  if (session) $('tilt').hidden = true;
}
if (navigator.xr) xrOK = await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
addEventListener('vlaunch-initialized', paint);
paint();

let placeNext = false;
go.onclick = async () => {
  if (!xrOK && window.__vl?.launchRequired) { location.href = window.__vl.launchUrl; return; }
  if (!xrOK) return;
  try {
    session = await navigator.xr.requestSession('immersive-ar', { optionalFeatures: ['local', 'dom-overlay'], domOverlay: { root: ov } });
  } catch (e) { msg.textContent = '始められませんでした：' + e.message; return; }
  renderer.xr.setSession(session);
  placeNext = true;
  msg.textContent = '近づく・回り込むと見え方が変わる　1 本指で動かす・2 本指で回す';
  paint();
  session.addEventListener('end', () => { session = null; viewPlace(); based = false; paint(); });
};
$('again').onclick = () => { placeNext = true; };
$('end').onclick = () => session?.end();

// スマホの正面・少し下へ置く（向きはモデルの北が奥）
const vF = new THREE.Vector3(), vP = new THREE.Vector3();
function placeInFront(cam) {
  cam.getWorldPosition(vP);
  vF.set(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion())); vF.y = 0;
  if (vF.lengthSq() < 1e-6) vF.set(0, 0, -1);
  vF.normalize();
  holder.position.copy(vP).addScaledVector(vF, dist()); holder.position.y = vP.y - dist() * 0.6;
  holder.rotation.set(0, Math.atan2(-vF.x, -vF.z), 0);
}

renderer.setAnimationLoop(() => {
  if (renderer.xr.isPresenting) {
    if (placeNext) { placeNext = false; placeInFront(renderer.xr.getCamera()); }
  } else if (ori) {
    deviceQuat();
    if (!based) {                                // 初めの向き：正面がモデルを向く（水平の向きだけそろえる）
      lookDefault(); qLook.copy(camera.quaternion);
      const yawDev = new THREE.Euler().setFromQuaternion(qDev, 'YXZ').y;
      qBase.setFromAxisAngle(new THREE.Vector3(0, 1, 0), new THREE.Euler().setFromQuaternion(qLook, 'YXZ').y - yawDev);
      based = true;
    }
    camera.quaternion.copy(qBase).multiply(qDev);
  } else lookDefault();
  renderer.render(scene, camera);
});

// ---------- 指 ----------
const touches = new Map();
let g0 = null;
const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function onFloor(x, y) {
  ray.setFromCamera(new THREE.Vector2(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1), renderer.xr.isPresenting ? renderer.xr.getCamera() : camera);
  plane.constant = -holder.position.y;
  return ray.ray.intersectPlane(plane, new THREE.Vector3());
}
function state() {
  const t = [...touches.values()];
  if (t.length >= 2) return { n: 2, a: Math.atan2(t[1].y - t[0].y, t[1].x - t[0].x), r: holder.rotation.y };
  return { n: 1, x: t[0].x, r: holder.rotation.y };
}
ov.addEventListener('pointerdown', e => {
  if (e.target.tagName === 'BUTTON') return;
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY }); g0 = state();
});
ov.addEventListener('pointermove', e => {
  if (!touches.has(e.pointerId)) return;
  const prev = touches.get(e.pointerId);
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const g = state();
  if (g.n !== g0.n) { g0 = g; return; }
  if (g.n === 2) holder.rotation.y = g0.r - (g.a - g0.a);
  else if (renderer.xr.isPresenting) {           // 動かして見ているとき：1 本指＝床の上で動かす
    const a = onFloor(prev.x, prev.y), b = onFloor(e.clientX, e.clientY);
    if (a && b) holder.position.add(b.sub(a));
  } else holder.rotation.y = g0.r + (g.x - g0.x) * 0.01;   // 開いてすぐ：1 本指でなぞる＝回す
});
const up = e => { touches.delete(e.pointerId); g0 = touches.size ? state() : null; };
ov.addEventListener('pointerup', up); ov.addEventListener('pointercancel', up);
