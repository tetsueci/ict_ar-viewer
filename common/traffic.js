// 道路の上を車が走り続ける（config.json に "traffic" がある現場だけ読む。操作はできない）。
//   "traffic": { "file": "traffic.json", "speed": 60, "gap": 60 }
//     file  … tools/traffic_from_dxf.py が書く車線の線（lanes[].points＝現場座標 [x, y, z] の列。走る向きに並ぶ）
//     speed … 速さ（km/h）。gap … 車の間隔（m。車線の長さを割り切れるように少し変える）
// 時刻から位置を計算するだけなので、状態を持たない（どの端末でも同じ動き・止まっていても追いつく）。
// 端まで行くと始まりへ戻る。車は現場モデルの group の子なので、位置合わせ・固定・縮尺に一緒に従う。
const COLORS = [0xf2f2f2, 0xb8bcc2, 0x23262b, 0x2f5fa8, 0xa83232, 0xe8e4d8];

export async function initTraffic({ THREE, group, siteToGl, cfg, fetchBuf }) {
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

  // 車の形（X が前・地面が y=0・実寸 m）。下回り・車体・窓の 3 つの箱
  const part = (x, y, z, w, h, d, color, instanceColor) => {
    const g = new THREE.BoxGeometry(w, h, d).translate(x, y, z);
    const m = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1 }), total);
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (instanceColor) for (let i = 0; i < total; i++) m.setColorAt(i, new THREE.Color(COLORS[i * 7 % COLORS.length]));
    return m;
  };
  const root = new THREE.Group();
  root.name = 'traffic';
  const parts = [
    part(0, 0.22, 0, 3.8, 0.44, 1.6, 0x15171a, false),
    part(0, 0.72, 0, 4.4, 0.62, 1.75, 0xffffff, true),
    part(-0.25, 1.26, 0, 2.3, 0.5, 1.55, 0x20262e, false),
  ];
  parts.forEach(m => root.add(m));
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
          for (const m of parts) m.setMatrixAt(i, M);
        }
      }
      for (const m of parts) m.instanceMatrix.needsUpdate = true;
    },
  };
}
