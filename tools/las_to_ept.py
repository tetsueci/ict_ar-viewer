"""LAS（1.2・点の形式 2 = 色つき）→ EPT（Entwine Point Tile・laszip）。PDAL / untwine が無くても作れるように自前で組む。

    python tools/las_to_ept.py <点群.las> --out _plain/<フォルダ>_ept [--span 256] [--cap 200000] [--voxel 0]

- 座標は元の平面直角座標のまま（origin は引かない。読む側で引く）。1 mm 刻み（scale 0.001）
- 立方体を 8 分割していく木。各段の節点は span^3 の格子に 1 点ずつ（格子に入った点のうちランダムな 1 点）を持ち、
  残りは 1 段下へ。節点に残る点が --cap 以下になったら、その節点に全部入れて止める（葉）
- 出力：ept.json・ept-hierarchy/0-0-0-0.json・ept-data/<D-X-Y-Z>.laz（点の形式 2・RGB つき）
- --voxel（m）：0 より大きければ、木を作る前にその格子で 1 点に間引く（大きすぎて置けないとき）
"""
import argparse
import json
import os
import shutil
import struct
import time

import laspy
import numpy as np

REC = np.dtype([("X", "<i4"), ("Y", "<i4"), ("Z", "<i4"), ("intensity", "<u2"), ("flags", "u1"),
                ("cls", "u1"), ("ang", "i1"), ("user", "u1"), ("psid", "<u2"),
                ("R", "<u2"), ("G", "<u2"), ("B", "<u2")])


