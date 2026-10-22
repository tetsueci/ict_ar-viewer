"""現場合わせのフォルダを暗号化して、公開してよい形にする（パスワードを知る人だけが開ける）。

    python tools/encrypt_site.py _plain/<フォルダ> <フォルダ>

- 入力（_plain/ の下。.gitignore 済み・公開しない）：config.json と、そこに書いたファイル
  （model / plan / pointcloud）と、"ept" があればその ept.json のフォルダ（ept/）の中身全部
- 出力（リポジトリに置くフォルダ）：config.json（基準点と origin は enc.secret に暗号化）・
  <ファイル>.enc・index.html（common/page.html の写し）。出力フォルダにある暗号化していないファイルは消す
- EPT は名前を変えずに 1 ファイルずつ暗号化する（common/ept.js が fetchBuf で読むので、名前はそのまま・中身だけ暗号）。
  出力の ept/ にある、入力に無いファイルは消す（平文の .laz を残さない）
- ★前と同じパスワードなら、出力の config.json のソルトをそのまま使う（鍵が同じになる）。そのうえで、
  中身の変わっていない EPT のファイルは暗号化し直さずに残す（入力側の <ept>/.enc_manifest.json に中身の SHA-256 を控える）。
  モデルだけ差し替えたときに、数百 MB の点群が毎回 git の履歴に積み増しにならないように（2026-10-22）
- 暗号：AES-GCM 256（先頭 12 バイトが IV）。鍵はパスワードから PBKDF2-SHA256（ソルト 16 バイト・60 万回）。
  common/align.js が WebCrypto で同じように戻す
- ★パスワードはその場で入力する（画面に出ない・どこにも保存しない）。
  リポジトリにもコミットの説明にも書かない
"""
import argparse
import base64
import getpass
import hashlib
import json
import os
import shutil
import sys

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
ITER = 600_000
FILES = ("model", "plan", "pointcloud")          # config.json の中でファイル名を持つ項目
SECRET = ("points", "origin", "machines")        # 暗号化する項目（見られてよいタイトルなどは平文のまま）。
# machines は置き場所（現場の座標）を持つので暗号化する（2026-10-21。平面直角座標のまま公開すると場所が分かる）


