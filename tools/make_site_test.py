"""2 点で位置を合わせる試験の一式を作る（現場の代わりの仮の配置）。

    python tools/make_site_test.py

作るもの
- models/box10_site.glb        … 延長 10 m のボックス。座標は現場座標のまま（原点 = P1。寄せない）
- sites/box10_test.json        … site.html が読む設定（モデルと基準点）
- sites/box10_test_plan.svg    … 平面図（ボックスと 2 点の関係）

現場座標: X = 東（右）、Y = 北（上）、Z = 標高。単位 m。
P1 (0, 0, 0) と P2 (5, 0, 0) は同じ標高。ボックスは P1→P2 の線に対して 30° 振り、
線から最も近い角までを 3.00 m 離して、P1 から P2 を向いたときの左側に置く。
"""
import json
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from glb import write_glb, zup_to_yup  # noqa: E402
from make_sample import W, box_culvert  # noqa: E402

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

P1 = (0.0, 0.0, 0.0)
P2 = (5.0, 0.0, 0.0)
BOX_L = 10.0
ANGLE = 30.0          # P1→P2 の線から反時計回りに測ったボックスの軸の向き（度）
GAP = 3.0             # P1→P2 の線から最も近い角までの距離
CENTER_X = 2.5        # ボックスの中心の X（2 点の真ん中の北側に置く）


def layout():
    a = math.radians(ANGLE)
    d = np.array([math.cos(a), math.sin(a)])          # 軸の向き（起点 A → 終点 B）
    r = np.array([d[1], -d[0]])                        # 軸の右手の向き
    hw, hl = W / 2, BOX_L / 2
    # 中心の Y は、4 隅のうち最も南の角が Y = GAP に来るように決める
    offs = [sx * hw * r + sy * hl * d for sx in (-1, 1) for sy in (-1, 1)]
    cy = GAP - min(o[1] for o in offs)
    c = np.array([CENTER_X, cy])
    A, B = c - hl * d, c + hl * d
    # 外形の 4 隅（A の右 → B の右 → B の左 → A の左）
    corners = [A + hw * r, B + hw * r, B - hw * r, A - hw * r]
    return A, B, d, r, corners


def build_model(A, d, r):
    v, t = box_culvert(BOX_L)                          # 局所: x=幅, y=延長, z=高さ
    xy = A[None, :] + v[:, 0:1] * r[None, :] + v[:, 1:2] * d[None, :]
    site = np.column_stack([xy, v[:, 2] + P1[2]])
    groups = {(0.58, 0.58, 0.56, 1.0): (zup_to_yup(site), t)}
    out = os.path.join(ROOT, "models", "box10_site.glb")
    n = write_glb(out, groups, name="box10_site")

    # 手で合わせる版（iPhone の Quick Look 用）：基準点の上に目印を立てたモデル
    for col, part in markers().items():
        groups[col] = part
    out2 = os.path.join(ROOT, "models", "box10_marker.glb")
    n2 = write_glb(out2, groups, name="box10_marker")

    # iPhone の Quick Look は指でひねると外形の中心で回る。
    # 見えない小さな三角を反対側に足して、外形の中心と原点を P1（P2）にそろえる
    for tag, piv in (("p1", P1), ("p2", P2)):
        write_glb(os.path.join(ROOT, "models", f"box10_marker_{tag}.glb"),
                  centered_on(groups, piv), name=f"box10_marker_{tag}")
    return out, n, out2, n2


def centered_on(groups, piv):
    g = zup_to_yup(np.array([piv], float))[0]
    out = {k: (v - g, t) for k, (v, t) in groups.items()}
    allv = np.concatenate([v for v, _ in out.values()])
    m = np.abs(allv).max(axis=0)                     # 原点から最も遠い広がり
    e = 0.01
    tri = []
    for sx, sz in ((-1, -1), (1, 1), (-1, 1), (1, -1)):
        c = np.array([sx * m[0], 0.0, sz * m[2]])
        tri.append([c, c + [-sx * e, 0, 0], c + [0, 0, -sz * e]])   # 内側へ向けて、外形を広げない
    v = np.array(tri, float).reshape(-1, 3)
    t = np.arange(len(v)).reshape(-1, 3)
    out[(0.60, 0.60, 0.58, 1.0)] = (v, t)             # 1 cm の点（透明だと model-viewer が外形に数えない）
    return out


