// 電波が無くても開けるようにする service worker の本体（2026-10-15）。
// 各現場のフォルダの sw.js が importScripts で読む（service worker は置いたフォルダの中しか受け持てないため、フォルダごとに 1 行の sw.js を置く）。
// やり方：電波があればいつもネットから読み、読んだものを保存する（新しい版に入れ替わる）。読めなければ保存したものを返す。
// 保存の名前は ?v=… を外したもの（ページは読むたびに番号を付けるので、付けたままだと毎回別物になる）
const CACHE = 'genba-ar-1';
const WAIT = 6000;                              // ネットが遅いとき、保存したものに切り替えるまでの時間（ms）

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || r.headers.has('range')) return;
  const u = new URL(r.url);
  if (u.origin !== self.location.origin && u.hostname !== 'cdn.jsdelivr.net') return;   // 同じサイトと three.js だけ
  e.respondWith(handle(r));
});

// ★?v= には 2 種類ある（2026-10-16）。
//   ・common/ のもの … ページが読むたびに付ける番号。外さないと毎回別物になって保存が効かない
//   ・現場のファイル（model.glb.enc・plan.png・点群）… config.json の "version"。
//     ★こちらは残す。外すと、新しい版を出しても「6 秒待っても来ないから保存したものを返す」で
//     古いモデルが出てしまい、更新したのに変わらないように見える（実際に起きた）
function keyOf(url) {
  const u = new URL(url);
  if (u.origin === self.location.origin && u.pathname.includes('/common/')) u.search = '';
  u.hash = '';
  return u.href;
}

// 版が変わる前の保存（?v= を外した名前）。電波が無いときだけ、最後の頼みとして見る
function oldKeyOf(url) {
  const u = new URL(url);
  if (u.origin !== self.location.origin || !u.search) return null;
  u.search = '';
  u.hash = '';
  return u.href;
}

async function handle(r) {
  const cache = await caches.open(CACHE);
  const key = keyOf(r.url);
  const net = fetch(r).then(res => {
    if (res.ok && (res.type === 'basic' || res.type === 'cors')) cache.put(key, res.clone()).catch(() => {});
    return res;
  });
  net.catch(() => {});                          // 保存したものを返したあとで落ちても騒がない
  // 遅いときは保存したものを先に返す（保存が無ければネットを待つ）。
  // 版が上がったファイルはこの名前では見つからないので、ここでは古いものを返さずネットを待つ
  const slow = new Promise(ok => setTimeout(ok, WAIT)).then(() => cache.match(key));
  try {
    const first = await Promise.race([net, slow]);
    if (first) return first;
    return await net;
  } catch (err) {
    const hit = await cache.match(key) || await cache.match(oldKeyOf(r.url) || key);
    if (hit) return hit;
    throw err;
  }
}
