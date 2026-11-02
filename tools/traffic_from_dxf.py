"""道路モデルの DXF から、車を走らせる車線の線（traffic.json）を作る。

    python tools/traffic_from_dxf.py <model.dxf> --out <フォルダ> --seed "X1,Y1;X2,Y2" [--offsets -6.75,-3.25,3.25,6.75]

- --seed：分離帯の両縁の白線の、道路の始まりの所の点（進む向きの左の線；右の線）。ここから白線をたどる
- 2 本の白線の真ん中を道路の中心とし、中心から --offsets（m。進む向きの右が +）の所を車線とする
- 左側通行：中心の左（−）の車線はたどる向き、右（+）の車線は逆向きに走る
- 高さは路面（--road 画層の面）から取る。路面の外の点は前後の高さをつなぐ
- 書くのは <フォルダ>/traffic.json（lanes：現場座標 [x, y, z] の列）。config.json に "traffic" を足す
- --plot で確かめの絵（traffic_check.png）を <フォルダ> の外に書ける
"""
import argparse
import fnmatch
import json
import os

import numpy as np


def read_polyfaces(path):
    """DXF の POLYLINE（ポリフェース）を [(画層, 頂点, 面)] で返す"""
    lines = open(path, encoding="utf-8", errors="replace").read().splitlines()
    out, sec, i, n = [], None, 0, len(lines) - 1
    cur, verts, faces, lay, d = None, [], [], None, None

    def flush_vertex():
        nonlocal d
        if d is None:
            return
        vf = int(float(d.get("70", 0)))
        if vf & 128 and not vf & 64:
            faces.append([abs(int(float(d[k]))) - 1 for k in ("71", "72", "73", "74") if k in d and int(float(d[k])) != 0])
        else:
            verts.append((float(d.get("10", 0)), float(d.get("20", 0)), float(d.get("30", 0))))
        d = None

    while i < n:
        c, v = lines[i].strip(), lines[i + 1].strip()
        i += 2
        if c == "0":
            flush_vertex()
            if v == "SECTION":
                sec = lines[i + 1].strip()
            elif sec == "ENTITIES" and v == "POLYLINE":
                cur, verts, faces, lay = "P", [], [], None
            elif sec == "ENTITIES" and v == "VERTEX" and cur == "P":
                d = {}
            elif v == "SEQEND" and cur == "P":
                if verts and faces:
                    out.append((lay, np.array(verts), faces))
                cur = None
            continue
        if d is not None:
            d.setdefault(c, v)
        elif cur == "P" and c == "8" and lay is None:
            lay = v
    return out


def trace(cen, seed, ahead, step=4.0, reach=1.0, gap=40.0):
    """白線の点 cen（2 次元）を seed から ahead の向きへたどる。点の列を返す"""
    p, h = np.array(seed, float), np.array(ahead, float) / np.linalg.norm(ahead)
    path, missed = [p.copy()], 0.0
    while True:
        q = p + h * step
        rel = cen - q
        along, side = rel @ h, rel @ np.array([-h[1], h[0]])
        k = (np.abs(along) < step / 2) & (np.abs(side) < reach)
        if k.sum() >= 2:
            q = q + np.array([-h[1], h[0]]) * np.median(side[k])
            missed = 0.0
            nh = q - path[max(0, len(path) - 4)]        # 向きは少し前の点から（点ごとの揺れを拾わない）
            h = nh / np.linalg.norm(nh)
        else:
            missed += step
            if missed > gap:
                break
        path.append(q.copy())
        p = q
    return np.array(path[:len(path) - int(missed / step)] if missed else path)


def resample(P, ds):
    L = np.r_[0, np.cumsum(np.hypot(*np.diff(P, axis=0).T))]
    s = np.arange(0, L[-1], ds)
    return np.c_[np.interp(s, L, P[:, 0]), np.interp(s, L, P[:, 1])]


def smooth(P, n=3):
    k = np.ones(2 * n + 1) / (2 * n + 1)
    Q = P.copy()
    for a in range(2):
        pad = np.r_[np.full(n, P[0, a]), P[:, a], np.full(n, P[-1, a])]
        Q[:, a] = np.convolve(pad, k, "valid")
    Q[0], Q[-1] = P[0], P[-1]
    return Q