def _merge(parts):
    vs, ts, base = [], [], 0
    for v, t in parts:
        vs.append(np.asarray(v, float))
        ts.append(np.asarray(t, int) + base)
        base += len(vs[-1])
    return np.concatenate(vs), np.concatenate(ts)


def _cyl(cx, cy, z0, z1, rad, n=16):
    a = np.linspace(0, 2 * np.pi, n, endpoint=False)
    ring = np.column_stack([cx + rad * np.cos(a), cy + rad * np.sin(a)])
    v = np.vstack([np.column_stack([ring, np.full(n, z0)]), np.column_stack([ring, np.full(n, z1)]),
                   [[cx, cy, z1]]])
    t = []
    for i in range(n):
        j = (i + 1) % n
        t += [(i, j, n + j), (i, n + j, n + i), (n + i, n + j, 2 * n)]
    return v, np.array(t)


def _ball(cx, cy, cz, rad, nu=16, nv=10):
    v, t = [], []
    for k in range(nv + 1):
        ph = np.pi * k / nv
        for i in range(nu):
            th = 2 * np.pi * i / nu
            v.append((cx + rad * np.sin(ph) * np.cos(th), cy + rad * np.sin(ph) * np.sin(th), cz + rad * np.cos(ph)))
    for k in range(nv):
        for i in range(nu):
            a, b = k * nu + i, k * nu + (i + 1) % nu
            t += [(a, a + nu, b + nu), (a, b + nu, b)]
    return np.array(v), np.array(t)


def _ring(cx, cy, z, r0, r1, n=40):
    a = np.linspace(0, 2 * np.pi, n, endpoint=False)
    inner = np.column_stack([cx + r0 * np.cos(a), cy + r0 * np.sin(a), np.full(n, z)])
    outer = np.column_stack([cx + r1 * np.cos(a), cy + r1 * np.sin(a), np.full(n, z)])
    t = []
    for i in range(n):
        j = (i + 1) % n
        t += [(i, n + i, n + j), (i, n + j, j)]
    return np.vstack([inner, outer]), np.array(t)


def _strip(p, q, z, w):
    d = np.array(q[:2]) - np.array(p[:2])
    nrm = np.array([-d[1], d[0]]) / np.linalg.norm(d) * w / 2
    v = [(p[0] + nrm[0], p[1] + nrm[1], z), (q[0] + nrm[0], q[1] + nrm[1], z),
         (q[0] - nrm[0], q[1] - nrm[1], z), (p[0] - nrm[0], p[1] - nrm[1], z)]
    return np.array(v), np.array([(0, 3, 2), (0, 2, 1)])


def markers():
    """P1（青）・P2（橙）に高さ 1.5 m の旗竿と地面の輪、2 点を結ぶ白い帯。

    輪の中心が点。竿は遠くから見つけるため、輪は足もとで合わせるため。
    """
    H, z = 1.5, P1[2]
    out = {}
    for p, col, rings in ((P1, (0.10, 0.44, 0.84, 1.0), 1), (P2, (0.94, 0.55, 0.0, 1.0), 2)):
        parts = [_cyl(p[0], p[1], z, z + H, 0.02), _ball(p[0], p[1], z + H, 0.08)]
        for k in range(rings):                     # P1 は輪 1 本、P2 は 2 本（色を見分けにくいとき用）
            parts.append(_ring(p[0], p[1], z + 0.004, 0.10 + 0.12 * k, 0.15 + 0.12 * k))
        parts.append(_ring(p[0], p[1], z + 0.004, 0.0, 0.02))   # 中心の点
        v, t = _merge(parts)
        out[col] = (zup_to_yup(v), t)
    v, t = _strip((P1[0] + 0.3, P1[1]), (P2[0] - 0.3, P2[1]), z + 0.002, 0.04)
    out[(1.0, 1.0, 1.0, 1.0)] = (zup_to_yup(v), t)
    return out


