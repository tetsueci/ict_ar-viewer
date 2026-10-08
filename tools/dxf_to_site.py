"""道路モデルの DXF → align/ の一式（model.glb・config.json・plan.png）。

    python tools/dxf_to_site.py <model.dxf> [--box road_box.lsp] [--title 名前]

- 読む図形: POLYLINE（ポリゴンメッシュ・ポリフェースメッシュ）、3DFACE、LINE
- 3DSOLID は DXF から形を読めないので、road.py が書いた road_box.lsp（*kk_box*）から
  ボックスカルバートを作り直す（中心・向き・延長・外形・内空・頂版ハンチ）
- ★基準点 = 鉛直の LINE（Z 方向に立てた線）の下の端。見つけた順に P1・P2
- 座標は図面のまま（m・Z 上向き）。原点へ寄せない（基準点で現場に合わせるため）
"""
import argparse
import json
import math
import os
import re
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from glb import copy_page, write_glb, zup_to_yup  # noqa: E402

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

# 画層ごとの色（RGB 0〜1）。無い画層は灰色
LAYER_COLOR = {
    "RDM_ROAD": (0.33, 0.33, 0.35),
    "RDM_RAMP": (0.38, 0.38, 0.40),
    "RDM_SUBROAD": (0.55, 0.55, 0.55),
    "RDM_SLOPE_FILL": (0.47, 0.62, 0.36),
    "RDM_SLOPE_CONE": (0.52, 0.66, 0.40),
    "RDM_BOX": (0.78, 0.78, 0.74),
}
# 上に無い画層は名前の頭で決める（上から順に当てる）。plan の重ね順もこの順（下に敷くものから）
LAYER_RULES = [
    ("GROUND_", (0.62, 0.55, 0.42)),            # 地表面
    ("GI_", (0.58, 0.50, 0.66)),                # 地盤改良
    ("SLOPE_", (0.47, 0.62, 0.36)),             # 法面
    ("WALL_", (0.80, 0.74, 0.60)),              # 補強土壁
    ("ROAD_", (0.33, 0.33, 0.35)),              # 路面
    ("MARK_", (0.96, 0.96, 0.96)),              # 白線
    ("STR_ラバーポール", (0.95, 0.55, 0.10)),
    ("STR_防護柵", (0.86, 0.86, 0.89)),
    ("STR_立入防止柵", (0.45, 0.60, 0.45)),
    ("STR_側溝", (0.66, 0.66, 0.64)),
    ("STR_", (0.78, 0.78, 0.74)),               # 構造物（ボックス・橋台・翼壁など）
]


def color_of(lay):
    if lay in LAYER_COLOR:
        return LAYER_COLOR[lay]
    for head, col in LAYER_RULES:
        if lay.startswith(head):
            return col
    return (0.7, 0.7, 0.7)


def layer_order(lay):
    for k, (head, _) in enumerate(LAYER_RULES):
        if lay.startswith(head):
            return k
    return -1                                   # RDM_* などは先に（いままでどおり）


def read_pairs(path):
    lines = open(path, encoding="utf-8", errors="replace").read().splitlines()
    return [(lines[i].strip(), lines[i + 1].strip()) for i in range(0, len(lines) - 1, 2)]


def entities(pairs):
    """ENTITIES の中を (種類, {コード: [値…]}) で返す"""
    sec, cur, out = None, None, []
    for i, (c, v) in enumerate(pairs):
        if c == "0" and v == "SECTION":
            sec = pairs[i + 1][1]
            continue
        if sec != "ENTITIES":
            continue
        if c == "0":
            cur = (v, {})
            out.append(cur)
        elif cur is not None:
            cur[1].setdefault(c, []).append(v)
    return out


def f(d, k, i=0, default=0.0):
    try:
        return float(d[k][i])
    except (KeyError, IndexError):
        return default