def surface_z(xy, tris):
    """xy の真下・真上の路面の高さ。tris は (M,3,3)。外なら nan"""
    a, b, c = tris[:, 0], tris[:, 1], tris[:, 2]
    lo, hi = tris[:, :, :2].min(1), tris[:, :, :2].max(1)
    z = np.full(len(xy), np.nan)
    for i, p in enumerate(xy):
        k = np.where((lo[:, 0] <= p[0]) & (p[0] <= hi[:, 0]) & (lo[:, 1] <= p[1]) & (p[1] <= hi[:, 1]))[0]
        if not len(k):
            continue
        v0, v1 = (b - a)[k][:, :2], (c - a)[k][:, :2]
        v2 = p - a[k][:, :2]
        den = v0[:, 0] * v1[:, 1] - v1[:, 0] * v0[:, 1]
        ok = np.abs(den) > 1e-12
        u = np.where(ok, (v2[:, 0] * v1[:, 1] - v1[:, 0] * v2[:, 1]) / np.where(ok, den, 1), -1)
        v = np.where(ok, (v0[:, 0] * v2[:, 1] - v2[:, 0] * v0[:, 1]) / np.where(ok, den, 1), -1)
        hit = (u >= -1e-6) & (v >= -1e-6) & (u + v <= 1 + 1e-6)
        if hit.any():
            j = np.where(hit)[0]
            zs = a[k][j, 2] + u[j] * (b - a)[k][j, 2] + v[j] * (c - a)[k][j, 2]
            z[i] = zs.max()
    return z


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("dxf")
    ap.add_argument("--out", required=True)
    ap.add_argument("--seed", required=True, help='"X1,Y1;X2,Y2" 進む向きの左の白線と右の白線の始まりの点')
    ap.add_argument("--ahead", default="0,1", help="始まりの進む向き（既定は北）")
    ap.add_argument("--offsets", default="-6.75,-3.25,3.25,6.75")
    ap.add_argument("--mark", default="MARK_*", help="白線の画層")
    ap.add_argument("--road", default="ROAD_*", help="路面の画層（側道などを外すときは型を並べる。カンマ区切り）")
    ap.add_argument("--step", type=float, default=5.0, help="車線の点の間隔（m）")
    ap.add_argument("--plot", help="確かめの絵の出力先")
    a = ap.parse_args()

    polys = read_polyfaces(a.dxf)
    match = lambda lay, pats: any(fnmatch.fnmatchcase(lay or "", p) for p in pats.split(","))  # noqa: E731
    marks = [v[np.array([f[:3] for f in r])] for lay, v, r in polys if match(lay, a.mark)]
    cen = np.vstack(marks).mean(1)[:, :2]
    tl = []
    for lay, v, r in polys:
        if match(lay, a.road):
            for f in r:
                tl.append(v[[f[0], f[1], f[2]]])
                if len(f) == 4:
                    tl.append(v[[f[0], f[2], f[3]]])
    tris = np.array(tl)

    s1, s2 = [np.array([float(c) for c in s.split(",")]) for s in a.seed.split(";")]
    ahead = np.array([float(c) for c in a.ahead.split(",")])
    L1, L2 = trace(cen, s1, ahead), trace(cen, s2, ahead)
    print(f"白線のたどり：左 {len(L1)} 点・右 {len(L2)} 点")
    n = min(len(L1), len(L2))
    Lr1, Lr2 = resample(L1, 1.0), resample(L2, 1.0)
    n = min(len(Lr1), len(Lr2))
    C = smooth(resample((Lr1[:n] + Lr2[:n]) / 2, a.step), 2)
    d = np.gradient(C, axis=0)
    d /= np.linalg.norm(d, axis=1, keepdims=True)
    right = np.c_[d[:, 1], -d[:, 0]]
    lanes = []
    for off in [float(x) for x in a.offsets.split(",")]:
        P = C + right * off
        z = surface_z(P, tris)
        bad = np.isnan(z)
        if bad.all():
            raise SystemExit(f"車線 {off} は路面の上に 1 点もありません")
        z[bad] = np.interp(np.flatnonzero(bad), np.flatnonzero(~bad), z[~bad])
        pts = np.c_[P, z]
        print(f"  車線 {off:+.2f} m  {len(pts)} 点  路面の外 {int(bad.sum())} 点  Z {z.min():.2f}〜{z.max():.2f}")
        if off > 0:
            pts = pts[::-1]                              # 左側通行：右の車線は逆向き
        lanes.append({"offset": off, "points": [[round(float(x), 3) for x in p] for p in pts]})

    with open(os.path.join(a.out, "traffic.json"), "w", encoding="utf-8", newline="\n") as fo:
        json.dump({"lanes": lanes}, fo, ensure_ascii=False, separators=(",", ":"))
    cp = os.path.join(a.out, "config.json")
    cfg = json.load(open(cp, encoding="utf-8"))
    cfg.setdefault("traffic", {"file": "traffic.json", "speed": 60, "gap": 60})
    with open(cp, "w", encoding="utf-8", newline="\n") as fo:
        json.dump(cfg, fo, ensure_ascii=False, indent=2)
        fo.write("\n")
    print("全長 %.1f m" % np.hypot(*np.diff(C, axis=0).T).sum(), " traffic.json", os.path.getsize(os.path.join(a.out, "traffic.json")), "バイト")

    if a.plot:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        plt.rcParams["font.family"] = ["Yu Gothic", "Meiryo", "sans-serif"]
        edges = np.linspace(C[:, 1].min() - 5, C[:, 1].max() + 5, 6)    # 道路が南北に長いとして Y で 5 つに切る
        windows = list(zip(edges[:-1], edges[1:]))
        fig, axs = plt.subplots(1, len(windows), figsize=(20, 11), dpi=100)
        for ax, (y0, y1) in zip(axs, windows):
            k = (cen[:, 1] > y0) & (cen[:, 1] < y1)
            ax.scatter(cen[k, 0], cen[k, 1], s=0.4, c="k")
            for ln, c in zip(lanes, ("#d00000", "#ff8000", "#0070d0", "#00a040")):
                p = np.array(ln["points"])
                ax.plot(p[:, 0], p[:, 1], color=c, lw=1.2)
            ax.plot(C[:, 0], C[:, 1], color="#888888", lw=0.6, ls="--")
            ax.set_ylim(y0, y1)
            m = np.median(C[(C[:, 1] > y0) & (C[:, 1] < y1), 0])
            ax.set_xlim(m - (y1 - y0) / 4, m + (y1 - y0) / 4)
            ax.set_aspect("equal")
            ax.grid(True, lw=0.3)
            ax.set_title(f"Y {y0:.0f}〜{y1:.0f}")
        fig.tight_layout()
        fig.savefig(a.plot)


if __name__ == "__main__":
    main()
