"""車の OBJ を 1 つの GLB（common/cars.glb）にまとめる。traffic.js が読む。

    python tools/cars_from_obj.py <OBJ のフォルダ> --out common/cars.glb

- 入れる車と、塗り替える部分（車体）の材質は下の CARS に書く
- 各車は X が前・Y が上・地面が y=0・前後の中心が原点。幅を WIDTH m にそろえる
- 1 台のメッシュは 2 つの面の組：車体（白。traffic.js が 1 台ずつ色を付ける）と、その他（窓・タイヤなど。頂点の色）
"""
import argparse
import json
import os
import struct

import numpy as np

CARS = {
    "NormalCar1": ["Blue"],
    "NormalCar2": ["LightBlue", "Material.007"],
    "SUV": ["White"],
    "SportsCar": ["Orange", "DarkOrange"],
    "SportsCar2": ["White"],
}
WIDTH = 1.8
BRIGHT = 1.5                                            # 元の色は最大 0.64 と暗いので明るくする


def read_mtl(path):
    K, m = {}, None
    for line in open(path, encoding="utf-8", errors="replace"):
        t = line.split()
        if t and t[0] == "newmtl":
            m = t[1]
        elif t and t[0] == "Kd":
            K[m] = [float(c) for c in t[1:4]]
    return K


def read_obj(path):
    """(頂点, 法線, [(材質, [(v, vn) の 3 つ組])])"""
    V, N, tris, cur = [], [], [], None
    for line in open(path, encoding="utf-8", errors="replace"):
        t = line.split()
        if not t:
            continue
        if t[0] == "v":
            V.append([float(c) for c in t[1:4]])
        elif t[0] == "vn":
            N.append([float(c) for c in t[1:4]])
        elif t[0] == "usemtl":
            cur = t[1]
        elif t[0] == "f":
            c = [(int(p.split("/")[0]) - 1, int(p.split("/")[2]) - 1) for p in t[1:]]
            for k in range(1, len(c) - 1):
                tris.append((cur, (c[0], c[k], c[k + 1])))
    return np.array(V), np.array(N), tris


def normalize(V, N, tris):
    """X が前・地面が 0・前後の中心が原点・幅 WIDTH にする"""
    head = sorted({i for m, tri in tris if m == "Headlights" for i, _ in tri})
    front = 1.0 if V[head, 2].mean() > V[:, 2].mean() else -1.0
    # (x, y, z) → 前の向きを +X へ回す（鏡にならない回転）
    rot = lambda A: np.c_[A[:, 2] * front, A[:, 1], -A[:, 0] * front]  # noqa: E731
    V, N = rot(V), rot(N)
    V = V * (WIDTH / np.ptp(V[:, 2]))
    V = V - [(V[:, 0].min() + V[:, 0].max()) / 2, V[:, 1].min(), (V[:, 2].min() + V[:, 2].max()) / 2]
    return V, N


def build(tris, V, N, K, body):
    """材質で 2 つに分け、同じ頂点をまとめて (位置, 法線, 色, 添字) を返す"""
    out = []
    for is_body in (True, False):
        idx, pos, nor, col, seen = [], [], [], [], {}
        for m, tri in tris:
            if (m in body) != is_body:
                continue
            c = (255, 255, 255, 255) if is_body else tuple(int(min(1, x * BRIGHT) * 255) for x in K[m]) + (255,)
            for v, n in tri:
                key = (v, n, c)
                if key not in seen:
                    seen[key] = len(pos)
                    pos.append(V[v])
                    nor.append(N[n])
                    col.append(c)
                idx.append(seen[key])
        out.append((np.array(pos, "<f4"), np.array(nor, "<f4"), np.array(col, "u1"), np.array(idx, "<u2")))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("obj_dir")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    bin_, views, accs, meshes, nodes = bytearray(), [], [], [], []

    def add(arr, ctype, typ, target, normalized=False, minmax=False):
        while len(bin_) % 4:
            bin_.append(0)
        views.append({"buffer": 0, "byteOffset": len(bin_), "byteLength": arr.nbytes, "target": target})
        bin_.extend(arr.tobytes())
        acc = {"bufferView": len(views) - 1, "componentType": ctype, "count": len(arr), "type": typ}
        if normalized:
            acc["normalized"] = True
        if minmax:
            acc["min"], acc["max"] = arr.min(0).tolist(), arr.max(0).tolist()
        accs.append(acc)
        return len(accs) - 1

    for name, body in CARS.items():
        K = read_mtl(os.path.join(a.obj_dir, name + ".mtl"))
        V, N, tris = read_obj(os.path.join(a.obj_dir, name + ".obj"))
        V, N = normalize(V, N, tris)
        prims = []
        for mat, (p, n, c, i) in enumerate(build(tris, V, N, K, body)):
            prims.append({"attributes": {"POSITION": add(p, 5126, "VEC3", 34962, minmax=True),
                                         "NORMAL": add(n, 5126, "VEC3", 34962),
                                         "COLOR_0": add(c, 5121, "VEC4", 34962, normalized=True)},
                          "indices": add(i, 5123, "SCALAR", 34963), "material": mat})
        nodes.append({"name": name, "mesh": len(meshes)})
        meshes.append({"name": name, "primitives": prims})
        print(f"{name}: 長さ {np.ptp(V[:, 0]):.2f} 幅 {np.ptp(V[:, 2]):.2f} 高さ {np.ptp(V[:, 1]):.2f} m  三角形 {len(tris)}")

    while len(bin_) % 4:
        bin_.append(0)
    gltf = {"asset": {"version": "2.0", "copyright": "CC0 1.0 / Quaternius LowPoly Cars"},
            "scene": 0, "scenes": [{"nodes": list(range(len(nodes)))}], "nodes": nodes, "meshes": meshes,
            "materials": [{"name": "body"}, {"name": "rest"}],
            "accessors": accs, "bufferViews": views, "buffers": [{"byteLength": len(bin_)}]}
    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    with open(a.out, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bin_)))
        f.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
        f.write(struct.pack("<II", len(bin_), 0x004E4942) + bytes(bin_))
    print(a.out, os.path.getsize(a.out), "バイト")


if __name__ == "__main__":
    main()
