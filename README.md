# 3D モデル AR ビューア（Google model-viewer + GitHub Pages）

> **このリポジトリ（ict_ar-viewer）は原則、暗号化したフォルダだけを置く**（例外：BRIDGEPOINT/ はパスワードなしで公開。2026-10-06 決定）。 平文のモデル・点群・平面図は置かない
> （置くと履歴に残り、消しても取り出せる）。中身は `_plain/` で作って `tools/encrypt_site.py` で暗号化する
> （「暗号化して置く」の節）。2026-10-02 に ict_ar-model-viewer から、履歴を持たずに分けた。
> 平文の現場はまだ ict_ar-model-viewer にある。
>
> **共通部品（`common/`・`tools/`）の正はこのリポジトリ**（2026-10-03 決定）。
> ict_ar-model-viewer のフォルダも、ここの `common/` を `https://tetsueci.github.io/ict_ar-viewer/common/` から読む。
> **`common/` を直すと両方のリポジトリの全フォルダに効く**。`enc` の無い（平文の）フォルダでも動くように保つ。
> 道具も ict_ar-model-viewer には置かない。あちらのフォルダを作るときは、あちらのリポジトリの直下で
> `python ../ict_ar-viewer/tools/<道具>.py … --out ../ar-model-viewer/<フォルダ>` と打つ
> （`--out` はどの道具でもこの形で通る。新しいフォルダの `index.html` は自動で上の URL を読む形になる）。


スマートフォンのブラウザで 3D モデルを表示し、「AR で置く」ボタンで現実の床に置けるページです。
アプリのインストールは要りません。

| 端末 | AR の仕組み | 備考 |
|---|---|---|
| Android（Chrome） | Scene Viewer / WebXR | ARCore 対応機種 |
| iPhone / iPad（Safari） | Quick Look | USDZ は GLB から自動で作られる（`usdz` を書けばそれを使う） |
| PC | AR なし（3D 表示のみ） | 右下の QR をスマホで読むと同じモデルが開く |

AR は **HTTPS でないと動きません**。GitHub Pages は HTTPS なのでそのまま使えます。

## 中身

```
index.html        表示ページ（モデルの一覧・AR ボタン・PC 用の QR）
models.json       表示するモデルの一覧 ← モデルを足すときはここに 1 行
models/           GLB を置く
tools/
  ifc_to_glb.py   IFC → GLB（実寸・メートル・床に置ける向き）
  make_sample.py  サンプル（ボックスカルバート）を作る
  glb.py          GLB 書き出しの共通部分
.nojekyll         GitHub Pages に Jekyll の加工をさせない
```

## 1. GitHub で公開する

1. GitHub で新しいリポジトリを作る（例 `ar-model-viewer`、**Public**）。
   README などは付けずに空で作る
2. このフォルダから送る

   ```bash
   git remote add origin https://github.com/<アカウント>/ar-model-viewer.git
   git push -u origin main
   ```

3. リポジトリの **Settings → Pages** で
   Source = **Deploy from a branch**、Branch = **main** / **/(root)** にして Save
4. 1〜2 分で公開される

   `https://<アカウント>.github.io/ar-model-viewer/`

   モデルを指定して開くときは `?m=<id>` を付ける（例 `…/ar-model-viewer/?m=sample_box`）。

> **Public リポジトリのモデルは誰でもダウンロードできます。** 公開してよいモデルだけを置いてください。
> 限られた人にだけ見せたい場合、GitHub Pages では制限できません（有料プランの Private Pages を除く）。

## 2. モデルを足す

1. GLB を `models/` に置く
2. `models.json` に 1 件足す

   ```json
   {
     "id": "bridge1",
     "title": "橋 補修",
     "description": "実寸",
     "src": "models/bridge1.glb",
     "arScale": "fixed"
   }
   ```

   | 項目 | 意味 |
   |---|---|
   | `id` | URL の `?m=` に使う名前（英数字） |
   | `src` | GLB のパス |
   | `arScale` | `fixed` = 実寸のまま置く（指で拡大縮小できない）／ `auto` = 指で拡大縮小できる |
   | `usdz` | （任意）iPhone 用に自分で作った USDZ。無ければ自動で作る |
   | `poster` | （任意）読み込み中に出す画像 |
   | `cameraOrbit` | （任意）最初の視点。例 `"45deg 65deg 20m"` |

