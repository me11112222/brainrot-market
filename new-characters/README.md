# 🆕 新ブレインロット追加マニュアル

新しいキャラを追加するときの手順。**キミは①②をやって送るだけ。③④はClaudeがやる。**

---

## ① 画像を入れる
このフォルダの `images/` に、新キャラの画像を入れる。

**命名ルール（既存の IndexPng と同じ）:**
- 最低限：`T_<名前>_1Default.PNG`（通常スキン）
- 変異もあるなら：`T_<名前>_2Gold.PNG` `T_<名前>_3Diamond.PNG` … `T_<名前>_8Yokai.PNG` 等
- スロット10番(Eclipse)は自動で「Neon(ネオン)」になる

例）`TungSahur` を追加 → `T_TungSahur_1Default.PNG`（＋あれば各変異）を `images/` に置く

## ② スプシに記入
`追加キャラ.csv` に1行ずつ書く（サンプル行は消してOK）。

| 列 | 意味 | 例 |
|---|---|---|
|名前|英語名（図鑑の正式名）|TungSahur|
|レア度|下のどれか|Secret|
|戦闘力|数字|5000|
|生産|◯/s|500M/s|
|価格|文字でOK|15b|
|入手方法|任意|ガチャ|
|画像名|画像の `T_◯◯_1Default` の◯◯部分|TungSahur|

**レア度の選択肢：** `Common` `Rare` `Epic` `Legendary` `Mythic` `BrainrotGod` `Secret` `Boss` `Ultimate Boss` `YokaiBoss` `Unknown`
（`極Boss`→Ultimate Boss、`百鬼`→YokaiBoss、`課金`→Boss に自動変換）

⚠️ 値に **カンマ( , )は使わない**（CSVが壊れる）。

## ③ Claudeに「追加して」と送る（ここからClaude）
Claudeが：
- 画像を IndexPng にコピー → `characters_edit.csv` に追記 → `build_from_csv.py` で `characters.json` 再生成
- 画像リポ＆図鑑リポを push
- VMで：図鑑pull → アプリ絵文字を追加（新キャラ分だけ）→ マーケット再起動

## ④ 反映確認
マーケットのピッカーに新キャラが出る＋アイコンが付く。

---
※ たたき（処理スクリプト）: `scripts/add-characters.js`（`node scripts/add-characters.js` で記入内容チェック→ `--apply` で反映）
