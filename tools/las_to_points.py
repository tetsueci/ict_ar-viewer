"""LAS（1.2〜1.4・点の形式 0〜3、6〜8）→ 間引いた点群の GLB（現場合わせのフォルダへ pointcloud.glb）。

    python tools/las_to_points.py <点群.las> --out <フォルダ> --crop xmin,ymin,xmax,ymax --voxel 0.1

- 範囲（--crop、平面直角座標の m）で切り、--voxel（m）の格子ごとに 1 点だけ残す（格子に入った最初の点）
- 座標はフォルダの config.json の origin を引いて入れる（モデルと同じ。common/align.js が足し戻す）。
  Z 上向きを glTF の Y 上向きへ回す
- 色は LAS の RGB（16bit なら 8bit へ）。色が無い形式は高さで塗る
- 書き出したあと tools/compress.mjs で 16bit 量子化＋meshopt に詰める（--no-compress で止める）
- 2,000 万点を超える LAS も読めるよう、少しずつ読む（numpy の memmap）
"""
import argparse
import json
import os
import struct
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from glb import compress_glb  # noqa: E402

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
RGB_AT = {2: 20, 3: 28, 5: 28, 7: 30, 8: 30, 10: 30}      # 点の形式 → RGB の位置（バイト）
XYZ_AT = 0


def read_header(path):
    with open(path, "rb") as f:
        h = f.read(375)
    if h[:4] != b"LASF":
        raise SystemExit("LAS ではありません")
    vmin = h[25]
    off = struct.unpack("<I", h[96:100])[0]
    fmt = h[104] & 0x3F
    rl = struct.unpack("<H", h[105:107])[0]
    n = struct.unpack("<I", h[107:111])[0]
    if vmin >= 4 and n == 0:
        n = struct.unpack("<Q", h[247:255])[0]
    sc = np.array(struct.unpack("<3d", h[131:155]))
    of = np.array(struct.unpack("<3d", h[155:179]))
    return off, fmt, rl, n, sc, of


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("las")
    ap.add_argument("--out", required=True, help="現場合わせのフォルダ（config.json の origin を使う）")
    ap.add_argument("--crop", help="xmin,ymin,xmax,ymax（m）。無ければ全体")
    ap.add_argument("--voxel", type=float, default=0.1, help="間引きの格子（m）")
    ap.add_argument("--name", default="pointcloud.glb")
    ap.add_argument("--no-compress", action="store_true")
    ap.add_argument("--chunk", type=int, default=5_000_000)
    a = ap.parse_args()
    out = a.out if os.path.isabs(a.out) else os.path.join(ROOT, a.out)
    with open(os.path.join(out, "config.json"), encoding="utf-8") as fi:
        cfg = json.load(fi)
    O = np.array([cfg.get("origin", {}).get(k, 0.0) for k in "xyz"])

    t0 = time.time()
    off, fmt, rl, n, sc, of = read_header(a.las)
    mm = np.memmap(a.las, dtype=np.uint8, mode="r", offset=off, shape=(n, rl))
    crop = [float(c) for c in a.crop.split(",")] if a.crop else None
    rgb_at = RGB_AT.get(fmt)
    keys, xyz, rgb = [], [], []
    v = a.voxel
    for s in range(0, n, a.chunk):
        b = np.ascontiguousarray(mm[s:s + a.chunk])
        ijk = b[:, :12].copy().view("<i4").reshape(-1, 3)
        p = ijk * sc + of
        if crop:
            k = (p[:, 0] >= crop[0]) & (p[:, 1] >= crop[1]) & (p[:, 0] <= crop[2]) & (p[:, 1] <= crop[3])
            p, b = p[k], b[k]
        if not len(p):
            continue
        g = np.floor((p - O) / v).astype(np.int64) + (1 << 20)           # 格子の番号（±100 km まで）
        keys.append((g[:, 0] << 42) | (g[:, 1] << 21) | g[:, 2])
        xyz.append((p - O).astype(np.float32))
        if rgb_at is not None:
            rgb.append(b[:, rgb_at:rgb_at + 6].copy().view("<u2").reshape(-1, 3))
        print(f"  {min(s + a.chunk, n):,} / {n:,} 点を読んだ（範囲内 {sum(len(x) for x in xyz):,}）", flush=True)
    key = np.concatenate(keys)
    _, first = np.unique(key, return_index=True)
    first.sort()
    p = np.concatenate(xyz)[first]
    if rgb:
        c = np.concatenate(rgb)[first]
        c = (c >> 8) if c.max() > 255 else c
        col = c.astype(np.uint8)
    else:
        z = p[:, 2]
        t = (z - z.min()) / max(1e-6, z.max() - z.min())
        col = (np.stack([t, 1 - abs(t - 0.5) * 2, 1 - t], axis=1) * 255).astype(np.uint8)
    pos = np.stack([p[:, 0], p[:, 2], -p[:, 1]], axis=1).astype(np.float32)   # Z 上 → Y 上
    col4 = np.concatenate([col, np.full((len(col), 1), 255, np.uint8)], axis=1)

    path = os.path.join(out, a.name)
    write_points_glb(path, pos, col4)
    raw = os.path.getsize(path)
    if not a.no_compress:
        r = compress_glb(path)
        if r:
            print(f"圧縮 {raw / 1e6:.2f} MB → {os.path.getsize(path) / 1e6:.2f} MB（座標の刻み {r['stepMM']} mm）")
    cfg["pointcloud"] = a.name                    # common/align.js はこれがあれば点群も読む
    with open(os.path.join(out, "config.json"), "w", encoding="utf-8", newline="
") as fo:
        json.dump(cfg, fo, ensure_ascii=False, indent=2)
        fo.write("
")
    lo, hi = p.min(axis=0) + O, p.max(axis=0) + O
    print(f"{a.name}  {len(p):,} 点（元 {n:,} 点・格子 {v} m）  {os.path.getsize(path) / 1e6:.2f} MB  {time.time() - t0:.0f} 秒")
    print(f"  範囲 X {lo[0]:.2f}〜{hi[0]:.2f}  Y {lo[1]:.2f}〜{hi[1]:.2f}  Z {lo[2]:.2f}〜{hi[2]:.2f}")


def write_points_glb(path, pos, col):
    """POINTS（mode 0）で POSITION（float）と COLOR_0（RGBA 8bit・正規化）を書く"""
    pb, cb = pos.tobytes(), col.tobytes()
    gl = {
        "asset": {"version": "2.0", "generator": "las_to_points.py"},
        "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0, "name": "pointcloud"}],
        "meshes": [{"name": "pointcloud", "primitives": [{"attributes": {"POSITION": 0, "COLOR_0": 1}, "mode": 0}]}],
        "buffers": [{"byteLength": len(pb) + len(cb)}],
        "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": len(pb), "target": 34962},
                        {"buffer": 0, "byteOffset": len(pb), "byteLength": len(cb), "target": 34962}],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": len(pos), "type": "VEC3",
             "min": pos.min(axis=0).tolist(), "max": pos.max(axis=0).tolist()},
            {"bufferView": 1, "componentType": 5121, "normalized": True, "count": len(col), "type": "VEC4"},
        ],
    }
    js = json.dumps(gl, separators=(",", ":")).encode()
    js += b" " * ((-len(js)) % 4)
    bn = pb + cb
    bn += b"\x00" * ((-len(bn)) % 4)
    with open(path, "wb") as fo:
        fo.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bn)))
        fo.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
        fo.write(struct.pack("<II", len(bn), 0x004E4942) + bn)


if __name__ == "__main__":
    main()