3. `git add` → `git commit` → `git push`。1〜2 分で反映される

### IFC から作る

```bash
python tools/ifc_to_glb.py 入力.ifc models/bridge1.glb
```

- IfcOpenShell が要る（`pip install ifcopenshell numpy`）
- 実寸・メートルで出す。平面直角座標のままだと形が崩れるので、**水平は中心・高さは底を 0** に寄せる
- 大きい構造物（橋など）を机の上で見たいときは縮尺をかける

  ```bash
  python tools/ifc_to_glb.py 入力.ifc models/bridge_1-100.glb --scale 0.01
  ```

  縮尺をかけたものは `arScale` を `auto` にすると、置いてから指で大きさを変えられる
- `IfcSpace` `IfcOpeningElement` などは出さない（`--skip` で変えられる）

### ほかの形式から作る

- **Blender**（OBJ / FBX / STL / DAE など）：読み込み → ファイル → エクスポート → glTF 2.0 → 形式 **glTF バイナリ (.glb)**
- **Revit / SketchUp / Rhino**：それぞれの glTF 書き出し（アドイン）で .glb にする
- 気をつけること
  - **単位はメートル**（mm のまま出すと 1000 倍になる）
  - **Y が上**（Blender の glTF 書き出しは「+Y 上」が既定で ON）
  - 原点が遠いと AR で見つからない。原点の近くへ寄せる

## AR の置き方（位置合わせ）

- **GPS や座標で現地の位置に合わせる仕組みはありません。**
  カメラが床を見つけると、**画面の中央に映っている床の上**にモデルを置きます
- 置いたあとは指で動かして合わせる：**1 本指でドラッグ＝床の上で移動**、**2 本指でひねる＝回転**、
  `arScale` が `auto` のときだけ **2 本指で広げる・つまむ＝拡大縮小**
- Android の WebXR で開いたときは、画面の下に操作の案内が出る
  （Scene Viewer・iPhone の Quick Look は Google・Apple の画面なので出ない）

## 現場の位置に合わせる（align/）★今後はこちらを更新する

`https://<アカウント>.github.io/ict_ar-model-viewer/align/`（Android の Chrome・ARCore 対応機）

- ★**ページの中身と動きは `common/` にあり、どのフォルダも同じものを使う。`common/` を直すと全フォルダに効く**
  - `common/align.js`（画面の部品と動き）・`common/align.css`（見た目）・`common/vlaunch.js`（iPhone 用）
  - 各フォルダには `index.html`（`common/page.html` の写し。直さない）・`config.json`（基準点とモデル）・`model.glb`・`plan.png` だけ
  - **新しいモデルは新しいフォルダで作る**：`python tools/dxf_to_site.py <DXF> --out <フォルダ> --title "名前"`
    （`index.html` が無ければ写す）。URL は `…/ict_ar-model-viewer/<フォルダ>/`
- **位置合わせモード**（橙）のときだけモデルが動く。「固定する」で固定中（緑）になり、触っても動かない
- ★**基準点は何点でもよい**（`config.json` の `points` を全部使う）。◀ ▶ で固定点（青）と向ける点（橙）を選び、
  3 点目からは十字を当てて「＋ 足す」。**記録した全部の点で最小二乗**（水平は回転＋移動〔拡大ありなら＋拡大〕・高さは平均）で置き直し、
  点ごとのずれ（水平/高さ cm）が出る。20 cm を超える点があれば赤で出る。「近い点」で十字にいちばん近い点を選べる
- 基準点にはすべて**旗**が立つ（高さ 1.5 m の竿＋玉・足もとの輪と中心の点・名前の札）。固定点は青、向ける点は橙、ほかは白
- 固定する点（P1 / P2）を選び、その点を中心に回転・拡大する
  - 「◎ P1 をここへ」：固定点を十字の位置へ
  - 「→ P2 へ向ける」：固定点を中心に回して、もう一方の点を十字の方向へ（拡大ありなら距離も合わせる）
  - 画面をなぞる・ひねる＝回転、2 本指で広げる＝拡大（拡大ありのとき）、⟲⟳ ▲▼ ボタンで微調整
- 中身（model.glb・config.json・plan.png）は道路モデルの DXF から作る

  ```bash
  python tools/dxf_to_site.py <model.dxf> --title "名前"
  ```

  - 読む図形：ポリゴンメッシュ・ポリフェースメッシュ・3DFACE。3DSOLID は DXF から形が読めないので、
    同じフォルダの `road_box.lsp`（ボックスカルバートの寸法）から作り直す
  - **基準点＝Z 方向に立てた LINE の下の端**（2 本。見つけた順に P1・P2）
