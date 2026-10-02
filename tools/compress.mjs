// GLB を小さくする（スマホで待てるのは 10〜15 MB くらいまで）。
// 使い方: node tools/compress.mjs <入力.glb> <出力.glb>
// 初回だけ、リポジトリ直下で npm install（node_modules はコミットしない）
//
// DAM\ifcviewer\viewer2_src\tools\compress.mjs と同じ処理。
// ・同じ形を1つにまとめる（dedup）
// ・座標を 16bit 整数へ（quantize。メッシュの箱を 65535 等分する。
//   箱が 300 m なら刻みは 4.6 mm ＝誤差は最大 2.3 mm）
// ・meshopt で詰める（common/align.js の MeshoptDecoder で戻す）
// ・形を間引く simplify はかけない
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { dedup, prune, quantize, reorder } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { statSync } from 'node:fs';

const [, , src, dst] = process.argv;
if (!src || !dst) {
  console.error('使い方: node tools/compress.mjs <入力.glb> <出力.glb>');
  process.exit(1);
}

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const t0 = Date.now();
const doc = await io.read(src);
const root = doc.getRoot();

// 量子化の刻み（メッシュごとの箱のいちばん長い辺 / 65535）
let span = 0;
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const a = prim.getAttribute('POSITION');
    if (!a) continue;
    const lo = a.getMin([]), hi = a.getMax([]);
    span = Math.max(span, ...hi.map((h, i) => h - lo[i]));
  }
}

await doc.transform(
  dedup(),
  prune({ keepLeaves: true }),
  reorder({ encoder: MeshoptEncoder }),
  quantize({ quantizePosition: 16, quantizeNormal: 10 }),
);
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({
  method: EXTMeshoptCompression.EncoderMethod.FILTER,
});
await io.write(dst, doc);

console.log(JSON.stringify({
  inMB: +(statSync(src).size / 1e6).toFixed(2),
  outMB: +(statSync(dst).size / 1e6).toFixed(2),
  stepMM: +(span / 65535 * 1000).toFixed(2),
  seconds: +((Date.now() - t0) / 1000).toFixed(1),
}));
