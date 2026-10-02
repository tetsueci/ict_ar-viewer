"""現場合わせのフォルダを暗号化して、公開してよい形にする（パスワードを知る人だけが開ける）。

    python tools/encrypt_site.py _plain/<フォルダ> <フォルダ>

- 入力（_plain/ の下。.gitignore 済み・公開しない）：config.json と、そこに書いたファイル
  （model / plan / pointcloud）
- 出力（リポジトリに置くフォルダ）：config.json（基準点と origin は enc.secret に暗号化）・
  <ファイル>.enc・index.html（common/page.html の写し）。出力フォルダにある暗号化していないファイルは消す
- 暗号：AES-GCM 256（先頭 12 バイトが IV）。鍵はパスワードから PBKDF2-SHA256（ソルト 16 バイト・60 万回）。
  common/align.js が WebCrypto で同じように戻す
- ★パスワードはその場で入力する（画面に出ない・どこにも保存しない）。
  リポジトリにもコミットの説明にも書かない
"""
import argparse
import base64
import getpass
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
SECRET = ("points", "origin")                    # 暗号化する項目（見られてよいタイトルなどは平文のまま）


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
    salt = os.urandom(16)
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