def parse(path):
    ents = entities(read_pairs(path))
    faces = {}          # 画層 → [(p0,p1,p2), …]
    lines = []
    i = 0
    while i < len(ents):
        kind, d = ents[i]
        lay = d.get("8", ["0"])[0]
        if kind == "3DFACE":
            p = [(f(d, "1%d" % k), f(d, "2%d" % k), f(d, "3%d" % k)) for k in range(4)]
            tri = faces.setdefault(lay, [])
            tri.append((p[0], p[1], p[2]))
            if p[3] != p[2]:
                tri.append((p[0], p[2], p[3]))
        elif kind == "LINE":
            lines.append(((f(d, "10"), f(d, "20"), f(d, "30")), (f(d, "11"), f(d, "21"), f(d, "31")), lay))
        elif kind == "POLYLINE":
            flag = int(f(d, "70"))
            m, n = int(f(d, "71")), int(f(d, "72"))
            verts, recs = [], []
            j = i + 1
            while j < len(ents) and ents[j][0] == "VERTEX":
                vd = ents[j][1]
                vf = int(f(vd, "70"))
                if flag & 64 and vf & 128 and not vf & 64:          # 面の記録
                    recs.append([int(f(vd, k)) for k in ("71", "72", "73", "74") if k in vd])
                else:
                    verts.append((f(vd, "10"), f(vd, "20"), f(vd, "30")))
                j += 1
            tri = faces.setdefault(lay, [])
            if flag & 64:                                        # ポリフェースメッシュ
                for r in recs:
                    idx = [abs(k) - 1 for k in r if k != 0]
                    for a in range(1, len(idx) - 1):
                        tri.append((verts[idx[0]], verts[idx[a]], verts[idx[a + 1]]))
            elif flag & 16:                                      # M×N のポリゴンメッシュ
                cm, cn = flag & 1, flag & 32
                g = lambda a, b: verts[(a % m) * n + (b % n)]    # noqa: E731
                for a in range(m - 1 + (1 if cm else 0)):
                    for b in range(n - 1 + (1 if cn else 0)):
                        tri.append((g(a, b), g(a + 1, b), g(a + 1, b + 1)))
                        tri.append((g(a, b), g(a + 1, b + 1), g(a, b + 1)))
            i = j
            continue
        i += 1
    return faces, lines


# ---------- ボックスカルバート（road_box.lsp から） ----------
def read_boxes(path):
    txt = open(path, encoding="cp932", errors="replace").read()
    out = []
    for m in re.finditer(r'\(list "([^"]*)"\s+([^()]*?)\(list ([^)]*)\)\s*\(list ([^)]*)\)\s*([-\d.]+)\)', txt):
        nums = [float(x) for x in m.group(2).split()]
        cx, cy, ang, L, wout, zo0, zo1, zi0, zi1 = nums
        cells = [float(x) for x in m.group(3).split()]
        widths = [float(x) for x in m.group(4).split()]
        out.append(dict(name=m.group(1), cx=cx, cy=cy, ang=ang, L=L, wout=wout, zo=(zo0, zo1), zi=(zi0, zi1),
                        cells=cells, widths=widths, hh=float(m.group(5))))
    return out


def box_triangles(b):
    """断面（v, z）＝外形の長方形 − 内空（上の角にハンチ）を、軸 u に沿って ±L/2 押し出す"""
    ux, uy = math.cos(b["ang"]), math.sin(b["ang"])
    vx, vy = -uy, ux
    hw, hl = b["wout"] / 2, b["L"] / 2
    zo0, zo1 = b["zo"]
    zi0, zi1 = b["zi"]
    h = b["hh"]

    def W(u, v, z):
        return (b["cx"] + u * ux + v * vx, b["cy"] + u * uy + v * vy, z)

    outer = [(-hw, zo0), (hw, zo0), (hw, zo1), (-hw, zo1)]
    holes = []
    for c, w in zip(b["cells"], b["widths"]):
        a, e = c - w / 2, c + w / 2
        holes.append([(a, zi0), (e, zi0), (e, zi1 - h), (e - h, zi1), (a + h, zi1), (a, zi1 - h)])

    tris = []
    # 側面（外形と内空の輪を押し出す）
    for ring in [outer] + holes:
        for k in range(len(ring)):
            (v0, z0), (v1, z1) = ring[k], ring[(k + 1) % len(ring)]
            p = [W(-hl, v0, z0), W(-hl, v1, z1), W(hl, v1, z1), W(hl, v0, z0)]
            tris += [(p[0], p[1], p[2]), (p[0], p[2], p[3])]

    # 両端の小口：v の区切りで帯に分け、帯ごとに「中身のある z の区間」を台形で埋める
    cuts = sorted({-hw, hw} | {v for r in holes for v, _ in r})

    def top_of(hole, v):         # 内空の上の縁（ハンチで折れる）
        a, e = hole[0][0], hole[1][0]
        return min(zi1, zi1 - h + (v - a), zi1 - h + (e - v))

    for va, vb in zip(cuts, cuts[1:]):
        vm = (va + vb) / 2
        spans = [(lambda v: zo0, lambda v: zo1)]
        for hole in holes:
            a, e = hole[0][0], hole[1][0]
            if a <= vm <= e:
                new = []
                for lo, hi in spans:
                    new.append((lo, lambda v, hole=hole: zi0))
                    new.append((lambda v, hole=hole: top_of(hole, v), hi))
                spans = new
        for lo, hi in spans:
            q = [(va, lo(va)), (vb, lo(vb)), (vb, hi(vb)), (va, hi(va))]
            if q[3][1] - q[0][1] < 1e-9 and q[2][1] - q[1][1] < 1e-9:
                continue
            for u in (-hl, hl):
                p = [W(u, v, z) for v, z in q]
                tris += [(p[0], p[1], p[2]), (p[0], p[2], p[3])]
    return tris