- 試験用の一式（2 点 5 m・ボックス 10 m）は `python tools/make_site_test.py`（`sites/` に出る）
- **IFC から作る**：`python tools/ifc_to_site.py <IFC> --out <フォルダ> --title "名前" --points-csv 基準点.csv`
  - IFC には基準点の目印が無いので、**CSV（番号,X,Y,Z。1 行目は見出し）で何点でも渡す**。
    2 点だけなら `"--points=X,Y,Z;X,Y,Z"` でもよい（座標が負なら `--points=` の形で）。
    平面図は全体図＋延長 110 m ごとの拡大図（点の番号つき）
    Z は**現地で十字を当てる面（路面など）の標高**にする。埋設物の天端を書くとその深さぶん浮く
  - 平面直角座標のままだと float32 で 1 cm 近く丸まるので、`config.json` の `origin` を引いて
    `model.glb` に入れる（`common/align.js` が足し戻す。`origin` が無いフォルダは今まで通り）
  - 軽くする：頂点をまとめて書き（31 MB → 9.7 MB）、最後に `tools/compress.mjs` で
    16bit 量子化＋meshopt に詰める（→ 1.25 MB。電線共同溝 延長 370 m の例）。`DAM\ifcviewer\viewer2_src` と同じ処理。
    **初回だけリポジトリ直下で `npm install`**（Node.js が要る。無ければ詰めずに 9.7 MB のまま出る）。
    座標の刻みは「モデルの箱の長い辺 / 65535」（300 m で 4.6 mm）。詰めないときは `--no-compress`

### 点群を重ねる（config.json の pointcloud）

- `python tools/las_to_points.py <点群.las> --out <フォルダ> --crop=xmin,ymin,xmax,ymax --voxel 0.2`
  - 範囲で切り、格子ごとに 1 点残して `pointcloud.glb`（点・色つき）にし、config.json に `pointcloud` を書く。
    座標は config.json の `origin` を引く（**先に ifc_to_site.py / dxf_to_site.py でフォルダを作っておく**）
  - 目安：橋の点群 8,263 万点 → 橋の周り 193×173 m・20 cm 格子で 141 万点・10.7 MB（10 cm 格子だと 507 万点・81 MB で重すぎる）
- AR の中：モデルと一緒に点群が出る。「点群：小/大/なし」で切り替え
- 十字の下に「**点群まで ◯ cm**」（十字＝現実の地面から、いちばん近い点群の点まで）。20 cm を超えると赤＝合わせ直す目安
- 「**点群の点を拾う**」→ 画面で点群の目印をタップ → その点が基準点 Q1, Q2 … になる（向ける点に選ばれる）。
  十字を現実の同じ場所へ当てて「→ 向ける」か「＋ 足す」。
  拾った点は**そのスマホにフォルダごとに覚える**（localStorage。暗号化したフォルダでは同じ鍵で暗号化して置く）。起動画面の基準点の表に出て、「拾った点を消す」で消せる。iPhone の Variant Launch（App Clip）は Safari と別に覚える

### 点群を描く範囲（config.json の "cloudRange"）

点群は読み込んだときに 20 m 角の升に分け、**いる所（カメラの真下）から範囲の中の升だけ**描く（0.5 秒ごとに見直す。2026-10-08 から）。
「範囲 25m／50m／100m／全部」のボタンで切り替える。初めの値は `"cloudRange": 50`（既定 50）。隠れている升の点は「点群の点を拾う」でも拾わない。
全部を描くとスマホが熱くなって落ちたため（点の数は 93 万点。50 m なら平均 2 割強）。

縮小したときは**縮尺に合わせて点を間引いて描く**。机の上で点の間隔が 1.5 mm より詰まる分を描かない（描く割合＝min(1, (点の間隔×縮尺 ÷ 1.5 mm)²)。10 cm 間隔なら 1/100 で約半分・1/200 で約 1 割・1/500 で約 2%）。升ごとに点の順番を混ぜてあり、先頭から何点まで描くかを変えるだけ。`"cloudGap"`（mm）で 1.5 を変えられる。範囲は縮尺も掛けて判定するので、縮小すると全体が範囲に入る

