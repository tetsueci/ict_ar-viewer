// 現場 AR に重機を置いて動かす（config.json に "machines" がある現場だけ。align.js が読む）
//
// 重機の形・数字・動きの正は ict_kenki-ar（https://tetsueci.github.io/ict_kenki-ar/）。
// ここには写さず、同じ tetsueci.github.io から読む（machines/*.json・models/<機械>/*.glb・src/*.js）。
// 重機は現場モデルのかたまり（group）の子に置くので、2 点合わせ・固定・縮尺に一緒に従う。
//
// config.json の書き方：
//   "machines": [ { "id": "backhoe08" } ]                                  … AR の中で「重機を置く」→ モデルか点群をタップして置く
//   "machines": [ { "id": "backhoe08", "x": 0, "y": 0, "z": 0, "heading": 0 } ]  … 現場の座標に置いておく
//   heading は CAD と同じく東から左回りの角度（°）。"kenkiBase" で読み先を変えられる
const KENKI = 'https://tetsueci.github.io/ict_kenki-ar/';

export async function initMachines(api) {
  const { THREE, loader, group, siteToGl, cfg, getCamera, getTargets, setPlacing } = api;
  const base = cfg.kenkiBase || KENKI;
  const list = (Array.isArray(cfg.machines) ? cfg.machines : []).filter(m => m && m.id);
  if (!list.length) return;

  const [{ poseBackhoe }, { poseRoughTerrainCrane }, { poseCrawlerCrane }, { ratedLoad }] = await Promise.all([
    import(base + 'src/backhoe.js'), import(base + 'src/rcrane.js'),
    import(base + 'src/ccrane.js'), import(base + 'src/load.js'),
  ]);
  const KINEMATICS = { backhoe: poseBackhoe, rough_terrain_crane: poseRoughTerrainCrane, crawler_crane: poseCrawlerCrane };
  const getJson = async u => (await fetch(base + u, { cache: 'no-cache' })).json();

  // 色は ict_kenki-ar と同じ分け方（部品名で 3 色）
  const CYAN = new THREE.MeshStandardMaterial({ color: 0x18c6c6, roughness: .7, metalness: .15 });
  const GREY = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: .8, metalness: .1 });
  const DARK = new THREE.MeshStandardMaterial({ color: 0x4e545c, roughness: .85, metalness: .1 });
  const matOf = n => (/^(body|outrigger|plate|foot)/.test(n) ? DARK : /^(cabin|boom\d|jib)/.test(n) ? CYAN : GREY);
  const COPIES = { 'outrigger': 'outrigger', 'outrigger-foot': 'foot', 'outrigger-base': 'plate' };

  // CAD（Z 上・mm）→ 現場の glTF（Y 上・m）。x はそのまま、y＝CAD の z、z＝−CAD の y（align.js の siteToGl と同じ向き）
  const CAD = new THREE.Matrix4().set(0.001, 0, 0, 0, 0, 0, 0.001, 0, 0, -0.001, 0, 0, 0, 0, 0, 1);

  const units = [];
  for (const def of list) {
    const M = await getJson(`machines/${def.id}.json`);
    const pose = KINEMATICS[M.type];
    if (!pose) continue;
    let LOAD = null;
    if (M.load) try { LOAD = await getJson(M.load); } catch (e) { LOAD = null; }
    const root = new THREE.Group();             // 置く位置と向き（現場の glTF の座標）
    root.visible = false;
    const body = new THREE.Group();             // CAD → glTF
    body.matrixAutoUpdate = false; body.matrix.copy(CAD);
    root.add(body);
    group.add(root);
    const nodes = {};
    if (M.models) {
      const parts = await getJson(M.models + '_parts.json');
      await Promise.all(Object.entries(parts).map(async ([name, info]) => {
        if (M.parts && !M.parts.includes(name)) return;
        const g = await loader.loadAsync(base + M.models + info.file);
        g.scene.traverse(c => { if (c.isMesh) c.material = matOf(name); });
        const put = (key, obj) => {
          const o = new THREE.Group();
          o.add(obj); o.matrixAutoUpdate = false; o.visible = false;
          body.add(o); nodes[key] = o;
        };
        if (name in COPIES) for (const s of ['fr', 'fl', 'br', 'bl']) put(COPIES[name] + '_' + s, g.scene.clone(true));
        else put(name, g.scene);
      }));
    }
    // 初めの姿勢（ict_kenki-ar の index.html と同じ）
    let st;
    if (M.type === 'rough_terrain_crane') st = { outrigger: M.limits.outrigger_min, angleCabin: 0, angleBoom: 45, lengthBoom: M.limits.length_boom_min, lengthWire: 10, ratioAllow: 80 };
    else if (M.type === 'backhoe') st = { angleCabin: 0, angleBoom: 30, angleArm: -100, angleBucket: 30, bucketType: 0 };
    else st = { boomType: 0, angleCabin: 0, angleBoom: 60, lengthWire: 10, ratioAllow: 80 };
    const u = { def, M, pose, LOAD, root, nodes, st, heading: +def.heading || 0, readout: '' };
    // 向き（車体ごと）はスライダーの先頭に足す
    u.controls = [{ key: '_heading', label: '車体の向き', unit: '°', min: -180, max: 180, step: 1 }, ...M.controls];
    if (Number.isFinite(def.x) && Number.isFinite(def.y)) {
      root.position.copy(siteToGl({ x: def.x, y: def.y, z: +def.z || 0 }));
      root.visible = true;
    }
    units.push(u);
    poseUnit(u);
  }
  if (!units.length) return;

  function poseUnit(u) {
    u.root.rotation.set(0, u.heading * Math.PI / 180, 0);
    const r = u.pose(u.M, u.st, { point: [0, 0, 0], angle: 0, normal: [0, 0, 1] });
    for (const [name, o] of Object.entries(u.nodes)) {
      const mx = r.parts[name];
      o.visible = !!mx && !(r.hidden && r.hidden.includes(name));
      if (mx) o.matrix.fromArray(mx);
    }
    const out = r.readouts ? r.readouts.slice()
      : [`作業半径 ${(r.radius / 1000).toFixed(2)}m`, `先端高さ ${(r.tip[2] / 1000).toFixed(2)}m`];
    if (u.LOAD) {
      const rl = ratedLoad(u.LOAD, { outrigger: u.st.outrigger, radius: r.radius / 1000, boomLength: u.st.lengthBoom });
      const w = u.LOAD.unitWeight || 't';
      out.push(`定格荷重 ${rl.text}`);
      out.push(rl.value === null ? '許容荷重 －' : `許容荷重 ${(rl.value * (u.st.ratioAllow ?? 100) / 100).toFixed(2)}${w}（${u.st.ratioAllow ?? 100}%）`);
    }
    u.readout = out.join('　');
  }

  // ---------- 操作盤（「重機」ボタンで開く。スライダーは 1 本、何を動かすかはドロップダウン） ----------
  const panel = document.querySelector('#overlay .panel');
  const lockRow = document.getElementById('lock').closest('.row');
  const wrap = document.createElement('div');
  wrap.id = 'mcpanel';
  wrap.innerHTML = `
    <div class="row" id="mcbar">
      <button id="mctgl">重機 ▲</button>
      <select id="mcsel"></select>
      <button id="mchere" disabled>重機を置く</button>
    </div>
    <div class="row mcbody"><select id="mcctl"></select><input id="mcval" type="range"><span id="mcnum" class="mcnum"></span></div>
    <div class="row mcbody"><span id="mcread" class="mcread"></span></div>`;
  panel.insertBefore(wrap, lockRow);
  const $ = id => document.getElementById(id);
  units.forEach((u, i) => {
    const o = document.createElement('option');
    o.value = i; o.textContent = u.M.short || u.M.title || u.def.id;
    $('mcsel').appendChild(o);
  });
  if (units.length < 2) $('mcsel').hidden = true;
  let cur = 0, ctl = 0, open = false, placing = false;
  const unit = () => units[cur];
  const getv = (u, c) => (c.key === '_heading' ? u.heading : u.st[c.key]);
  function fillControls() {
    const u = unit();
    $('mcctl').innerHTML = '';
    u.controls.forEach((c, i) => {
      const o = document.createElement('option');
      o.value = i; o.textContent = c.label;
      $('mcctl').appendChild(o);
    });
    if (ctl >= u.controls.length) ctl = 0;
    $('mcctl').value = ctl;
    pickControl();
  }
  function pickControl() {
    const u = unit(), c = u.controls[ctl], inp = $('mcval');
    const choice = c.type === 'choice';
    inp.min = choice ? 0 : c.min;
    inp.max = choice ? u.M[c.from].length - 1 : c.max;
    inp.step = choice ? 1 : c.step;
    inp.value = getv(u, c);
    showValue();
  }
  function showValue() {
    const u = unit(), c = u.controls[ctl], v = getv(u, c);
    $('mcnum').textContent = c.type === 'choice' ? u.M[c.from][v].name : (+v).toFixed((c.step || 1) < 1 ? 1 : 0) + (c.unit || '');
    $('mcread').textContent = placing ? 'モデルか点群の、重機を置きたい所をタップしてください'
      : u.root.visible ? u.readout : '「重機を置く」→ モデルか点群の置きたい所をタップ';
  }
  $('mcsel').onchange = () => { cur = +$('mcsel').value; fillControls(); };
  $('mcctl').onchange = () => { ctl = +$('mcctl').value; pickControl(); };
  $('mcval').oninput = () => {
    const u = unit(), c = u.controls[ctl];
    if (c.key === '_heading') u.heading = +$('mcval').value; else u.st[c.key] = +$('mcval').value;
    poseUnit(u); showValue();
  };
  // ---------- 置く：基準点を拾うときと同じ手順（「重機を置く」→ モデルか点群の置きたい所をタップ） ----------
  // 十字（現実の地面）に置くと、現場モデルの面と高さが合わず浮いた（2026-10-08）。モデルの面・点群の点に直接置く
  function setPlace(on) {
    placing = on;
    setPlacing(on);                               // align.js：タップを受ける・指で回すのを止める
    $('mchere').classList.toggle('sel', on);
    $('mchere').textContent = on ? 'タップで置く（やめる）' : '重機を置く';
    showValue();
  }
  $('mchere').onclick = () => setPlace(!placing);
  const ray = new THREE.Raycaster();
  // 画面の (x, y) にあるモデルの面か点群の点。モデルは面に当たった所、点群は画面上でタップにいちばん近く見える点（24 画素以内・ほぼ同じなら手前）
  function surfaceAt(x, y) {
    const cam = getCamera(), { model, cloud } = getTargets();
    ray.setFromCamera(new THREE.Vector2(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1), cam);
    let best = null;
    if (model) {
      const h = ray.intersectObject(model, true).find(h => h.object.isMesh);
      if (h) best = { p: h.point.clone(), d: h.distance };
    }
    if (cloud) {
      ray.params.Points.threshold = 3;
      const inv = new THREE.Matrix4().copy(cam.matrixWorld).invert();
      const cand = ray.intersectObjects(cloud.children.filter(o => o.visible), false).map(h => {
        const wp = new THREE.Vector3().fromBufferAttribute(h.object.geometry.getAttribute('position'), h.index).applyMatrix4(h.object.matrixWorld);
        const c = wp.clone().applyMatrix4(inv), n = c.clone().applyMatrix4(cam.projectionMatrix);
        return { p: wp, d: -c.z, px: Math.hypot((n.x + 1) / 2 * innerWidth - x, (1 - n.y) / 2 * innerHeight - y) };
      }).filter(c => c.d > 0 && c.px < 24);
      if (cand.length) {
        const pmin = Math.min(...cand.map(c => c.px));
        const c = cand.filter(c => c.px <= pmin + 3).reduce((a, b) => (b.d < a.d ? b : a));
        if (!best || c.d < best.d) best = c;     // モデルの面より手前に見える点群の点ならそちら
      }
    }
    return best && best.p;
  }
  function placeAt(x, y) {
    const p = surfaceAt(x, y);
    if (!p) { $('mcread').textContent = 'モデルにも点群にも当たりませんでした。モデルか点群の上をタップしてください'; return; }
    group.updateMatrixWorld(true);
    unit().root.position.copy(p.applyMatrix4(new THREE.Matrix4().copy(group.matrixWorld).invert()));
    unit().root.visible = true;
    setPlace(false);
  }
  function setOpen(v) {
    open = v;
    wrap.classList.toggle('open', open);
    // 重機を操作しているあいだは、位置合わせ・固定中のほかのボタンを隠す（「重機 ▼」で閉じると戻る）
    document.getElementById('overlay').classList.toggle('mcmode', open);
    $('mctgl').textContent = open ? '重機 ▼' : '重機 ▲';
  }
  $('mctgl').onclick = () => setOpen(!open);
  fillControls(); setOpen(false);

  // align.js が呼ぶ：0.5 秒ごと（現場モデルを置いたあとだけ「重機を置く」を押せる）と、置くあいだのタップ
  return {
    frame(hasHit, aligning, placed) {
      const b = $('mchere'), off = !placed;
      if (b.disabled !== off) b.disabled = off;
      if (off && placing) setPlace(false);
    },
    tap(x, y) { if (placing) placeAt(x, y); },
  };
}