def seal(key, data):
    iv = os.urandom(12)
    return iv + AESGCM(key).encrypt(iv, data, None)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src", help="暗号化する前のフォルダ（例 _plain/BRIDGEPOINT）")
    ap.add_argument("out", help="リポジトリに置くフォルダ（例 BRIDGEPOINT）")
    ap.add_argument("--password-env", help="（試験用）パスワードを環境変数から読む")
    a = ap.parse_args()
    src = a.src if os.path.isabs(a.src) else os.path.join(ROOT, a.src)
    out = a.out if os.path.isabs(a.out) else os.path.join(ROOT, a.out)
    if os.path.normcase(os.path.abspath(src)) == os.path.normcase(os.path.abspath(out)):
        raise SystemExit("入力と出力が同じフォルダです")

    if a.password_env:
        pw = os.environ.get(a.password_env, "")
    else:
        pw = getpass.getpass("パスワード: ")
        if pw != getpass.getpass("もう一度: "):
            raise SystemExit("2 回の入力が違います")
    if len(pw) < 8:
        raise SystemExit("パスワードは 8 文字以上にしてください")

    with open(os.path.join(src, "config.json"), encoding="utf-8") as fi:
        cfg = json.load(fi)
    # 前と同じパスワードなら前のソルトを使う（前の secret が開ければ同じパスワード）
    salt, reuse = os.urandom(16), False
    try:
        with open(os.path.join(out, "config.json"), encoding="utf-8") as fi:
            old = json.load(fi)["enc"]
        s0 = base64.b64decode(old["salt"])
        k0 = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=s0, iterations=ITER).derive(pw.encode("utf-8"))
        blob = base64.b64decode(old["secret"])
        AESGCM(k0).decrypt(blob[:12], blob[12:], None)
        salt, reuse = s0, True
        print("  前と同じパスワード：前のソルトを使う（変わっていない点群のファイルは暗号化し直さない）")
    except Exception:
        pass
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITER).derive(pw.encode("utf-8"))

    os.makedirs(out, exist_ok=True)
    pub = {k: v for k, v in cfg.items() if k not in SECRET}
    plain_names = set()
    for k in FILES:
        if not cfg.get(k):
            continue
        name = cfg[k]
        with open(os.path.join(src, name), "rb") as fi:
            data = fi.read()
        with open(os.path.join(out, name + ".enc"), "wb") as fo:
            fo.write(seal(key, data))
        pub[k] = name + ".enc"
        plain_names.add(name)
        print(f"  {name} {len(data) / 1e6:.2f} MB → {name}.enc")
    if cfg.get("ept"):
        esrc = os.path.join(src, os.path.dirname(cfg["ept"]))
        eout = os.path.join(out, os.path.dirname(cfg["ept"]))
        mpath = os.path.join(esrc, ".enc_manifest.json")
        try:
            with open(mpath, encoding="utf-8") as fi:
                man = json.load(fi)
        except Exception:
            man = {}
        if not reuse or man.get("salt") != base64.b64encode(salt).decode():
            man = {}                                 # 鍵が変わったら全部暗号化し直す
        files = man.get("files", {})
        newfiles, n_e, n_keep, tot = {}, 0, 0, 0
        for r, _, fs in os.walk(esrc):
            for f in fs:
                if f == ".enc_manifest.json":
                    continue
                rel = os.path.relpath(os.path.join(r, f), esrc).replace(os.sep, "/")
                with open(os.path.join(r, f), "rb") as fi:
                    data = fi.read()
                h = hashlib.sha256(data).hexdigest()
                newfiles[rel] = h
                dst = os.path.join(eout, rel)
                if files.get(rel) == h and os.path.exists(dst):
                    n_keep += 1
                    continue
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                with open(dst, "wb") as fo:
                    fo.write(seal(key, data))
                n_e += 1; tot += len(data)
        # 入力に無いファイルは出力から消す
        for r, _, fs in os.walk(eout):
            for f in fs:
                rel = os.path.relpath(os.path.join(r, f), eout).replace(os.sep, "/")
                if rel not in newfiles:
                    os.remove(os.path.join(r, f))
        with open(mpath, "w", encoding="utf-8") as fo:
            json.dump({"salt": base64.b64encode(salt).decode(), "files": newfiles}, fo)
        print(f"  {os.path.dirname(cfg['ept'])}/ {n_e} ファイル {tot / 1e6:.1f} MB を名前のまま暗号化・変わっていない {n_keep} ファイルはそのまま")
    secret = json.dumps({k: cfg[k] for k in SECRET if k in cfg}, ensure_ascii=False).encode("utf-8")
    pub["enc"] = {"kdf": "PBKDF2-SHA256", "iter": ITER, "salt": base64.b64encode(salt).decode(),
                  "secret": base64.b64encode(seal(key, secret)).decode()}
    pub["coords"] = cfg.get("coords", "")
    with open(os.path.join(out, "config.json"), "w", encoding="utf-8", newline="\n") as fo:
        json.dump(pub, fo, ensure_ascii=False, indent=2)
        fo.write("\n")
    page = os.path.join(out, "index.html")
    if not os.path.exists(page):
        shutil.copyfile(os.path.join(ROOT, "common", "page.html"), page)
    # 出力フォルダに暗号化していないファイルが残っていれば消す（公開してしまわないように）
    for name in plain_names | {"model.glb", "plan.png", "pointcloud.glb"}:
        p = os.path.join(out, name)
        if os.path.exists(p):
            os.remove(p)
            print(f"  ★暗号化していない {name} を出力フォルダから消した")
    print(f"できた：{out}（基準点 {len(cfg.get('points', []))} 点は config.json の enc.secret に暗号化）")


if __name__ == "__main__":
    sys.exit(main())
