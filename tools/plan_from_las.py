"""点群を真上から見た平面図（plan.jpg）に、基準点と重機を描き込む。起動画面の「平面図」に出す。

    python tools/plan_from_las.py <点群.las> --out <フォルダ> [--margin 25] [--res 0.1]

- 範囲はフォルダの config.json の基準点（points）と重機（machines の x・y）を囲む箱＋margin（m）
- 1 画素 res（m）。画素ごとにいちばん高い点の色（LAS の RGB）。色が無い形式は高さで塗る
- 基準点は青い〇と名前、重機は橙の□と名前。北が上・方眼 10 m・縮尺の棒
- 書いたあと config.json に "plan": "plan.jpg" を足す（"pointsTable": false にすると起動画面の表は拾った点だけになる）
"""
import argparse
import json
import os
import struct
import sys

import numpy as np

RGB_AT = {2: 20, 3: 28, 5: 28, 7: 30, 8: 30, 10: 30}


def read_header(path):
    with open(path, "rb") as f:
        h = f.read(375)
    if h[:4] != b"LASF":
        raise SystemExit("LAS ではありません")
    off = struct.unpack("<I", h[96:100])[0]
    fmt = h[104] & 0x3F
    rl = struct.unpack("<H", h[105:107])[0]
    n = struct.unpack("<I", h[107:111])[0]
    if h[25] >= 4 and n == 0:
        n = struct.unpack("<Q", h[247:255])[0]
    sc = np.array(struct.unpack("<3d", h[131:155]))
    of = np.array(struct.unpack("<3d", h[155:179]))
    return off, fmt, rl, n, sc, of


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("las")
    ap.add_argument("--out", required=True, help="現場のフォルダ（config.json を読み、plan.jpg を書く）")
    ap.add_argument("--margin", type=float, default=25.0)
    ap.add_argument("--res", type=float, default=0.1)
    ap.add_argument("--chunk", type=int, default=5_000_000)
    a = ap.parse_args()
    cpath = os.path.join(a.out, "config.json")
    cfg = json.load(open(cpath, encoding="utf-8"))
    pts = [p for p in cfg.get("points", []) if "x" in p]
    mcs = [m for m in cfg.get("machines", []) if "x" in m and "y" in m]
    xy = np.array([[p["x"], p["y"]] for p in pts] + [[m["x"], m["y"]] for m in mcs], float)
    if not len(xy):
        raise SystemExit("config.json に基準点も重機の位置もありません")
    x0, y0 = xy.min(axis=0) - a.margin
    x1, y1 = xy.max(axis=0) + a.margin
    W, H = int(np.ceil((x1 - x0) / a.res)), int(np.ceil((y1 - y0) / a.res))

    off, fmt, rl, n, sc, of = read_header(a.las)
    mm = np.memmap(a.las, dtype=np.uint8, mode="r", offset=off, shape=(n, rl))
    rgb_at = RGB_AT.get(fmt)
    zbest = np.full(W * H, -np.inf)
    col = np.full((W * H, 3), 235, np.uint8)                # 点の無い所は薄い灰
    used = 0
    for s in range(0, n, a.chunk):
        b = np.ascontiguousarray(mm[s:s + a.chunk])
        p = b[:, :12].copy().view("<i4").reshape(-1, 3) * sc + of
        k = (p[:, 0] >= x0) & (p[:, 0] < x1) & (p[:, 1] >= y0) & (p[:, 1] < y1)
        if not k.any():
            continue
        p, b = p[k], b[k]
        ix = ((p[:, 0] - x0) / a.res).astype(np.int64)
        iy = ((y1 - p[:, 1]) / a.res).astype(np.int64)        # 画像は上が北
        cell = np.clip(iy, 0, H - 1) * W + np.clip(ix, 0, W - 1)
        if rgb_at is not None:
            c = b[:, rgb_at:rgb_at + 6].copy().view("<u2").reshape(-1, 3)
            c = ((c >> 8) if c.max() > 255 else c).astype(np.uint8)
        else:
            c = np.zeros((len(p), 3), np.uint8)
        # 画素ごとにいちばん高い点（この塊の中で並べて最後＝最大を取り、前の塊の値と比べる）
        o = np.lexsort((p[:, 2], cell))
        cell, z, c = cell[o], p[o, 2], c[o]
        last = np.r_[cell[1:] != cell[:-1], True]
        cell, z, c = cell[last], z[last], c[last]
        better = z > zbest[cell]
        zbest[cell[better]] = z[better]
        col[cell[better]] = c[better]
        used += int(k.sum())
        print(f"  {min(s + a.chunk, n):,} / {n:,} 点（範囲内 {used:,}）", flush=True)
    if rgb_at is None:
        zz = zbest[np.isfinite(zbest)]
        t = np.clip((zbest - zz.min()) / max(1e-6, zz.max() - zz.min()), 0, 1)
        has = np.isfinite(zbest)
        col[has] = (np.stack([t, 1 - abs(t - 0.5) * 2, 1 - t], axis=1)[has] * 255).astype(np.uint8)
    img = col.reshape(H, W, 3)

    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    plt.rcParams["font.family"] = ["Yu Gothic", "Meiryo", "MS Gothic", "sans-serif"]
    dpi = 110
    fig = plt.figure(figsize=(min(16, W / dpi * 1.0 + 1), min(22, H / dpi * 1.0 + 1)), dpi=dpi)
    ax = fig.add_axes([0.06, 0.04, 0.9, 0.92])
    ax.imshow(img, extent=(x0, x1, y0, y1), interpolation="nearest")
    for g in np.arange(np.ceil(x0 / 10) * 10, x1, 10):
        ax.axvline(g, color="white", lw=0.4, alpha=0.5)
    for g in np.arange(np.ceil(y0 / 10) * 10, y1, 10):
        ax.axhline(g, color="white", lw=0.4, alpha=0.5)
    for p in pts:
        ax.plot(p["x"], p["y"], "o", ms=11, mfc="none", mec="#1a6fd6", mew=2.6, zorder=5)
        ax.plot(p["x"], p["y"], "o", ms=2.5, color="#1a6fd6", zorder=6)
        ax.annotate(p["name"], (p["x"], p["y"]), xytext=(8, 6), textcoords="offset points", color="white",
                    fontsize=12, fontweight="bold", zorder=7,
                    bbox=dict(boxstyle="round,pad=0.15", fc="#1a6fd6", ec="none"))
    for m in mcs:
        ax.plot(m["x"], m["y"], "s", ms=12, mfc="none", mec="#e8590c", mew=2.6, zorder=5)
        ax.annotate(m.get("name", m.get("id", "")), (m["x"], m["y"]), xytext=(9, -14), textcoords="offset points",
                    color="white", fontsize=11, fontweight="bold", zorder=7,
                    bbox=dict(boxstyle="round,pad=0.15", fc="#e8590c", ec="none"))
    # 縮尺の棒（10 m）と北
    bx, by = x0 + 3, y0 + 3
    ax.plot([bx, bx + 10], [by, by], color="black", lw=4, solid_capstyle="butt", zorder=8)
    ax.plot([bx, bx + 10], [by, by], color="white", lw=2, solid_capstyle="butt", zorder=9)
    ax.text(bx + 5, by + 1.2, "10 m", ha="center", fontsize=10, zorder=9,
            bbox=dict(boxstyle="round,pad=0.15", fc="white", ec="none", alpha=0.8))
    ax.annotate("北", xy=(x1 - 4, y1 - 3), xytext=(x1 - 4, y1 - 11), ha="center", fontsize=12, fontweight="bold",
                arrowprops=dict(arrowstyle="-|>", color="black", lw=2), zorder=9,
                bbox=dict(boxstyle="round,pad=0.15", fc="white", ec="none", alpha=0.8))
    ax.set_xlim(x0, x1)
    ax.set_ylim(y0, y1)
    ax.set_aspect("equal")
    ax.tick_params(labelsize=8)
    ax.set_title("基準点（青い〇）と重機（橙の□）　点群を真上から見た図・方眼 10 m", fontsize=12)
    out = os.path.join(a.out, "plan.jpg")                   # スマホで開くので JPEG（PNG だと 3 MB を超えた）
    fig.savefig(out, pil_kwargs={"quality": 85, "optimize": True})
    plt.close(fig)
    cfg["plan"] = "plan.jpg"
    with open(cpath, "w", encoding="utf-8", newline="\n") as fo:
        json.dump(cfg, fo, ensure_ascii=False, indent=2)
        fo.write("\n")
    print(f"{out}  {W}×{H} 画素（{a.res} m）  範囲 X {x0:.1f}〜{x1:.1f}  Y {y0:.1f}〜{y1:.1f}  点 {used:,}")


if __name__ == "__main__":
    main()
