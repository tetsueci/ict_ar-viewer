"""IFC → 現場合わせの一式（model.glb・config.json・plan.png）。dxf_to_site.py の IFC 版。

    python tools/ifc_to_site.py <model.ifc> --out <フォルダ> --title 名前 --points-csv 基準点.csv
    python tools/ifc_to_site.py <model.ifc> --out <フォルダ> --title 名前 "--points=X,Y,Z;X,Y,Z"

  （座標が負のときは --points= の形で渡す。空白で区切ると - を見出しと取り違える）

- 形と色は IfcOpenShell のまま（世界座標・m）。Z 上向きを glTF の Y 上向きへ回す
- 頂点をまとめて書き（glb.weld）、tools/compress.mjs で 16bit 量子化＋meshopt に詰める。
  電線共同溝（延長 370 m）の例で 31 MB → 9.7 MB → 1.25 MB（Node.js とリポジトリ直下の npm install が要る）
- ★IFC には基準点の目印が無いので、基準点は --points-csv（何点でも）か --points で渡す（X=東 Y=北 Z=標高）。
  Z は現地で十字を当てる面（路面）の標高にする
- 座標は平面直角座標のことが多い。float32 で丸まらないよう、origin（平面の中心を 1 m に丸めた値）を
  引いて model.glb に入れ、config.json に origin を書く（common/align.js が足し戻す）
"""
import argparse
import json
import math
import multiprocessing
import os
import sys
import time

import ifcopenshell
import ifcopenshell.geom
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from glb import compress_glb, copy_page, write_glb, zup_to_yup  # noqa: E402
from ifc_to_glb import DEFAULT_SKIP, FALLBACK, rgba_of  # noqa: E402

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))


def read_ifc(src, skip):
    """色 → [(頂点, 三角形)]、部材の種類（名前の $ より前）→ [三角形の頂点 (M,3,3)]"""
    f = ifcopenshell.open(src)
    s = ifcopenshell.geom.settings()
    s.set("use-world-coords", True)
    s.set("apply-default-materials", True)
    excl = [x.strip() for x in skip.split(",") if x.strip()]
    it = ifcopenshell.geom.iterator(s, f, multiprocessing.cpu_count(), exclude=excl or None)
    if not it.initialize():
        raise SystemExit("形状が 1 つも取れませんでした")
    buckets, kinds = {}, {}
    while True:
        sh = it.get()
        g = sh.geometry
        v = np.array(g.verts, dtype=np.float64).reshape(-1, 3)
        t = np.array(g.faces, dtype=np.int64).reshape(-1, 3)
        if len(t):
            mids = np.array(g.material_ids, dtype=np.int64) if len(g.material_ids) else np.full(len(t), -1)
            mats = list(g.materials)
            for mid in np.unique(mids):
                col = rgba_of(mats[mid]) if 0 <= mid < len(mats) else FALLBACK
                buckets.setdefault(col, []).append((v, t[mids == mid]))
            name = (f.by_id(sh.id).Name or f.by_id(sh.id).is_a()).split("$")[0]
            kinds.setdefault(name, []).append(v[t])
        if not it.next():
            break
    return buckets, {k: np.concatenate(x) for k, x in kinds.items()}


