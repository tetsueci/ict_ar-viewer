// EPT（Entwine Point Tile）の点群を、見ている所の近くだけ細かく読む（config.json の "ept"。2026-10-16）。
//
// ・ept.json の bounds（立方体）を 8 分木に割った節点ごとに .laz がある。粗い段の点＋細かい段の点を重ねて全体になる（足し算の作り）。
// ・見ている所（スマホの位置）からの距離と、その段の点の間隔から「画面で何画素ぶんの粗さか」を出し、粗く見えるものから細かい段を足す。
//   描く点の数の上限は BUDGET。縮尺 s を掛けた実際の距離で決めるので、縮めると自然に粗い段だけになる
// ・.laz は laz-perf（WebAssembly・jsDelivr）でほどく。座標は平面直角座標のまま入っていて、ここで origin を引く
// ・作るのは tools/las_to_ept.py
// ・classes（[2, 1] など分類の番号）を渡すと、節点ごとに点をその順に並べ、classOn()（真偽の並び）で出し分ける
//   （config.json の "cloudClasses" と "cloudLayers"。描く範囲 drawRange を変えるだけ。refreshClasses() で描き直す）
const LAZPERF = 'https://cdn.jsdelivr.net/npm/laz-perf@0.0.6/lib/web/';
const BUDGET = 1500000;                         // 描く点の上限（ある現場で 233 万点を描いたら熱くなって落ちた。93 万点は動いた）
const ANGLE = 0.003;                            // 点の間隔がこの角度（ラジアン・約 2 画素）より粗く見えたら細かい段を足す
const PARALLEL = 4;                             // 同時に読む数

