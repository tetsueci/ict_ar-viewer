// 机の上ですぐ見る AR（2026-10-09）。QR から開き、タップ 1 回で AR を始めると、
// 机が見つかって画面の真ん中が落ち着いたところへ、縮めたモデルを自動で置く。ほかの操作は無い。
//   1 本指でなぞる＝机の上で動かす　2 本指でひねる＝回す　「置き直す」＝画面の真ん中へもう一度置く
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
const go = $('go'), title = go.querySelector('b'), sub = $('sub'), ov = $('ov'), msg = $('msg');
const fail = t => { title.textContent = t; go.disabled = true; };
if (!/^\/[^/]/.test(DIR) || DIR.includes('..')) { fail('URL の d が正しくありません'); throw new Error('bad d'); }
const base = new URL(DIR.endsWith('/') ? DIR : DIR + '/', location.origin);
sub.textContent = `縮尺 1/${Math.round(1 / SCALE)}`;

// ---------- three.js ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local');
renderer.domElement.style.display = 'none';
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.01, 100);
scene.add(new THREE.HemisphereLight(0xffffff, 0x777766, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(3, 8, 2); scene.add(sun);

const holder = new THREE.Group();       // 机の上の置き場所と向き
const model = new THREE.Group();        // 縮めたモデル（置き場所の中心・底が holder の原点）
holder.add(model); holder.visible = false; scene.add(holder);
const reticle = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.04, 40).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xffd43b }));
reticle.matrixAutoUpdate = false; reticle.visible = false; scene.add(reticle);

// ---------- 読む ----------
let ready = false;
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
  // 外接箱の真ん中（水平）と底を原点にする
  const box = new THREE.Box3().setFromObject(raw);
  const c = box.getCenter(new THREE.Vector3());
  raw.position.set(-c.x, -box.min.y, -c.z);
  model.add(raw);
  model.scale.setScalar(SCALE);
  const sz = box.getSize(new THREE.Vector3()).multiplyScalar(SCALE * 100);
  sub.textContent = `縮尺 1/${Math.round(1 / SCALE)}　机の上で 約 ${sz.x.toFixed(0)} × ${sz.z.toFixed(0)} cm`;
  ready = true;
  paint();
})().catch(e => fail('読めませんでした：' + e.message));

// ---------- AR を始める ----------
let xrOK = false;
function paint() {
  if (go.disabled) return;
  title.textContent = !ready ? '読み込んでいます…'
    : xrOK ? 'タップで AR を始める'
    : window.__vl?.launchRequired ? 'タップで開く（iPhone）'
    : (typeof IS_IOS !== 'undefined' && IS_IOS && VL_KEY) ? '準備しています…'
    : 'この端末では AR を始められません';
}
if (navigator.xr) xrOK = await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
window.addEventListener('vlaunch-initialized', paint);
paint();

let session = null, hitSrc = null, viewerSpace = null;
go.onclick = async () => {
  if (!ready) return;
  if (!xrOK && window.__vl?.launchRequired) { location.href = window.__vl.launchUrl; return; }
  if (!xrOK) return;
  try {
    session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'], optionalFeatures: ['local', 'dom-overlay'], domOverlay: { root: ov },
    });
  } catch (e) { title.textContent = 'AR を始められませんでした：' + e.message; return; }
  renderer.xr.setSession(session);
  viewerSpace = await session.requestReferenceSpace('viewer');
  hitSrc = await session.requestHitTestSource({ space: viewerSpace });
  go.hidden = true; ov.hidden = false; renderer.domElement.style.display = '';
  place();
  session.addEventListener('end', () => {
    session = hitSrc = null; holder.visible = reticle.visible = false;
    go.hidden = false; ov.hidden = true; renderer.domElement.style.display = 'none';
  });
};

// ---------- 置く：画面の真ん中の机が 0.8 秒落ち着いたら自動で置く ----------
let placing = true, still = null;
const pHit = new THREE.Vector3(), mHit = new THREE.Matrix4();
function place() { placing = true; still = null; holder.visible = false; msg.textContent = '机（QR）に向けて、少し止めてください'; }
$('again').onclick = place;
$('end').onclick = () => session?.end();

renderer.setAnimationLoop((time, frame) => {
  if (frame && hitSrc) {
    const hits = frame.getHitTestResults(hitSrc);
    const pose = hits.length ? hits[0].getPose(renderer.xr.getReferenceSpace()) : null;
    if (placing) {
      reticle.visible = !!pose;
      if (pose) {
        mHit.fromArray(pose.transform.matrix); reticle.matrix.copy(mHit);
        pHit.setFromMatrixPosition(mHit);
        if (!still || still.p.distanceTo(pHit) > 0.01) still = { p: pHit.clone(), t: time };
        else if (time - still.t > 800) {
          holder.position.copy(pHit);
          const cam = renderer.xr.getCamera();       // 初めの向き：モデルの北を画面の奥へ
          const f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
          holder.rotation.set(0, Math.atan2(-f.x, -f.z), 0);
          holder.visible = true; reticle.visible = false; placing = false;
          msg.textContent = '1 本指で動かす・2 本指でひねって回す';
        }
      } else still = null;
    }
  }
  renderer.render(scene, camera);
});

// ---------- 指 ----------
const touches = new Map();
let g0 = null;
const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function onDesk(x, y) {
  ray.setFromCamera(new THREE.Vector2(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1), renderer.xr.getCamera());
  plane.constant = -holder.position.y;
  return ray.ray.intersectPlane(plane, new THREE.Vector3());
}
function state() {
  const t = [...touches.values()];
  if (t.length >= 2) return { n: 2, a: Math.atan2(t[1].y - t[0].y, t[1].x - t[0].x), r: holder.rotation.y };
  return { n: 1, x: t[0].x, y: t[0].y };
}
ov.addEventListener('pointerdown', e => {
  if (e.target.tagName === 'BUTTON') return;
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY }); g0 = state();
});
ov.addEventListener('pointermove', e => {
  if (!touches.has(e.pointerId) || placing) return;
  const prev = touches.get(e.pointerId);
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const g = state();
  if (g.n !== g0.n) { g0 = g; return; }
  if (g.n === 2) holder.rotation.y = g0.r - (g.a - g0.a);
  else {
    const a = onDesk(prev.x, prev.y), b = onDesk(e.clientX, e.clientY);
    if (a && b) holder.position.add(b.sub(a));
  }
});
const up = e => { touches.delete(e.pointerId); g0 = touches.size ? state() : null; };
ov.addEventListener('pointerup', up); ov.addEventListener('pointercancel', up);
