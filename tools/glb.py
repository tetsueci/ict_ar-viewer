"""最小限の GLB 書き出し（numpy だけで動く）。

使い方:
    from glb import write_glb
    write_glb("out.glb", {(r, g, b, a): (verts, tris), ...})

- verts は (N,3) の float、tris は (M,3) の int。座標は glTF の決まり（Y が上・メートル）。
- 色ごとに 1 つのプリミティブにまとめる。面ごとに頂点を分けて平らな法線を付ける
  （法線が無いと Scene Viewer / Quick Look で暗く見えることがあるため）。
"""
import json
import math
import struct

import numpy as np


def zup_to_yup(v):
    """CAD / IFC の Z 上向き → glTF の Y 上向き。(x, y, z) → (x, z, -y)"""
    v = np.asarray(v, dtype=np.float64)
    return np.stack([v[:, 0], v[:, 2], -v[:, 1]], axis=1)


def recenter(groups):
    """全体の外接箱で、水平は中心・高さは底を 0 にそろえる（AR で床に置くため）。

    平面直角座標のような大きな座標のまま渡すと float32 で形が崩れるので必ず通す。
    """
    allv = np.concatenate([v for v, _ in groups.values() if len(v)])
    lo, hi = allv.min(axis=0), allv.max(axis=0)
    off = np.array([(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2])
    out = {k: (v - off, t) for k, (v, t) in groups.items()}
    return out, hi - lo


def flat(verts, tris):
    """三角形ごとに頂点を分け、平らな法線を付ける。つぶれた三角形は捨てる"""
    p = np.asarray(verts, dtype=np.float64)[np.asarray(tris, dtype=np.int64).reshape(-1, 3)]
    n = np.cross(p[:, 1] - p[:, 0], p[:, 2] - p[:, 0])
    ln = np.linalg.norm(n, axis=1, keepdims=True)
    keep = ln[:, 0] > 1e-12
    p, n, ln = p[keep], n[keep], ln[keep]
    if len(p) == 0:
        return None, None
    return p.reshape(-1, 3).astype(np.float32), np.repeat(n / ln, 3, axis=0).astype(np.float32)


def write_glb(path, groups, name="model", smooth=False):
    """smooth=True なら weld() で頂点をまとめて添字付きで書く（細かいモデルを軽くする）"""
    bin_parts, views, accessors, materials, prims = [], [], [], [], []
    offset = 0

    def add_view(data, target=34962):
        nonlocal offset
        raw = data.tobytes()
        pad = (-len(raw)) % 4
        bin_parts.append(raw + b"\x00" * pad)
        views.append({"buffer": 0, "byteOffset": offset,
                      "byteLength": len(raw), "target": target})
        offset += len(raw) + pad
        return len(views) - 1

    for color, (verts, tris) in groups.items():
        verts = np.asarray(verts, dtype=np.float64)
        tris = np.asarray(tris, dtype=np.int64).reshape(-1, 3)
        if len(tris) == 0:
            continue
        idx = None
        if smooth:
            pos, n, idx = weld(verts, tris)
            if len(idx) == 0:
                continue
            pos, n = pos.astype(np.float32), n.astype(np.float32)
            idx = idx.astype(np.uint32 if len(pos) > 65535 else np.uint16).reshape(-1)
        else:
            pos, n = flat(verts, tris)
            if pos is None:
                continue

        vp = add_view(pos)
        accessors.append({"bufferView": vp, "componentType": 5126,
                          "count": len(pos), "type": "VEC3",
                          "min": pos.min(axis=0).tolist(),
                          "max": pos.max(axis=0).tolist()})
        ip = len(accessors) - 1
        vn = add_view(n)
        accessors.append({"bufferView": vn, "componentType": 5126,
                          "count": len(n), "type": "VEC3"})
        inn = len(accessors) - 1

        r, g, b, a = [float(c) for c in color]
        mat = {"pbrMetallicRoughness": {"baseColorFactor": [r, g, b, a],
                                        "metallicFactor": 0.0,
                                        "roughnessFactor": 0.8},
               "doubleSided": True}
        if a < 0.999:
            mat["alphaMode"] = "BLEND"
        materials.append(mat)
        prim = {"attributes": {"POSITION": ip, "NORMAL": inn}, "material": len(materials) - 1}
        if idx is not None:
            vi = add_view(idx, target=34963)
            accessors.append({"bufferView": vi, "componentType": 5125 if idx.dtype == np.uint32 else 5123,
                              "count": len(idx), "type": "SCALAR"})
            prim["indices"] = len(accessors) - 1
        prims.append(prim)

    if not prims:
        raise ValueError("書き出す三角形がありません")

    gltf = {
        "asset": {"version": "2.0", "generator": "ar-model-viewer/tools/glb.py"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": name}],
        "meshes": [{"primitives": prims, "name": name}],
        "materials": materials,
        "accessors": accessors,
        "bufferViews": views,
        "buffers": [{"byteLength": offset}],
    }
    js = json.dumps(gltf, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    js += b" " * ((-len(js)) % 4)
    bn = b"".join(bin_parts)
    total = 12 + 8 + len(js) + 8 + len(bn)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A))
        f.write(js)
        f.write(struct.pack("<II", len(bn), 0x004E4942))
        f.write(bn)
    return total


def weld(verts, tris, crease_deg=40.0, tol=1e-4):
    """同じ位置の頂点をまとめ、なめらかな法線を付ける（三角形の数はそのまま）。

    write_glb は三角形ごとに頂点を分ける（平らな法線）ので、細かい管のようなモデルでは重くなる。
    まとめると頂点の数がおよそ 1/6 になる。面の向きが crease_deg 度より折れる角では頂点を分ける
    （箱の角が丸く見えないように）。戻り値は (頂点, 法線, 三角形)。
    """
    v = np.asarray(verts, dtype=np.float64)
    t = np.asarray(tris, dtype=np.int64).reshape(-1, 3)
    p = v[t]
    fn = np.cross(p[:, 1] - p[:, 0], p[:, 2] - p[:, 0])
    ln = np.linalg.norm(fn, axis=1)
    keep = ln > 1e-12
    t, fn, ln = t[keep], fn[keep], ln[keep]
    fu = fn / ln[:, None]
    _, pid = np.unique(np.round(v / tol).astype(np.int64), axis=0, return_inverse=True)
    pid = pid.reshape(-1)
    corner = pid[t].reshape(-1)                                  # 角ごとの位置番号
    cf = np.repeat(np.arange(len(t)), 3)
    acc = np.zeros((pid.max() + 1, 3))
    np.add.at(acc, corner, fn[cf])                               # 面積で重みを付けた和
    sm = acc[corner]
    sm /= np.maximum(np.linalg.norm(sm, axis=1, keepdims=True), 1e-12)
    sharp = np.einsum("ij,ij->i", sm, fu[cf]) < math.cos(math.radians(crease_deg))
    # 折れた角は「位置＋面の法線」で別の頂点にする
    key_n = np.where(sharp[:, None], np.round(fu[cf] * 1000).astype(np.int64), 0)
    key = np.concatenate([corner[:, None], key_n], axis=1)
    uk, inv = np.unique(key, axis=0, return_inverse=True)
    inv = inv.reshape(-1)
    nn = np.zeros((len(uk), 3))
    np.add.at(nn, inv, np.where(sharp[:, None], fu[cf], sm))
    nn /= np.maximum(np.linalg.norm(nn, axis=1, keepdims=True), 1e-12)
    pos = np.zeros((len(uk), 3))
    pos[inv] = v[t.reshape(-1)]
    return pos, nn, inv.reshape(-1, 3)


def compress_glb(path):
    """tools/compress.mjs（dedup・16bit 量子化・meshopt）で詰め直す。

    Node.js と node_modules（リポジトリ直下で npm install）が要る。無ければ詰めずに戻る。
    """
    import os
    import shutil
    import subprocess
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.dirname(here)
    if not shutil.which("node") or not os.path.isdir(os.path.join(root, "node_modules", "meshoptimizer")):
        print("  ★圧縮しなかった（Node.js か node_modules が無い。リポジトリ直下で npm install）")
        return None
    tmp = path + ".raw.glb"
    os.replace(path, tmp)
    r = subprocess.run(["node", os.path.join(here, "compress.mjs"), tmp, path],
                       cwd=root, capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0 or not os.path.exists(path):
        os.replace(tmp, path)
        print("  ★圧縮に失敗したので詰めないまま置いた")
        print(r.stderr[-800:])
        return None
    os.remove(tmp)
    return json.loads(r.stdout.strip().splitlines()[-1])