### 縮尺（config.json の "scales"）

縮尺を **□/□ の数字で入れる**（既定 1/1＝実寸。2026-10-07 から。どのフォルダでも）。起動画面の「縮尺」と、AR の中の位置合わせの画面の 2 か所にあり、どちらで入れても同じ。
入れると、モデル・点群・旗をまとめて**固定点を中心に**縮める（固定点は動かない）。記録した点が 2 つ以上あれば、その縮尺のまま合わせ直す。
0・空・負の数は受け付けず元に戻す。`"scales": false` で出さない。
指で大きさを変える（拡大：あり）は微調整のボタン（finetune）のほう。

### 微調整のボタン（config.json の "finetune"）

回転（⟲ ⟳ 0.5°・0.1°）・高さ（▲ ▼ 5cm）・拡大（拡大：あり／なし）のボタンは、`"finetune": true` を書いたフォルダだけに出す
（書かなければ出ない。2026-10-03 から）。指でなぞる・ひねる回転はどのフォルダでも使える。

### 基準点を持たずに始める（config.json の "start": "pick"）

基準点を前もって用意しない現場で、**ふつうの画面（◎ ここへ・→ 向ける・点群の点を拾う）**を使う形。
`config.json` に `"start": "pick"`・`"points": []`・`pointcloud` を書く。

1. 起動画面の地図（真上から見た点群）で **AR を始める場所**をタップ → 仮の点 **S** になる（スマホに覚える）。選ぶまで AR を始められない
2. AR で十字を足もとに当てて「**◎ S をここへ**」→ 点群が大まかな位置に出る
3. 「**点群の点を拾う**」→ 現地で分かる所をタップ → **Q1 が固定点になる**（固定点が S のときだけ。S での記録は捨てる）。
   十字を現地の Q1 に当てて「◎ Q1 をここへ」
4. もう一度拾う → Q2 が向ける点になる。十字を現地の Q2 に当てて「→ Q2 へ向ける」（3 点目からは「＋ 足す」）→「固定する」
- 拾った Q はスマホに覚える（「点群の点を拾う」と同じ）。次に開くと **Q1 が固定点・Q2 が向ける点**で始まるので、S を使わずに合わせられる
- S には向けられない（大まかな場所なので）。S だけのときの案内は「点群の点を拾う」になる
- 拾った点を消す：起動画面の基準点の表の「**消す**」（1 つずつ）か「拾った点を消す」（全部）。
  AR の中は向ける点に選んだ Q を「**Qn を消す**」（置いたあとは固定点は消せないので、固定点を替えてから消す）

### 点群で 2 点を選んで合わせる（config.json の "ui": "simple"）

基準点を前もって用意しない現場向け。`config.json` に `"ui": "simple"`・`"points": []`・`pointcloud` を書く。

1. 起動画面の地図（真上から見た点群・北が上）で **AR を始める場所**をタップ（そのスマホに覚える。暗号化したフォルダでは覚えない）。
   選ぶまで「AR を始める」は押せない
2. AR で十字が地面に張り付くと、始める場所が十字の所に来るように点群とモデルが出る。
   **1 本指でなぞる＝点群を地面の上で動かす**・**2 本指でひねる＝固定点（P1、選ぶ前は始める場所）を中心に回す**
3. 「**P1 を選ぶ**」（黄色の枠）のときに点群をタップ → P1（青い旗）。十字を現地の同じ所へ当てて「**① P1 をここ**」
4. ① のあとは「**P2 を選ぶ**」に切り替わる。点群をタップ → P2（橙の旗）。十字を現地の同じ所へ当てて「**② P2 をここ**」
5. 合ったら「**固定する**」（緑・アンカー）。固定中は「位置合わせ」「終わる」だけ。固定中は十字（ターゲットマーク）と十字の位置の座標を出さない（2026-10-07）
- 選び直し：「P1 を選ぶ」か「P2 を選ぶ」を押してから点群をタップ → その点の ① か ② を押し直す（P1 を選び直したら ① から）
- ボタン：P1 を選ぶ・P2 を選ぶ／① ②／固定する・終わる。`ui` を書かないフォルダは今まで通り
- 画面上部のガイドは右上の「▲ 畳む」で畳める（「▼ ガイド」で戻す。どのフォルダでも使える・畳んだかはスマホに覚える）

