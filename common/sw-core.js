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

function keyOf(url) {
  const u = new URL(url);
  if (u.origin === self.location.origin) u.search = '';
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
  // 遅いときは保存したものを先に返す（保存が無ければネットを待つ）
  const slow = new Promise(ok => setTimeout(ok, WAIT)).then(() => cache.match(key));
  try {
    const first = await Promise.race([net, slow]);
    if (first) return first;
    return await net;
  } catch (err) {
    const hit = await cache.match(key);
    if (hit) return hit;
    throw err;
  }
}