def write_config():
    cfg = {
        "title": "位置合わせの試験（ボックス 10 m）",
        "model": "../models/box10_site.glb",
        "plan": "box10_test_plan.svg",
        "coords": "現場座標（X=東・Y=北・Z=標高、m）。原点は P1",
        "points": [
            {"name": "P1", "x": P1[0], "y": P1[1], "z": P1[2], "note": "1 点目"},
            {"name": "P2", "x": P2[0], "y": P2[1], "z": P2[2], "note": "2 点目（P1 から 5 m）"},
        ],
    }
    os.makedirs(os.path.join(ROOT, "sites"), exist_ok=True)
    path = os.path.join(ROOT, "sites", "box10_test.json")
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
        f.write("\n")
    return path


def write_align(glb, plan):
    """align/（位置合わせモードのページ）の中身。フォルダの中だけで完結させる"""
    import shutil
    dst = os.path.join(ROOT, "align")
    os.makedirs(dst, exist_ok=True)
    shutil.copyfile(glb, os.path.join(dst, "model.glb"))
    shutil.copyfile(plan, os.path.join(dst, "plan.svg"))
    cfg = {
        "title": "位置合わせの試験（ボックス 10 m）",
        "model": "model.glb",
        "plan": "plan.svg",
        "coords": "現場座標（X=東・Y=北・Z=標高、m）。原点は P1",
        "points": [
            {"name": "P1", "x": P1[0], "y": P1[1], "z": P1[2], "note": "青い竿・輪 1 本"},
            {"name": "P2", "x": P2[0], "y": P2[1], "z": P2[2], "note": "橙の竿・輪 2 本（P1 から 5 m）"},
        ],
    }
    with open(os.path.join(dst, "config.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
        f.write("\n")


def write_plan(A, B, d, r, corners):
    S = 42.0                                   # 1 m の画素数
    x0, x1, y0, y1 = -4.0, 10.0, -5.5, 13.0    # 描く範囲（m）
    Wpx, Hpx = (x1 - x0) * S, (y1 - y0) * S
    X = lambda x: (x - x0) * S                 # noqa: E731
    Y = lambda y: (y1 - y) * S                 # noqa: E731  北が上
    f2 = lambda v: f"{v:.2f}"                  # noqa: E731

    e = []
    e.append(f'<rect width="{Wpx:.0f}" height="{Hpx:.0f}" fill="#ffffff"/>')
    for gx in range(int(x0), int(x1) + 1):
        e.append(f'<line x1="{X(gx):.1f}" y1="0" x2="{X(gx):.1f}" y2="{Hpx:.0f}" stroke="#e3e6ea" stroke-width="{1.4 if gx % 5 == 0 else 0.7}"/>')
    for gy in range(int(y0), int(y1) + 1):
        e.append(f'<line x1="0" y1="{Y(gy):.1f}" x2="{Wpx:.0f}" y2="{Y(gy):.1f}" stroke="#e3e6ea" stroke-width="{1.4 if gy % 5 == 0 else 0.7}"/>')

    # P1–P2 の線（延長は点線）
    e.append(f'<line x1="{X(-3.5):.1f}" y1="{Y(0):.1f}" x2="{X(9.5):.1f}" y2="{Y(0):.1f}" stroke="#1a6fd6" stroke-width="1.2" stroke-dasharray="6 5"/>')
    e.append(f'<line x1="{X(P1[0]):.1f}" y1="{Y(0):.1f}" x2="{X(P2[0]):.1f}" y2="{Y(0):.1f}" stroke="#1a6fd6" stroke-width="3"/>')

    # ボックスの外形・内空・軸
    pts = " ".join(f"{X(p[0]):.1f},{Y(p[1]):.1f}" for p in corners)
    e.append(f'<polygon points="{pts}" fill="#d9d9d4" stroke="#44474d" stroke-width="2"/>')
    from make_sample import T_WALL
    iw = W / 2 - T_WALL
    inner = [A + iw * r, B + iw * r, B - iw * r, A - iw * r]
    pts = " ".join(f"{X(p[0]):.1f},{Y(p[1]):.1f}" for p in inner)
    e.append(f'<polygon points="{pts}" fill="none" stroke="#44474d" stroke-width="1" stroke-dasharray="5 4"/>')
    e.append(f'<line x1="{X(A[0]):.1f}" y1="{Y(A[1]):.1f}" x2="{X(B[0]):.1f}" y2="{Y(B[1]):.1f}" stroke="#c0392b" stroke-width="1.2" stroke-dasharray="10 4 2 4"/>')
    for p, lab, dx in ((A, "A", -16), (B, "B", 8)):
        e.append(f'<circle cx="{X(p[0]):.1f}" cy="{Y(p[1]):.1f}" r="3.5" fill="#c0392b"/>')
        e.append(f'<text x="{X(p[0]) + dx:.1f}" y="{Y(p[1]) - 6:.1f}" font-size="15" font-weight="600" fill="#c0392b">{lab}</text>')

    # 線から最も近い角までの 3.00 m
    k = min(corners, key=lambda p: p[1])
    e.append(f'<line x1="{X(k[0]):.1f}" y1="{Y(k[1]):.1f}" x2="{X(k[0]):.1f}" y2="{Y(0):.1f}" stroke="#2b8a3e" stroke-width="1.5" marker-start="url(#ar)" marker-end="url(#ar)"/>')
    e.append(f'<text x="{X(k[0]) + 6:.1f}" y="{Y(k[1] / 2) + 5:.1f}" font-size="14" fill="#2b8a3e">{f2(k[1])} m</text>')
    e.append(f'<circle cx="{X(k[0]):.1f}" cy="{Y(k[1]):.1f}" r="3" fill="#2b8a3e"/>')

    # 角度 30°（A から P1→P2 と同じ向きの補助線と円弧）
    e.append(f'<line x1="{X(A[0]):.1f}" y1="{Y(A[1]):.1f}" x2="{X(A[0] + 3.2):.1f}" y2="{Y(A[1]):.1f}" stroke="#888" stroke-width="1" stroke-dasharray="4 3"/>')
    rr = 2.4
    a = math.radians(ANGLE)
    e.append(f'<path d="M {X(A[0] + rr):.1f} {Y(A[1]):.1f} A {rr * S:.1f} {rr * S:.1f} 0 0 0 {X(A[0] + rr * math.cos(a)):.1f} {Y(A[1] + rr * math.sin(a)):.1f}" fill="none" stroke="#888" stroke-width="1.2"/>')
    e.append(f'<text x="{X(A[0] + 2.55):.1f}" y="{Y(A[1] + 0.45):.1f}" font-size="14" fill="#555">{ANGLE:.0f}°</text>')

    # 寸法 5.000 m
    yd = -1.2
    e.append(f'<line x1="{X(P1[0]):.1f}" y1="{Y(yd):.1f}" x2="{X(P2[0]):.1f}" y2="{Y(yd):.1f}" stroke="#1a6fd6" stroke-width="1.2" marker-start="url(#ar)" marker-end="url(#ar)"/>')
    for p in (P1, P2):
        e.append(f'<line x1="{X(p[0]):.1f}" y1="{Y(-0.2):.1f}" x2="{X(p[0]):.1f}" y2="{Y(yd - 0.3):.1f}" stroke="#1a6fd6" stroke-width="0.8"/>')
    e.append(f'<text x="{X(2.5):.1f}" y="{Y(yd) + 18:.1f}" font-size="14" fill="#1a6fd6" text-anchor="middle">5.00 m（同じ標高）</text>')

    # 基準点
    for p, lab in ((P1, "P1"), (P2, "P2")):
        e.append(f'<circle cx="{X(p[0]):.1f}" cy="{Y(p[1]):.1f}" r="8" fill="#ffffff" stroke="#1a6fd6" stroke-width="2.5"/>')
        e.append(f'<circle cx="{X(p[0]):.1f}" cy="{Y(p[1]):.1f}" r="2.5" fill="#1a6fd6"/>')
        e.append(f'<text x="{X(p[0]):.1f}" y="{Y(p[1]) - 14:.1f}" font-size="17" font-weight="700" fill="#1a6fd6" text-anchor="middle">{lab}</text>')

    # ボックスの札
    c = (A + B) / 2 + 0.75 * r
    e.append(f'<text x="{X(c[0]):.1f}" y="{Y(c[1]):.1f}" font-size="14" fill="#222" text-anchor="middle" transform="rotate({-ANGLE:.0f} {X(c[0]):.1f} {Y(c[1]):.1f})">ボックス 延長 {BOX_L:.1f} m × 幅 {W:.1f} m</text>')

    # 北と見方
    nx, ny = X(8.6), Y(11.6)
    e.append(f'<path d="M {nx:.1f} {ny - 22:.1f} L {nx - 8:.1f} {ny + 6:.1f} L {nx:.1f} {ny:.1f} L {nx + 8:.1f} {ny + 6:.1f} Z" fill="#333"/>')
    e.append(f'<text x="{nx:.1f}" y="{ny + 24:.1f}" font-size="13" text-anchor="middle" fill="#333">北（+Y）</text>')

    notes = [
        "P1 に立って P2 を向くと、ボックスは左側（北側）",
        f"P1 (0.00, 0.00)　P2 (5.00, 0.00)　標高はどちらも 0.00",
        f"A ({f2(A[0])}, {f2(A[1])})　B ({f2(B[0])}, {f2(B[1])})　底の標高 0.00・高さ 2.60 m",
        "マス目 1 m（太線 5 m）",
    ]
    for i, s in enumerate(notes):
        e.append(f'<text x="12" y="{Hpx - 12 - (len(notes) - 1 - i) * 19:.0f}" font-size="13" fill="#333">{s}</text>')

    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {Wpx:.0f} {Hpx:.0f}" width="{Wpx:.0f}" height="{Hpx:.0f}" '
           f'font-family="Yu Gothic UI, Hiragino Sans, Meiryo, sans-serif">\n'
           '<defs><marker id="ar" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
           '<path d="M0,1 L10,5 L0,9 Z" fill="context-stroke"/></marker></defs>\n'
           + "\n".join(e) + "\n</svg>\n")
    path = os.path.join(ROOT, "sites", "box10_test_plan.svg")
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(svg)
    return path, k


def main():
    A, B, d, r, corners = layout()
    glb, n, glb2, n2 = build_model(A, d, r)
    print(f"{glb2}  {n2:,} bytes")
    cfg = write_config()
    plan, k = write_plan(A, B, d, r, corners)
    # align/ は実案件（dxf_to_site.py）で使うので、ここでは書かない
    print(f"{glb}  {n:,} bytes")
    print(cfg)
    print(plan)
    print(f"A = ({A[0]:.3f}, {A[1]:.3f})  B = ({B[0]:.3f}, {B[1]:.3f})  長さ {np.linalg.norm(B - A):.3f} m")
    print("隅:", ", ".join(f"({p[0]:.3f}, {p[1]:.3f})" for p in corners))
    print(f"線から最も近い角 ({k[0]:.3f}, {k[1]:.3f}) まで {k[1]:.3f} m / 軸の向き {ANGLE}°")


if __name__ == "__main__":
    main()