def box_volume(b):
    area = b["wout"] * (b["zo"][1] - b["zo"][0])
    for w in b["widths"]:
        area -= w * (b["zi"][1] - b["zi"][0]) - b["hh"] ** 2      # ハンチ 2 か所 × h²/2
    return area * b["L"]


# ---------- 平面図 ----------
def write_plan(faces, points, path, title):
    if len(points) < 2:
        return write_plan_nopoints(faces, path, title)
    return write_plan_points(faces, points, path, title)


def write_plan_nopoints(faces, path, title):
    """基準点を前もって決めない現場（start = pick。AR の前に点群の上で点を拾う）の平面図と凡例"""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.collections import PolyCollection
    plt.rcParams["font.family"] = ["Yu Gothic", "Meiryo", "MS Gothic", "sans-serif"]
    lays = sorted((l for l in faces if faces[l]), key=lambda l: (layer_order(l), l))
    allp = np.array([p for l in lays for t in faces[l] for p in t])
    span = allp.max(axis=0) - allp.min(axis=0)
    tall = span[1] > span[0] * 1.3                  # 縦に長い現場は 図｜凡例 を横に並べる
    fig = plt.figure(figsize=(11, 9) if tall else (11, 8.6), dpi=110)
    gs = fig.add_gridspec(1, 2, width_ratios=[1.4, 1]) if tall else fig.add_gridspec(2, 1, height_ratios=[2.6, 1])
    ax = fig.add_subplot(gs[0])
    leg = fig.add_subplot(gs[1])
    for lay in lays:
        polys = [[(p[0], p[1]) for p in t] for t in faces[lay]]
        ax.add_collection(PolyCollection(polys, facecolors=[color_of(lay)], edgecolors="none"))
    ax.set_xlim(allp[:, 0].min() - 5, allp[:, 0].max() + 5)
    ax.set_ylim(allp[:, 1].min() - 5, allp[:, 1].max() + 5)
    ax.set_aspect("equal")
    ax.grid(True, color="#dddddd", lw=0.5)
    ax.set_xlabel("X（東）m")
    ax.set_ylabel("Y（北）m")
    ax.set_title(f"{title}\n基準点は AR の前に点群の上で選ぶ", fontsize=12)
    leg.axis("off")
    ncol = 1 if tall else 3                         # 画層の名前はそのまま書く（頭を外すと「ランプ」が 2 つになる）
    per = (len(lays) + ncol - 1) // ncol
    step = 0.9 / max(per, 1)
    for k, lay in enumerate(lays):
        cx, cy = (k // per) / ncol, 0.95 - (k % per) * step
        leg.add_patch(plt.Rectangle((cx + 0.01, cy - step * 0.35), 0.05 if tall else 0.03, step * 0.7,
                                    color=color_of(lay), ec="#888888", lw=0.4, transform=leg.transAxes))
        leg.text(cx + (0.08 if tall else 0.05), cy, lay, transform=leg.transAxes, va="center", fontsize=9.5)
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)