### 暗号化して置く（config.json の enc）

公開リポジトリのまま、パスワードを知らない人にはモデル・点群・平面図・基準点の座標を読めないようにする。

1. 中身を **`_plain/<フォルダ>/`** に作る（`.gitignore` 済み。**ここはコミットしない**）
   ```bash
   python tools/ifc_to_site.py <IFC> --out _plain/<フォルダ> --title "名前" --points-csv 基準点.csv
   python tools/las_to_points.py <点群.las> --out _plain/<フォルダ> --crop=... --voxel 0.2
   ```
2. 暗号化してリポジトリのフォルダへ出す（**パスワードはその場で 2 回入力**。画面に出ない・どこにも残らない）
   ```bash
   python tools/encrypt_site.py _plain/<フォルダ> <フォルダ>
   ```
   - 出るもの：`config.json`（タイトル・版・ファイル名は平文、`points` と `origin` は `enc.secret` に暗号化）・
     `model.glb.enc`・`plan.png.enc`・`pointcloud.glb.enc`・`index.html`
   - AES-GCM 256・鍵は PBKDF2-SHA256（ソルト 16 バイト・60 万回）。ファイルごとに IV を変える
3. ページを開くとパスワード欄が出る → ブラウザの WebCrypto で復号して読む。違うと「パスワードが違います」
- ★**パスワードはリポジトリにもコミットの説明にも書かない**
- `enc` の無いフォルダ（align/ など）は今まで通り平文で動く
- iPhone は Variant Launch で開き直した画面でもう一度パスワードを入れる（開き直す前の入力は引き継がれない）

## 現場の位置に合わせる・旧版（site.html）

現地の 2 点を登録して、モデルを現場の座標どおりに出すページ。
Android の Chrome（ARCore 対応機）専用。

- 開き方：`https://<アカウント>.github.io/ict_ar-model-viewer/site.html`
  （設定を変えるときは `site.html?cfg=sites/<設定>.json`）
- 流れ：地面を映す → 1 点目に十字を合わせて「登録」→ 2 点目も「登録」→ モデルが出る
- 画面に「2 点の距離（現地／図面）」が出る。差が大きければ点の取り違え
- 合わせたあとは、十字の位置の現場座標が出る（ボックスの角などで確かめる）

設定（`sites/*.json`）にはモデルと基準点を書く。モデルは**原点へ寄せず、基準点と同じ座標で**作る。

| 項目 | 意味 |
|---|---|
| `model` | GLB（設定ファイルからの相対パス） |
| `points` | 基準点。先頭の 2 点を使う。`x`=東 `y`=北 `z`=標高（m） |
| `plan` | （任意）平面図の画像 |

試験用の一式（2 点が 5 m・ボックス延長 10 m）は `python tools/make_site_test.py` で作り直せる。

## 3. 手元で確かめる

`index.html` をダブルクリックで開くと `models.json` を読めません（ブラウザの制限）。
簡易サーバーを立てて開きます。

```bash
python -m http.server 8000
```

→ `http://localhost:8000/` を開く。PC では 3D 表示と QR まで確かめられます
（AR はスマホで GitHub Pages の URL を開いて確かめる）。

## 重いとき

- スマホで待てるのは **10〜15 MB くらいまで** が目安（GitHub の上限は 1 ファイル 100 MB）
- Node.js があれば gltf-transform で小さくできる（形を間引く・Draco 圧縮）

  ```bash
  npx @gltf-transform/cli optimize models/in.glb models/out.glb --compress draco
  ```

- IFC の鉄筋のような細かい部材は三角形が多い。必要な部材だけに絞る

## うまくいかないとき

| 症状 | 見るところ |
|---|---|
| 「AR で置く」ボタンが出ない | PC か、AR 非対応の端末。Android は ARCore 対応機種か、iPhone は Safari で開いているか |
| AR で何も出ない・遠くにある | 原点から離れている / 単位が mm。`ifc_to_glb.py` を通すと直る |
| 真っ黒・色が無い | GLB に法線や材質が無い。Blender で開いて書き出し直す |
| 公開 URL が 404 | Settings → Pages の設定、`index.html` がリポジトリ直下にあるか |
| 変更が反映されない | Actions タブで Pages のデプロイが終わったか。スマホの再読み込み |

表示には [Google model-viewer](https://modelviewer.dev/)（Apache-2.0）を CDN から読み込んでいます。
