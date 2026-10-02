"""動作確認用のサンプル（1連ボックスカルバート・実寸メートル）を models/sample_box.glb に作る。

    python tools/make_sample.py
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from glb import recenter, write_glb, zup_to_yup  # noqa: E402

# 断面（X-Z 面・Z 上向き）と延長（Y 方向）。単位 m
W, H = 3.0, 2.6          # 外寸
T_WALL, T_TOP, T_BOT = 0.35, 0.35, 0.40
L = 6.0


def box_culvert(L=L):
    """幅方向 X（中心 0）・延長方向 +Y（0〜L）・Z 上向き（底 0）"""
    ox0, ox1, oz0, oz1 = -W / 2, W / 2, 0.0, H
    ix0, ix1, iz0, iz1 = ox0 + T_WALL, ox1 - T_WALL, T_BOT, H - T_TOP
    outer = [(ox0, oz0), (ox1, oz0), (ox1, oz1), (ox0, oz1)]
    inner = [(ix0, iz0), (ix1, iz0), (ix1, iz1), (ix0, iz1)]
    verts, tris = [], []

    def quad(a, b, c, d):
        i = len(verts)
        verts.extend([a, b, c, d])
        tris.extend([(i, i + 1, i + 2), (i, i + 2, i + 3)])

    for k in range(4):
        (x0, z0), (x1, z1) = outer[k], outer[(k + 1) % 4]
        quad((x0, 0, z0), (x0, L, z0), (x1, L, z1), (x1, 0, z1))      # 外面（法線は外向き）
        (x0, z0), (x1, z1) = inner[k], inner[(k + 1) % 4]
        quad((x0, 0, z0), (x1, 0, z1), (x1, L, z1), (x0, L, z0))      # 内空（法線は空洞向き）
        # 両端の小口（外と内のあいだの台形）
        (a0, b0), (a1, b1) = outer[k], outer[(k + 1) % 4]
        (c0, d0), (c1, d1) = inner[k], inner[(k + 1) % 4]
        quad((a1, 0, b1), (c1, 0, d1), (c0, 0, d0), (a0, 0, b0))
        quad((a0, L, b0), (c0, L, d0), (c1, L, d1), (a1, L, b1))
    return np.array(verts, float), np.array(tris, int)


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.join(here, "..", "models", "sample_box.glb")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    v, t = box_culvert()
    groups = {(0.58, 0.58, 0.56, 1.0): (zup_to_yup(v), t)}
    groups, size = recenter(groups)
    n = write_glb(out, groups, name="sample_box")
    print(f"{os.path.normpath(out)}  {n:,} bytes  大きさ(m) 幅{size[0]:.2f} 高{size[1]:.2f} 奥{size[2]:.2f}")


if __name__ == "__main__":
    main()