def read_las(path, chunk=5_000_000):
    with open(path, "rb") as f:
        h = f.read(375)
    off = struct.unpack("<I", h[96:100])[0]
    fmt = h[104] & 0x3F
    rl = struct.unpack("<H", h[105:107])[0]
    n = struct.unpack("<I", h[107:111])[0]
    if fmt != 2 or rl != 26:
        raise SystemExit(f"点の形式 2（26 バイト）だけ読めます（この LAS は形式 {fmt}・{rl} バイト）")
    sc = np.array(struct.unpack("<3d", h[131:155]))
    of = np.array(struct.unpack("<3d", h[155:179]))
    mm = np.memmap(path, dtype=REC, mode="r", offset=off, shape=(n,))
    return mm, n, sc, of, chunk


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("las")
    ap.add_argument("--out", required=True)
    ap.add_argument("--span", type=int, default=256, help="節点の格子の分割数（2 の累乗）")
    ap.add_argument("--cap", type=int, default=200_000, help="この点数以下になった節点は葉にする")
    ap.add_argument("--voxel", type=float, default=0.0, help="木を作る前に間引く格子（m）。0 は間引かない")
    ap.add_argument("--seed", type=int, default=1)
    a = ap.parse_args()
    t0 = time.time()
    span_bits = int(round(np.log2(a.span)))
    assert 1 << span_bits == a.span, "span は 2 の累乗"

    mm, n, sc, of, chunk = read_las(a.las)
    # 範囲（実座標）
    lo = np.full(3, np.inf); hi = np.full(3, -np.inf)
    for s in range(0, n, chunk):
        b = mm[s:s + chunk]
        for k, c in enumerate("XYZ"):
            v = b[c]
            lo[k] = min(lo[k], v.min() * sc[k] + of[k]); hi[k] = max(hi[k], v.max() * sc[k] + of[k])
    lo = np.floor(lo * 1000) / 1000
    side = float(np.ceil((hi - lo).max() * 1000 + 2) / 1000)           # 立方体の一辺（m）
    cmin = lo - (side - (hi - lo)) / 2                                  # 立方体を真ん中に
    cmin = np.floor(cmin * 1000) / 1000
    side_mm = int(round(side * 1000))
    print(f"{n:,} 点  範囲 {np.round(lo, 3)}〜{np.round(hi, 3)}  立方体 一辺 {side:.3f} m", flush=True)

    # 読む：q = 立方体の角からの mm（int32）、色・強度・分類
    q = np.empty((n, 3), np.int32)
    inten = np.empty(n, np.uint16); cls = np.empty(n, np.uint8); rgb = np.empty((n, 3), np.uint16)
    for s in range(0, n, chunk):
        b = np.asarray(mm[s:s + chunk])
        e = s + len(b)
        for k, c in enumerate("XYZ"):
            q[s:e, k] = np.round((b[c] * sc[k] + of[k] - cmin[k]) * 1000).astype(np.int32)
        inten[s:e] = b["intensity"]; cls[s:e] = b["cls"]
        rgb[s:e, 0] = b["R"]; rgb[s:e, 1] = b["G"]; rgb[s:e, 2] = b["B"]
    print(f"  読んだ {time.time() - t0:.0f} 秒", flush=True)

    # 並びを乱す（格子に入った「最初の点」をランダムな 1 点にするため）
    perm = np.random.default_rng(a.seed).permutation(n)
    q = q[perm]; inten = inten[perm]; cls = cls[perm]; rgb = rgb[perm]
    del perm

    if a.voxel > 0:
        v = (q // int(round(a.voxel * 1000))).astype(np.int64)
        key = (v[:, 0] << 42) | (v[:, 1] << 21) | v[:, 2]
        _, keep = np.unique(key, return_index=True)
        keep.sort()
        q = q[keep]; inten = inten[keep]; cls = cls[keep]; rgb = rgb[keep]
        del v, key, keep
        print(f"  {a.voxel} m 格子で間引いた → {len(q):,} 点", flush=True)
    n = len(q)

    depth = np.full(n, 255, np.uint8)               # どの段の節点に入ったか
    rem = np.arange(n, dtype=np.int64)              # まだ入っていない点（元の並び＝ランダムな順）
    d = 0
    while len(rem):
        cells = a.span << d                         # この段の格子の数（一辺）
        if cells > (1 << 21):
            depth[rem] = d; break                   # 格子の番号が足りない（これ以上細かくしない）
        g = (q[rem].astype(np.int64) * cells) // side_mm
        g = np.minimum(g, cells - 1)
        nd = g >> span_bits                         # 節点の番号
        nkey = (nd[:, 0] << 42) | (nd[:, 1] << 21) | nd[:, 2]
        _, inv, cnt = np.unique(nkey, return_inverse=True, return_counts=True)
        leaf = cnt[inv] <= a.cap
        depth[rem[leaf]] = d
        rest = ~leaf
        gk = (g[rest, 0] << 42) | (g[rest, 1] << 21) | g[rest, 2]
        _, first = np.unique(gk, return_index=True)
        idx = rem[rest]
        depth[idx[first]] = d
        mask = np.ones(len(idx), bool); mask[first] = False
        print(f"  段 {d}: 格子 {side / cells * 100:.1f} cm  葉 {leaf.sum():,} 点・選んだ {len(first):,} 点・残り {mask.sum():,} 点", flush=True)
        rem = idx[mask]
        d += 1
        del g, nd, nkey, inv, cnt, leaf, rest, gk, first, idx, mask

    # 書く
    if os.path.exists(a.out):
        shutil.rmtree(a.out)
    os.makedirs(os.path.join(a.out, "ept-data")); os.makedirs(os.path.join(a.out, "ept-hierarchy"))
    off_mm = side_mm // 2
    offset = cmin + off_mm / 1000.0                  # LAS の offset（立方体の真ん中・mm にそろえる）
    hier = {}
    for dd in range(int(depth.max()) + 1):
        sel = np.nonzero(depth == dd)[0]
        if not len(sel):
            continue
        cells = a.span << dd
        nd = np.minimum((q[sel].astype(np.int64) * cells) // side_mm, cells - 1) >> span_bits
        nkey = (nd[:, 0] << 42) | (nd[:, 1] << 21) | nd[:, 2]
        order = np.argsort(nkey, kind="stable")
        sel, nkey, nd = sel[order], nkey[order], nd[order]
        cut = np.nonzero(np.diff(nkey))[0] + 1
        for s, e in zip(np.r_[0, cut], np.r_[cut, len(sel)]):
            ii = sel[s:e]
            name = f"{dd}-{nd[s, 0]}-{nd[s, 1]}-{nd[s, 2]}"
            hdr = laspy.LasHeader(point_format=2, version="1.2")
            hdr.scales = np.array([0.001] * 3); hdr.offsets = offset
            las = laspy.LasData(hdr)
            las.X = q[ii, 0] - off_mm; las.Y = q[ii, 1] - off_mm; las.Z = q[ii, 2] - off_mm
            las.intensity = inten[ii]; las.classification = cls[ii]
            las.red = rgb[ii, 0]; las.green = rgb[ii, 1]; las.blue = rgb[ii, 2]
            las.write(os.path.join(a.out, "ept-data", name + ".laz"))
            hier[name] = int(len(ii))
        print(f"  段 {dd} を書いた（節点 {len(cut) + 1}・{len(sel):,} 点）", flush=True)
    with open(os.path.join(a.out, "ept-hierarchy", "0-0-0-0.json"), "w", encoding="utf-8") as fo:
        json.dump(hier, fo, separators=(",", ":"))
    bmax = cmin + side_mm / 1000.0
    ept = {
        "bounds": [*cmin.tolist(), *bmax.tolist()],
        "boundsConforming": [*lo.tolist(), *hi.tolist()],
        "dataType": "laszip",
        "hierarchyType": "json",
        "points": int(n),
        "schema": [
            {"name": "X", "type": "signed", "size": 4, "scale": 0.001, "offset": float(offset[0])},
            {"name": "Y", "type": "signed", "size": 4, "scale": 0.001, "offset": float(offset[1])},
            {"name": "Z", "type": "signed", "size": 4, "scale": 0.001, "offset": float(offset[2])},
            {"name": "Intensity", "type": "unsigned", "size": 2},
            {"name": "Classification", "type": "unsigned", "size": 1},
            {"name": "Red", "type": "unsigned", "size": 2},
            {"name": "Green", "type": "unsigned", "size": 2},
            {"name": "Blue", "type": "unsigned", "size": 2},
        ],
        "span": a.span,
        "srs": {},
        "version": "1.0.0",
    }
    with open(os.path.join(a.out, "ept.json"), "w", encoding="utf-8") as fo:
        json.dump(ept, fo, indent=2)
    tot = sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(a.out) for f in fs)
    nfile = sum(len(fs) for _, _, fs in os.walk(a.out))
    sizes = sorted(hier.values())
    print(f"できた {a.out}  {tot / 1e6:.1f} MB・ファイル {nfile}・段 {int(depth.max()) + 1}・節点 {len(hier)}"
          f"（点数 最小 {sizes[0]:,}・中央 {sizes[len(sizes) // 2]:,}・最大 {sizes[-1]:,}）・段 0 {hier.get('0-0-0-0', 0):,} 点"
          f"・{time.time() - t0:.0f} 秒")


if __name__ == "__main__":
    main()