def write_plan_points(faces, points, path, title):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.collections import PolyCollection
    plt.rcParams["font.family"] = ["Yu Gothic", "Meiryo", "MS Gothic", "sans-serif"]
    fig = plt.figure(figsize=(11, 8.2), dpi=110)
    gs = fig.add_gridspec(2, 2, height_ratios=[1.35, 1], width_ratios=[1, 1.25])
    ax = fig.add_subplot(gs[0, :])
    ins = fig.add_subplot(gs[1, 0])
    leg = fig.add_subplot(gs[1, 1])
    for lay in ["RDM_SLOPE_FILL", "RDM_SLOPE_CONE", "RDM_SUBROAD", "RDM_RAMP", "RDM_ROAD", "RDM_BOX"]:
        if lay not in faces:
            continue
        polys = [[(p[0], p[1]) for p in t] for t in faces[lay]]
        col = LAYER_COLOR.get(lay, (0.7, 0.7, 0.7))
        ax.add_collection(PolyCollection(polys, facecolors=[col], edgecolors="none", alpha=0.85 if lay != "RDM_BOX" else 1))
    allp = np.array([p for t in sum(faces.values(), []) for p in t])
    ax.set_xlim(allp[:, 0].min() - 5, allp[:, 0].max() + 5)
    ax.set_ylim(allp[:, 1].min() - 5, allp[:, 1].max() + 5)
    cols = ["#1a6fd6", "#e8590c"]
    for k, p in enumerate(points):
        ax.plot(p["x"], p["y"], "o", ms=9, mfc="white", mec=cols[k], mew=2.5, zorder=5)
        ax.annotate(p["name"], (p["x"], p["y"]), xytext=(8, 8 if k == 0 else -18), textcoords="offset points",
                    color=cols[k], fontsize=13, fontweight="bold", zorder=6)
    ax.set_aspect("equal")
    ax.grid(True, color="#dddddd", lw=0.5)
    ax.set_xlabel("X（東）m")
    ax.set_ylabel("Y（北）m")
    d = math.hypot(points[1]["x"] - points[0]["x"], points[1]["y"] - points[0]["y"])
    ax.set_title(f"{title}\nP1–P2 {d:.2f} m（点の高さ {points[0]['z']:.2f} / {points[1]['z']:.2f}）", fontsize=12)
    # 基準点のまわりの拡大
    for lay in ["RDM_SLOPE_FILL", "RDM_SUBROAD", "RDM_BOX"]:
        if lay in faces:
            ins.add_collection(PolyCollection([[(p[0], p[1]) for p in t] for t in faces[lay]],
                                              facecolors=[LAYER_COLOR.get(lay)], edgecolors="#999999", linewidths=0.2))
    mx = (points[0]["x"] + points[1]["x"]) / 2
    my = (points[0]["y"] + points[1]["y"]) / 2
    r = max(d, 6) * 1.2
    ins.set_xlim(mx - r, mx + r)
    ins.set_ylim(my - r, my + r)
    ins.set_aspect("equal")
    ins.set_xticks([])
    ins.set_yticks([])
    for k, p in enumerate(points):
        ins.plot(p["x"], p["y"], "o", ms=8, mfc="white", mec=cols[k], mew=2.5)
        ins.annotate(p["name"], (p["x"], p["y"]), xytext=(6, 6), textcoords="offset points", color=cols[k], fontweight="bold")
    ins.plot([points[0]["x"], points[1]["x"]], [points[0]["y"], points[1]["y"]], "-", color="#333333", lw=1)
    ins.set_title("基準点のまわり", fontsize=9)
    leg.axis("off")
    names = {"RDM_ROAD": "本線の路面", "RDM_RAMP": "ランプ", "RDM_SUBROAD": "ボックスの中の道路",
             "RDM_SLOPE_FILL": "盛土の法面", "RDM_SLOPE_CONE": "坑口の法面", "RDM_BOX": "ボックスカルバート"}
    yy = 0.95
    for lay, nm in names.items():
        if lay in faces:
            leg.add_patch(plt.Rectangle((0.02, yy - 0.05), 0.08, 0.07, color=LAYER_COLOR[lay], transform=leg.transAxes))
            leg.text(0.13, yy - 0.015, nm, transform=leg.transAxes, va="center", fontsize=11)
            yy -= 0.11
    leg.text(0.02, yy - 0.04, "〇 基準点", transform=leg.transAxes, fontsize=11, va="center")
    leg.text(0.02, yy - 0.15, "\n".join(f"{p['name']}  X {p['x']:.3f}  Y {p['y']:.3f}  Z {p['z']:.3f}" for p in points),
             transform=leg.transAxes, fontsize=10.5, va="top", family="monospace")
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dxf")
    ap.add_argument("--box", help="road_box.lsp（無ければ DXF と同じフォルダを探す）")
    ap.add_argument("--title", default="道路モデル")
    ap.add_argument("--out", default=os.path.join(ROOT, "align"))
    ap.add_argument("--points", help='基準点を直接指定 "X,Y,Z;X,Y,Z"（鉛直の LINE より優先）')
    ap.add_argument("--points-note", default="", help="--points の点の説明（config.json の note に入る）")
    ap.add_argument("--origin", help='座標から引く原点 "X,Y,Z" か auto（100 m 単位に丸めた中心）。'
                                     '平面直角座標のままだと float32 で mm が崩れるので、大きい座標なら付ける')
    ap.add_argument("--no-plan", action="store_true",
                    help="平面図（plan.png）を作らず、config.json の plan も外す（起動画面の地図で足りる現場）")
    ap.add_argument("--start", help="基準点を前もって決めないとき pick（AR の前に点群の上で選ぶ。点群が要る）")
    a = ap.parse_args()

    faces, lines = parse(a.dxf)
    box = a.box or os.path.join(os.path.dirname(os.path.abspath(a.dxf)), "road_box.lsp")
    boxes = read_boxes(box) if os.path.exists(box) else []
    for b in boxes:
        faces.setdefault("RDM_BOX", []).extend(box_triangles(b))

    # 基準点：鉛直の LINE の下の端
    pts = []
    for p, q, lay in lines:
        if math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6 and abs(p[2] - q[2]) > 1:
            lo = p if p[2] < q[2] else q
            pts.append({"name": f"P{len(pts) + 1}", "x": round(lo[0], 4), "y": round(lo[1], 4), "z": round(lo[2], 4),
                        "note": f"鉛直の線（長さ {abs(p[2] - q[2]):.1f} m）の下の端"})
    if a.points:
        notes = a.points_note.split(";") if a.points_note else []
        pts = []
        for k, s in enumerate(a.points.split(";")):
            x, y, z = (float(c) for c in s.split(","))
            pts.append({"name": f"P{k + 1}", "x": x, "y": y, "z": z, "note": notes[k] if k < len(notes) else "指定した点"})
    if len(pts) < 2 and not a.start:
        raise SystemExit(f"鉛直の LINE が {len(pts)} 本しかありません（2 本要る。点群の上で選ぶなら --start pick）")

    O = np.zeros(3)
    if a.origin == "auto":
        allv = np.array([p for tris in faces.values() for t in tris for p in t])
        c = (allv.min(axis=0) + allv.max(axis=0)) / 2
        O = np.array([round(c[0], -2), round(c[1], -2), 0.0])
    elif a.origin:
        O = np.array([float(c) for c in a.origin.split(",")])

    groups = {}
    for lay, tris in faces.items():
        if not tris:
            continue
        col = color_of(lay) + (1.0,)
        v = np.array(tris, float).reshape(-1, 3) - O
        t = np.arange(len(v)).reshape(-1, 3)
        if col in groups:
            v0, t0 = groups[col]
            groups[col] = (np.vstack([v0, zup_to_yup(v)]), np.vstack([t0, t + len(v0)]))
        else:
            groups[col] = (zup_to_yup(v), t)

    os.makedirs(a.out, exist_ok=True)
    copy_page(a.out)                          # 新しいフォルダには入口のひな形を写す（中身は common/）
    n = write_glb(os.path.join(a.out, "model.glb"), groups, name="model")
    # 前の config.json の項目（pointcloud・finetune など）は残し、この道具が決める項目だけ書き換える
    cpath = os.path.join(a.out, "config.json")
    cfg = {}
    if os.path.exists(cpath):
        with open(cpath, encoding="utf-8") as fi:
            cfg = json.load(fi)
    cfg.update({
        "title": a.title,
        "version": __import__("time").strftime("%Y%m%d%H%M%S"),   # 画像とモデルの読み直し用（ブラウザの覚えた古いものを使わせない）
        "model": "model.glb",
        "coords": "図面の座標（X=東・Y=北・Z=標高、m）",
        "points": pts[:2],
    })
    if O.any():
        cfg["origin"] = {"x": float(O[0]), "y": float(O[1]), "z": float(O[2])}
    else:
        cfg.pop("origin", None)
    if a.start:
        cfg["start"] = a.start
    if a.no_plan:
        cfg.pop("plan", None)
    else:
        cfg["plan"] = "plan.png"
    with open(cpath, "w", encoding="utf-8", newline="\n") as fo:
        json.dump(cfg, fo, ensure_ascii=False, indent=2)
        fo.write("\n")
    if not a.no_plan:
        write_plan(faces, pts[:2], os.path.join(a.out, "plan.png"), a.title)

    print(f"model.glb {n / 1e6:.2f} MB")
    for lay, tris in sorted(faces.items()):
        print(f"  {lay:16s} 三角形 {len(tris):6d}")
    for b in boxes:
        print(f"  ボックス {b['name']}  体積 {box_volume(b):.2f} m3")
    if O.any():
        print(f"  原点 {O[0]:.0f}, {O[1]:.0f}, {O[2]:.0f}（座標から引いて入れた）")
    for p in pts:
        print(f"  {p['name']}  X {p['x']:.3f}  Y {p['y']:.3f}  Z {p['z']:.3f}")
    if len(pts) >= 2:
        print(f"  P1–P2 {math.hypot(pts[1]['x'] - pts[0]['x'], pts[1]['y'] - pts[0]['y']):.3f} m")


if __name__ == "__main__":
    main()