export async function createEpt({ THREE, url, fetchBuf, origin, material, onRoot, onNode, classes = null, classOn = null }) {
  const base = url.replace(/[^/]*$/, '');
  const meta = JSON.parse(new TextDecoder().decode(await fetchBuf(url)));
  const hier = JSON.parse(new TextDecoder().decode(await fetchBuf(base + 'ept-hierarchy/0-0-0-0.json')));
  const [bx0, by0, bz0, bx1] = meta.bounds;
  const edge = bx1 - bx0, span = meta.span || 128;
  const ext = meta.dataType === 'laszip' ? '.laz' : null;
  if (!ext) throw new Error('EPT の dataType が laszip ではありません（' + meta.dataType + '）');

  const { default: createLazPerf } = await import(LAZPERF + 'laz-perf.js/+esm');
  const lp = await createLazPerf({ locateFile: f => LAZPERF + f });

  const group = new THREE.Group();
  const nodes = new Map();                      // key → { key, d, x, y, z, count, min:[3], obj, state: 0 未・1 読み中・2 済, used }
  for (const [key, count] of Object.entries(hier)) {
    if (count <= 0) continue;                    // −1（別の階層ファイル）はまだ扱わない（las_to_ept.py は 1 枚に全部書く）
    const [d, x, y, z] = key.split('-').map(Number);
    const size = edge / 2 ** d;
    nodes.set(key, { key, d, x, y, z, count, size, min: [bx0 + x * size, by0 + y * size, bz0 + z * size], obj: null, state: 0, used: 0 });
  }
  const childrenOf = n => {
    const out = [];
    for (let i = 0; i < 8; i++) {
      const c = nodes.get(`${n.d + 1}-${n.x * 2 + (i & 1)}-${n.y * 2 + ((i >> 1) & 1)}-${n.z * 2 + ((i >> 2) & 1)}`);
      if (c) out.push(c);
    }
    return out;
  };

  // .laz 1 つ → 位置（group の中の座標）と色
  function decode(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(buf);
    const fmt = dv.getUint8(104) & 0x3f;
    const sc = [dv.getFloat64(131, true), dv.getFloat64(139, true), dv.getFloat64(147, true)];
    const of = [dv.getFloat64(155, true), dv.getFloat64(163, true), dv.getFloat64(171, true)];
    const rgbAt = { 2: 20, 3: 28, 5: 28, 7: 30, 8: 30, 10: 30 }[fmt];
    const clsAt = fmt >= 6 ? 16 : 15;             // 分類のバイトの位置（形式 0〜5 は下位 5 ビット）
    const fp = lp._malloc(u8.length);
    lp.HEAPU8.set(u8, fp);
    const lz = new lp.LASZip();
    let pos, col, cls;
    try {
      lz.open(fp, u8.length);
      const n = lz.getCount(), len = lz.getPointLength();
      const pp = lp._malloc(len);
      pos = new Float32Array(n * 3);
      cls = new Uint8Array(n);
      const rgb = rgbAt !== undefined ? new Uint16Array(n * 3) : null;
      let big = 0;
      for (let i = 0; i < n; i++) {
        lz.getPoint(pp);
        const v = new DataView(lp.HEAPU8.buffer, pp, len);
        const X = v.getInt32(0, true) * sc[0] + of[0], Y = v.getInt32(4, true) * sc[1] + of[1], Z = v.getInt32(8, true) * sc[2] + of[2];
        pos[i * 3] = X - origin.x; pos[i * 3 + 1] = Z - origin.z; pos[i * 3 + 2] = -(Y - origin.y);   // 現場の座標 → glTF（Y 上）
        cls[i] = fmt >= 6 ? v.getUint8(clsAt) : v.getUint8(clsAt) & 31;
        if (rgb) {
          for (let k = 0; k < 3; k++) { const c = v.getUint16(rgbAt + k * 2, true); rgb[i * 3 + k] = c; if (c > big) big = c; }
        }
      }
      lp._free(pp);
      if (rgb) {                                 // 16 ビットの色も 8 ビットの色もある
        const div = big > 255 ? 257 : 1;
        col = new Uint8Array(rgb.length);
        for (let i = 0; i < rgb.length; i++) col[i] = rgb[i] / div;
      }
    } finally {
      lz.delete(); lp._free(fp);
    }
    return { pos, col, cls };
  }

  // 分類の順（classes）に点を並べ替え、分類ごとの [始め, 数] を返す（classes に無い分類はいちばん後ろ）
  function sortByClass(pos, col, cls) {
    const nb = classes.length + 1, n = cls.length;
    const bucket = new Uint8Array(n), cnt = new Array(nb).fill(0);
    for (let i = 0; i < n; i++) { const k = classes.indexOf(cls[i]); bucket[i] = k < 0 ? nb - 1 : k; cnt[bucket[i]]++; }
    const start = [], at = [];
    let acc = 0;
    for (let k = 0; k < nb; k++) { start.push(acc); at.push(acc); acc += cnt[k]; }
    const p2 = new Float32Array(pos.length), c2 = col ? new Uint8Array(col.length) : null;
    for (let i = 0; i < n; i++) {
      const j = at[bucket[i]]++;
      p2[j * 3] = pos[i * 3]; p2[j * 3 + 1] = pos[i * 3 + 1]; p2[j * 3 + 2] = pos[i * 3 + 2];
      if (c2) { c2[j * 3] = col[i * 3]; c2[j * 3 + 1] = col[i * 3 + 1]; c2[j * 3 + 2] = col[i * 3 + 2]; }
    }
    return { pos: p2, col: c2, ranges: start.map((s0, k) => [s0, cnt[k]]) };
  }
  // 出している分類だけを描く（並んだ分類のうち、出しているものの最初から最後まで）
  function applyClasses(n) {
    if (!n.obj || !n.ranges) return;
    const on = classOn ? classOn() : [];
    let a = -1, b = -1;
    n.ranges.forEach(([s0, c], k) => {
      const vis = k < classes.length ? on[k] !== false : true;   // classes に無い分類はいつも出す
      if (vis && c > 0) { if (a < 0) a = s0; b = s0 + c; }
    });
    n.obj.geometry.setDrawRange(a < 0 ? 0 : a, a < 0 ? 0 : b - a);
  }

  let loading = 0, shown = 0, onRootDone = false;
  const want = [];
  async function load(n) {
    n.state = 1; loading++;
    try {
      let { pos, col, cls } = decode(await fetchBuf(base + 'ept-data/' + n.key + ext));
      if (classes) ({ pos, col, ranges: n.ranges } = sortByClass(pos, col, cls));
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
      g.computeBoundingSphere();
      n.obj = new THREE.Points(g, material);
      n.obj.renderOrder = 0.5;                   // 重機など（0）の後・モデル（1）の前（点群は奥行きを書かない）
      n.obj.userData.eptDepth = n.d;
      n.obj.visible = n.used === tick;   // 読んでいるあいだに選ばれなくなったら隠す
      applyClasses(n);
      group.add(n.obj);
      n.state = 2;
      onNode?.(n.obj, n.d);
      if (!onRootDone && n.d === 0) { onRootDone = true; onRoot?.(); }
    } catch (e) {
      n.state = 3;                               // 読めなかった節点は二度と読まない
    } finally {
      loading--; pump();
    }
  }
  function pump() {
    while (loading < PARALLEL && want.length) {
      const n = want.shift();
      if (n.state === 0) load(n);
    }
  }

  // 箱までの距離（現場の座標・m）
  const distTo = (n, c) => {
    const dx = Math.max(n.min[0] - c.x, 0, c.x - n.min[0] - n.size);
    const dy = Math.max(n.min[1] - c.y, 0, c.y - n.min[1] - n.size);
    const dz = Math.max(n.min[2] - c.z, 0, c.z - n.min[2] - n.size);
    return Math.hypot(dx, dy, dz);
  };

  let tick = 1;
  /** cam：スマホの位置（現場の座標）。s：縮尺。range：描く範囲（実際の m。null＝全部） */
  function update(cam, s, range) {
    tick++;
    const root = nodes.get('0-0-0-0');
    if (!root) return;
    const sel = [];
    let total = 0;
    const heap = [root];
    while (heap.length) {
      heap.sort((a, b) => b.pri - a.pri);
      const n = heap.shift();
      if (total + n.count > BUDGET && n !== root) continue;
      sel.push(n); total += n.count;
      for (const c of childrenOf(n)) {
        const dist = distTo(c, cam) * s;
        if (range && dist > range) continue;     // 範囲の外は細かい段を読まない
        const spacing = c.size / span * s * 2;  // 親の段の点の間隔（実際の m）。これが粗く見えるなら子を足す
        c.pri = spacing / Math.max(dist, 0.3);
        if (c.pri > ANGLE) heap.push(c);
      }
    }
    for (const n of sel) n.used = tick;
    shown = 0;
    for (const n of nodes.values()) {
      const on = n.used === tick;
      if (n.obj) { n.obj.visible = on; if (on) shown += n.count; }
    }
    want.length = 0;
    sel.filter(n => n.state === 0).sort((a, b) => a.d - b.d).forEach(n => want.push(n));
    pump();
    // 使っていない節点が多くなったら、古いものから捨てる（スマホのメモリ）
    let kept = 0;
    for (const n of nodes.values()) if (n.obj) kept += n.count;
    if (kept > BUDGET * 2) {
      for (const n of [...nodes.values()].filter(n => n.obj && n.used !== tick && n.d > 0).sort((a, b) => a.used - b.used)) {
        group.remove(n.obj); n.obj.geometry.dispose(); n.obj = null; n.state = 0;
        kept -= n.count;
        if (kept <= BUDGET * 1.5) break;
      }
    }
  }
  // まず粗い段（段 0）を読む
  const root = nodes.get('0-0-0-0');
  if (root) { root.used = tick; want.push(root); pump(); }
  const refreshClasses = () => { for (const n of nodes.values()) applyClasses(n); };
  return { group, update, refreshClasses, info: () => ({ shown, loading, nodes: nodes.size }) };
}