def write_plan(kinds, points, path, title, seg=110.0):
    """全体図＋区間ごとの拡大図（縦に並べる）。基準点はすべて番号付きで描く"""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.collections import PolyCollection
    plt.rcParams["font.family"] = ["Yu Gothic", "Meiryo", "MS Gothic", "sans-serif"]
    pal = ["#868e96", "#d9480f", "#1971c2", "#2f9e44", "#ae3ec9"]
    names = {"DUCT": "管路", "CCBOX": "特殊部"}
    allp = np.concatenate([p.reshape(-1, 3) for p in kinds.values()])
    xy = np.array([(p["x"], p["y"]) for p in points])
    # 区間：点を延長の向きへ投影して seg m ごとに分ける
    c0 = allp[:, :2].mean(axis=0)
    u = np.linalg.svd(allp[::max(1, len(allp) // 20000), :2] - c0, full_matrices=False)[2][0]
    t = (xy - c0) @ u
    lo_t = t.min()
    bins = np.floor((t - lo_t) / seg).astype(int)
    groups = [np.where(bins == k)[0] for k in range(bins.max() + 1)]
    groups = [g for g in groups if len(g)]
    fig = plt.figure(figsize=(9, 7.5 + 6.2 * len(groups)), dpi=100)
    gs = fig.add_gridspec(1 + len(groups), 1, height_ratios=[7.5] + [6.2] * len(groups))

    def draw(ax, lab_size, ms):
        for i, (kind, tri) in enumerate(sorted(kinds.items())):
            ax.add_collection(PolyCollection(tri[:, :, :2], facecolors=pal[i % len(pal)], edgecolors="none",
                                             label=names.get(kind, kind)))
        ax.plot(xy[:, 0], xy[:, 1], "o", ms=ms, mfc="white", mec="#1a6fd6", mew=2, zorder=5)
        ax.set_aspect("equal")

    ax = fig.add_subplot(gs[0])
    draw(ax, 8, 5)
    for k, g in enumerate(groups):
        cx, cy = xy[g].mean(axis=0)
        ax.annotate(f"区間{k + 1}（{points[g[0]]['name']}〜{points[g[-1]]['name']}）", (cx, cy), xytext=(12, -14),
                    textcoords="offset points", fontsize=10, color="#1a6fd6", fontweight="bold")
    ax.set_xlim(allp[:, 0].min() - 5, allp[:, 0].max() + 5)
    ax.set_ylim(allp[:, 1].min() - 5, allp[:, 1].max() + 5)
    ax.grid(True, color="#dddddd", lw=0.5)
    ax.ticklabel_format(useOffset=False, style="plain")
    ax.set_xlabel("X（東）m")
    ax.set_ylabel("Y（北）m")
    ax.legend(loc="upper left", fontsize=10)
    ax.set_title(f"{title}\n基準点 {len(points)} 点（〇）", fontsize=13)
    for k, g in enumerate(groups):
        ax = fig.add_subplot(gs[k + 1])
        draw(ax, 11, 8)
        for i in g:
            ax.annotate(points[i]["name"], xy[i], xytext=(6, 6), textcoords="offset points",
                        fontsize=11, fontweight="bold", color="#1a6fd6", zorder=6)
        x0, y0 = xy[g].min(axis=0)
        x1, y1 = xy[g].max(axis=0)
        r = max(x1 - x0, y1 - y0) / 2 + 6
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        ax.set_xlim(cx - r, cx + r)
        ax.set_ylim(cy - r, cy + r)
        ax.grid(True, color="#eeeeee", lw=0.5)
        ax.tick_params(labelsize=8)
        ax.ticklabel_format(useOffset=False, style="plain")
        ax.set_title(f"区間{k + 1}　" + "　".join(f"{points[i]['name']} 標高 {points[i]['z']:.2f}" for i in g[:4])
                     + ("…" if len(g) > 4 else ""), fontsize=10)
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)


def read_points(a):
    """--points-csv（番号,X,Y,Z。1 行目は見出し）か --points（"X,Y,Z;X,Y,Z"）"""
    pts = []
    if a.points_csv:
        import csv
        with open(a.points_csv, encoding="utf-8-sig") as fi:
            rows = list(csv.reader(fi))
        for r in rows[1:]:
            if len(r) < 4 or not r[1].strip():
                continue
            name = r[0].strip()
            pts.append({"name": f"P{name}" if name.isdigit() else (name or f"P{len(pts) + 1}"),
                        "x": float(r[1]), "y": float(r[2]), "z": float(r[3]),
                        "note": os.path.basename(a.points_csv)})
    else:
        notes = a.points_note.split(";") if a.points_note else []
        for k, s in enumerate(a.points.split(";")):
            x, y, z = (float(c) for c in s.split(","))
            pts.append({"name": f"P{k + 1}", "x": x, "y": y, "z": z, "note": notes[k] if k < len(notes) else "指定した点"})
    if len(pts) < 2:
        raise SystemExit("基準点は 2 点以上要ります")
    return pts


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("ifc")
    ap.add_argument("--out", required=True, help="出力フォルダ（例 SITE1）")
    ap.add_argument("--title", default="IFC モデル")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--points", help='基準点 "X,Y,Z;X,Y,Z"（m）')
    g.add_argument("--points-csv", help="基準点の CSV（番号,X,Y,Z。1 行目は見出し。何点でもよい）")
    ap.add_argument("--points-note", default="", help="点の説明（; 区切り。config.json の note に入る）")
    ap.add_argument("--skip", default=DEFAULT_SKIP)
    ap.add_argument("--no-compress", action="store_true", help="meshopt で詰めない（tools/compress.mjs を通さない）")
    a = ap.parse_args()
    out = a.out if os.path.isabs(a.out) else os.path.join(ROOT, a.out)

    pts = read_points(a)

    buckets, kinds = read_ifc(a.ifc, a.skip)
    allv = np.concatenate([v for parts in buckets.values() for v, _ in parts])
    lo, hi = allv.min(axis=0), allv.max(axis=0)
    org = np.array([round((lo[0] + hi[0]) / 2), round((lo[1] + hi[1]) / 2), 0.0])

    groups = {}
    for col, parts in buckets.items():
        vs, ts, base = [], [], 0
        for v, t in parts:
            vs.append(v - org)
            ts.append(t + base)
            base += len(v)
        groups[col] = (zup_to_yup(np.concatenate(vs)), np.concatenate(ts))

    os.makedirs(out, exist_ok=True)
    copy_page(out)                            # 新しいフォルダには入口のひな形を写す（中身は common/）
    n = write_glb(os.path.join(out, "model.glb"), groups, name="model", smooth=True)
    raw = n
    if not a.no_compress:
        c = compress_glb(os.path.join(out, "model.glb"))
        if c:
            n = os.path.getsize(os.path.join(out, "model.glb"))
            print(f"圧縮 {raw / 1e6:.2f} MB → {n / 1e6:.2f} MB（座標の刻み {c['stepMM']} mm）")
    cfg = {
        "title": a.title,
        "version": time.strftime("%Y%m%d%H%M%S"),
        "model": "model.glb",
        "plan": "plan.png",
        "coords": "図面の座標（X=東・Y=北・Z=標高、m）",
        "origin": {"x": float(org[0]), "y": float(org[1]), "z": float(org[2])},
        "points": pts,
    }
    with open(os.path.join(out, "config.json"), "w", encoding="utf-8", newline="\n") as fo:
        json.dump(cfg, fo, ensure_ascii=False, indent=2)
        fo.write("\n")
    write_plan(kinds, pts, os.path.join(out, "plan.png"), a.title)

    print(f"model.glb {n / 1e6:.2f} MB")
    for kind, tri in sorted(kinds.items()):
        print(f"  {kind:8s} 三角形 {len(tri):7d}")
    print(f"  範囲 X {lo[0]:.2f}〜{hi[0]:.2f}  Y {lo[1]:.2f}〜{hi[1]:.2f}  Z {lo[2]:.2f}〜{hi[2]:.2f}")
    print(f"  origin X {org[0]:.0f}  Y {org[1]:.0f}")
    for p in pts:
        print(f"  {p['name']}  X {p['x']:.3f}  Y {p['y']:.3f}  Z {p['z']:.3f}")
    if n > 15e6:
        print("  ★15MB を超えています。スマホで開くのに時間がかかります（README「重いとき」）")


if __name__ == "__main__":
    main()
