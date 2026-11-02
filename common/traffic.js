// 道路の上を車が走り続ける（config.json に "traffic" がある現場だけ読む。操作はできない）。
//   "traffic": { "file": "traffic.json", "speed": 60, "gap": 60 }
//     file  … tools/traffic_from_dxf.py が書く車線の線（lanes[].points＝現場座標 [x, y, z] の列。走る向きに並ぶ）
//     speed … 速さ（km/h）。gap … 車の間隔（m。車線の長さを割り切れるように少し変える）
// 時刻から位置を計算するだけなので、状態を持たない（どの端末でも同じ動き・止まっていても追いつく）。
// 端まで行くと始まりへ戻る。車は現場モデルの group の子なので、位置合わせ・固定・縮尺に一緒に従う。
const COLORS = [0xf2f2f2, 0xb8bcc2, 0x23262b, 0x2f5fa8, 0xa83232, 0xe8e4d8];

export async function initTraffic({ THREE, group, siteToGl, cfg, fetchBuf, loader }) {
  const T = cfg.traffic;
  const data = JSON.parse(new TextDecoder().decode(await fetchBuf(T.file)));
  const v = (T.speed || 60) / 3.6;                     // m/秒
  const gap = T.gap || 60;
  const lanes = data.lanes.map((l, i) => {
    const P = l.points.map(p => siteToGl({ x: p[0], y: p[1], z: p[2] }));
    const S = [0];
    for (let k = 1; k < P.length; k++) S.push(S[k - 1] + P[k].distanceTo(P[k - 1]));
    const L = S[S.length - 1];
    const n = Math.max(1, Math.round(L / gap));
    return { P, S, L, n, phase: gap * 0.37 * i };       // 車線ごとにずらす（横に並ばないように）
  });
  const total = lanes.reduce((a, l) => a + l.n, 0);

  // 車の形は cars.glb（tools/cars_from_obj.py が作る。X が前・地面が y=0・実寸 m）。
  // 1 台＝車体（1 台ずつ色を付ける）とその他（窓・タイヤ）。車種ごとに InstancedMesh を作る
  const url = new URL('cars.glb' + new URL(import.meta.url).search, import.meta.url).href;
  const kinds = (await loader.loadAsync(url)).scene.children.filter(o => o.isGroup || o.isMesh);
  const counts = kinds.map(() => 0);
  const slots = [];                                     // 車 1 台ごとに [車種, その車種の中の番号]
  for (let i = 0; i < total; i++) { const c = i * 3 % kinds.length; slots.push([c, counts[c]++]); }
  const root = new THREE.Group();
  root.name = 'traffic';
  const meshes = kinds.map((o, c) => {
    const prims = o.isMesh ? [o] : o.children;
    return prims.map(p => {
      const body = p.material.name === 'body';
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: body ? 0.45 : 0.7, metalness: 0.1 });
      const m = new THREE.InstancedMesh(p.geometry, mat, Math.max(1, counts[c]));
      m.count = counts[c];
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      root.add(m);
      return { m, body };
    });
  });
  slots.forEach(([c, j], i) => {
    for (const { m, body } of meshes[c]) if (body) m.setColorAt(j, new THREE.Color(COLORS[i * 7 % COLORS.length]));
  });
  group.add(root);

  const a = new THREE.Vector3(), b = new THREE.Vector3(), x = new THREE.Vector3();
  const y = new THREE.Vector3(), z = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  const M = new THREE.Matrix4();
  function at(l, d, out) {                              // 線の上の距離 d の点（端を越えたら反対の端から）
    d = ((d % l.L) + l.L) % l.L;
    let lo = 0, hi = l.S.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (l.S[m] <= d) lo = m; else hi = m; }
    const t = (d - l.S[lo]) / Math.max(1e-6, l.S[hi] - l.S[lo]);
    return out.lerpVectors(l.P[lo], l.P[hi], t);
  }
  return {
    setVisible(on) { root.visible = !!on; },
    tick(time) {                                        // time はミリ秒
      if (!root.visible) return;
      const run = time / 1000 * v;
      let i = 0;
      for (const l of lanes) {
        const step = l.L / l.n;
        for (let k = 0; k < l.n; k++, i++) {
          const d = run + l.phase + k * step;
          at(l, d - 1.4, a); at(l, d + 1.4, b);         // 前後の 2 点から位置と向き（坂では前後が傾く）
          x.subVectors(b, a).normalize();
          z.crossVectors(x, UP).normalize();
          y.crossVectors(z, x);
          M.makeBasis(x, y, z);
          M.setPosition(a.add(b).multiplyScalar(0.5));
          const [c, j] = slots[i];
          for (const { m } of meshes[c]) m.setMatrixAt(j, M);
        }
      }
      for (const list of meshes) for (const { m } of list) m.instanceMatrix.needsUpdate = true;
    },
  };
}
