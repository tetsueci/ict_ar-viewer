"""IFC → GLB（AR 用）。IfcOpenShell の形状と色をそのまま使う。

    python tools/ifc_to_glb.py 入力.ifc models/出力.glb
    python tools/ifc_to_glb.py 入力.ifc models/出力.glb --scale 0.02   # 1/50 の模型として置く
    python tools/ifc_to_glb.py 入力.ifc models/出力.glb --skip IfcSpace,IfcOpeningElement

- 単位は IfcOpenShell がメートルへ直す。Z 上向きを glTF の Y 上向きへ回す。
- 水平は中心・高さは底を 0 へ寄せる（平面直角座標のままだと float32 で崩れるため）。
- 同じ色の面は 1 つにまとめる（部材ごとに分けるとファイルも描画も重くなる）。
"""
import argparse
import math
import multiprocessing
import os
import sys

import ifcopenshell
import ifcopenshell.geom
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from glb import recenter, write_glb, zup_to_yup  # noqa: E402

DEFAULT_SKIP = "IfcSpace,IfcOpeningElement,IfcAnnotation,IfcGrid,IfcVirtualElement"
FALLBACK = (0.75, 0.75, 0.75, 1.0)


def rgba_of(m):
    """IfcOpenShell の版で diffuse の形が違う（タプル / r() を持つ物）"""
    d = getattr(m, "diffuse", None)
    try:
        r, g, b = (float(x) for x in d)
    except TypeError:
        try:
            r, g, b = float(d.r()), float(d.g()), float(d.b())
        except Exception:
            return FALLBACK
    except Exception:
        return FALLBACK
    tr = getattr(m, "transparency", 0.0)
    try:
        tr = float(tr)
    except Exception:
        tr = 0.0
    a = 1.0 if (tr is None or math.isnan(tr)) else max(0.05, 1.0 - tr)
    return tuple(round(c, 3) for c in (r, g, b, a))


def convert(src, dst, scale=1.0, skip=DEFAULT_SKIP):
    f = ifcopenshell.open(src)
    s = ifcopenshell.geom.settings()
    s.set("use-world-coords", True)
    s.set("apply-default-materials", True)
    excl = [x.strip() for x in skip.split(",") if x.strip()]
    it = ifcopenshell.geom.iterator(s, f, multiprocessing.cpu_count(),
                                    exclude=excl if excl else None)
    buckets = {}
    count = 0
    if not it.initialize():
        raise SystemExit("形状が 1 つも取れませんでした（IFC に形が無いか、全部除外された）")
    while True:
        sh = it.get()
        g = sh.geometry
        v = np.array(g.verts, dtype=np.float64).reshape(-1, 3)
        t = np.array(g.faces, dtype=np.int64).reshape(-1, 3)
        mids = np.array(g.material_ids, dtype=np.int64) if len(g.material_ids) else np.full(len(t), -1)
        mats = list(g.materials)
        if len(t):
            count += 1
            for mid in np.unique(mids):
                col = rgba_of(mats[mid]) if 0 <= mid < len(mats) else FALLBACK
                sel = t[mids == mid]
                buckets.setdefault(col, []).append((v, sel))
        if not it.next():
            break

    groups = {}
    for col, parts in buckets.items():
        vs, ts, base = [], [], 0
        for v, t in parts:
            vs.append(v)
            ts.append(t + base)
            base += len(v)
        groups[col] = (zup_to_yup(np.concatenate(vs)) * scale, np.concatenate(ts))

    groups, size = recenter(groups)
    n = write_glb(dst, groups, name=os.path.splitext(os.path.basename(dst))[0])
    ntri = sum(len(t) for _, t in groups.values())
    print(f"{dst}\n  部材 {count} 個 / 色 {len(groups)} 種 / 三角形 {ntri:,} / {n / 1e6:.2f} MB")
    print(f"  大きさ(m) 幅 {size[0]:.2f}  高さ {size[1]:.2f}  奥行 {size[2]:.2f}")
    if n > 15e6:
        print("  ★15MB を超えています。スマホで開くのに時間がかかります（README「重いとき」）")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--scale", type=float, default=1.0, help="倍率（実寸なら 1。1/50 模型なら 0.02）")
    ap.add_argument("--skip", default=DEFAULT_SKIP, help="出さない IFC クラス（カンマ区切り）")
    a = ap.parse_args()
    os.makedirs(os.path.dirname(os.path.abspath(a.dst)), exist_ok=True)
    convert(a.src, a.dst, a.scale, a.skip)


if __name__ == "__main__":
    main()
