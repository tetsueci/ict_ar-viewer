// 現場 AR に重機を置いて動かす（config.json に "machines" がある現場だけ。align.js が読む）
//
// 重機の形・数字・動きの正は ict_kenki-ar（https://tetsueci.github.io/ict_kenki-ar/）。
// ここには写さず、同じ tetsueci.github.io から読む（machines/*.json・models/<機械>/*.glb・src/*.js）。
// 重機は現場モデルのかたまり（group）の子に置くので、2 点合わせ・固定・縮尺に一緒に従う。
//
// config.json の書き方（1 行＝1 台。同じ重機を何行書いてもよく、1 台ずつ別々に動く）：
//   "machines": [ { "id": "backhoe08" }, { "id": "KATO_SR250Rf2" } ]
//       … 置き場所を決めない台。AR の中で「重機を置く」→ モデルか点群をタップして置く
//   { "id": "backhoe08", "name": "BH-1", "x": X, "y": Y, "z": Z, "heading": 30, "pose": { "angleBoom": 20 } }
//       … 初めから置いておく台。x・y は現場の座標（m）。z を書かなければモデルの面の高さに落とす
//         heading は CAD と同じく東から左回りの角度（°）。pose は初めの姿勢（キー名は ict_kenki-ar の machines/*.json の controls）
//   台数は AR の中でも「＋同じ重機」「この重機を消す」で増やし減らしできる（書いた種類の重機だけ）。"kenkiBase" で読み先を変えられる
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

  // 重機の種類ごとに 1 回だけ読む（数字・荷重表・部品の形）。台を増やしても形は使い回す（clone は形を共有する）
  const types = new Map();                      // id → { M, pose, LOAD, parts: [[名前, scene]] }
  async function loadType(id) {
    if (types.has(id)) return types.get(id);
    const M = await getJson(`machines/${id}.json`);
    const pose = KINEMATICS[M.type];
    if (!pose) { types.set(id, null); return null; }
    let LOAD = null;
    if (M.load) try { LOAD = await getJson(M.load); } catch (e) { LOAD = null; }
    const parts = [];
    if (M.models) {
      const pj = await getJson(M.models + '_parts.json');
      await Promise.all(Object.entries(pj).map(async ([name, info]) => {
        if (M.parts && !M.parts.includes(name)) return;
        const g = await loader.loadAsync(base + M.models + info.file);
        g.scene.traverse(c => { if (c.isMesh) c.material = matOf(name); });
        parts.push([name, g.scene]);
      }));
    }
    const t = { id, M, pose, LOAD, parts, count: 0 };
    types.set(id, t);
    return t;
  }
  for (const id of new Set(list.map(d => d.id))) await loadType(id);

  // 1 台つくる。def の x・y があれば初めからそこに置く（z が無ければ、モデルを読み終えたあと面の高さに落とす）
  const units = [];
  function makeUnit(t, def) {
    const root = new THREE.Group();             // 置く位置と向き（現場の glTF の座標）
    root.visible = false;
    const body = new THREE.Group();             // CAD → glTF
    body.matrixAutoUpdate = false; body.matrix.copy(CAD);
    root.add(body);
    group.add(root);
    const nodes = {};
    const put = (key, obj) => {
      const o = new THREE.Group();
      o.add(obj); o.matrixAutoUpdate = false; o.visible = false;
      body.add(o); nodes[key] = o;
    };
    for (const [name, scene] of t.parts) {
      if (name in COPIES) for (const k of ['fr', 'fl', 'br', 'bl']) put(COPIES[name] + '_' + k, scene.clone(true));
      else put(name, scene.clone(true));
    }
    const M = t.M;
    // 初めの姿勢（ict_kenki-ar の index.html と同じ）に、config の pose を重ねる
    let st;
    if (M.type === 'rough_terrain_crane') st = { outrigger: M.limits.outrigger_min, angleCabin: 0, angleBoom: 45, lengthBoom: M.limits.length_boom_min, lengthWire: 10, ratioAllow: 80 };
    else if (M.type === 'backhoe') st = { angleCabin: 0, angleBoom: 30, angleArm: -100, angleBucket: 30, bucketType: 0 };
    else st = { boomType: 0, angleCabin: 0, angleBoom: 60, lengthWire: 10, ratioAllow: 80 };
    if (def.pose && typeof def.pose === 'object') Object.assign(st, def.pose);
    t.count += 1;
    const u = { t, def, M, pose: t.pose, LOAD: t.LOAD, root, nodes, st, heading: +def.heading || 0, readout: '',
      name: def.name || `${M.short || M.title || t.id}-${t.count}`, snap: false };
    // 向き（車体ごと）はスライダーの先頭に足す
    u.controls = [{ key: '_heading', label: '車体の向き', unit: '°', min: -180, max: 180, step: 1 }, ...M.controls];
    if (Number.isFinite(def.x) && Number.isFinite(def.y)) {
      root.position.copy(siteToGl({ x: def.x, y: def.y, z: Number.isFinite(def.z) ? def.z : 0 }));
      root.visible = true;
      u.snap = !Number.isFinite(def.z);
    }
    units.push(u);
    poseUnit(u);
    return u;
  }
  for (const def of list) { const t = types.get(def.id); if (t) makeUnit(t, def); }
  if (!units.length) return;

  // z を書かなかった台：モデルを読み終えたら、真上から下へ光線を落としてモデルの面の高さにする
  const down = new THREE.Raycaster();
  function snapPending() {
    const { model } = getTargets();
    if (!model) return;
    group.updateMatrixWorld(true);
    for (const u of units) {
      if (!u.snap) continue;
      const top = u.root.position.clone(); top.y = 10000;
      const from = top.applyMatrix4(group.matrixWorld);
      const to = u.root.position.clone(); to.y = -10000; to.applyMatrix4(group.matrixWorld);
      down.set(from, to.clone().sub(from).normalize());
      const h = down.intersectObject(model, true).find(h => h.object.isMesh);
      if (h) u.root.position.y = h.point.applyMatrix4(new THREE.Matrix4().copy(group.matrixWorld).invert()).y;
      u.snap = false;                           // 当たらなければ書いた座標（z＝0）のまま
    }
  }

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
    <div class="row mcbody"><button id="mcadd">＋同じ重機</button><button id="mcdel">この重機を消す</button></div>
    <div class="row mcbody"><select id="mcctl"></select><input id="mcval" type="range"><span id="mcnum" class="mcnum"></span></div>
    <div class="row mcbody"><span id="mcread" class="mcread"></span></div>`;
  panel.insertBefore(wrap, lockRow);
  const $ = id => document.getElementById(id);
  let cur = 0, ctl = 0, open = false, placing = false;
  function fillUnits() {                          // 重機を選ぶドロップダウン（台の名前。置いていない台は「未」）
    $('mcsel').innerHTML = '';
    units.forEach((u, i) => {
      const o = document.createElement('option');
      o.value = i; o.textContent = u.name + (u.root.visible ? '' : '（未）');
      $('mcsel').appendChild(o);
    });
    if (cur >= units.length) cur = units.length - 1;
    $('mcsel').value = cur;
  }
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
  $('mcsel').onchange = () => { cur = +$('mcsel').value; if (placing) setPlace(false); fillControls(); };
  // 同じ種類の重機をもう 1 台。足したらそのまま「タップで置く」にする
  $('mcadd').onclick = () => {
    const u = makeUnit(unit().t, { id: unit().t.id, heading: unit().heading });
    cur = units.indexOf(u);
    fillUnits(); fillControls(); setPlace(true);
  };
  // この台を消す。その種類の最後の 1 台は消さずに「置いていない」状態へ戻す（もう一度置けるように）
  $('mcdel').onclick = e => {
    const u = unit();
    const same = units.filter(x => x.t === u.t).length;
    if (same <= 1) { u.root.visible = false; if (placing) setPlace(false); fillUnits(); showValue(); return; }
    group.remove(u.root);
    units.splice(cur, 1);
    if (cur >= units.length) cur = units.length - 1;   // 消した台の次（最後なら 1 つ前）を選ぶ
    if (placing) setPlace(false);
    fillUnits(); fillControls();
  };
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
    fillUnits();
  }
  function setOpen(v) {
    open = v;
    wrap.classList.toggle('open', open);
    // 重機を操作しているあいだは、位置合わせ・固定中のほかのボタンを隠す（「重機 ▼」で閉じると戻る）
    document.getElementById('overlay').classList.toggle('mcmode', open);
    $('mctgl').textContent = open ? '重機 ▼' : '重機 ▲';
  }
  $('mctgl').onclick = () => setOpen(!open);
  fillUnits(); fillControls(); setOpen(false);

  // align.js が呼ぶ：0.5 秒ごと（現場モデルを置いたあとだけ「重機を置く」を押せる）と、置くあいだのタップ
  return {
    frame(hasHit, aligning, placed) {
      const b = $('mchere'), off = !placed;
      if (b.disabled !== off) b.disabled = off;
      if (off && placing) setPlace(false);
      if (units.some(u => u.snap)) { snapPending(); showValue(); }
    },
    tap(x, y) { if (placing) placeAt(x, y); },
  };
}
