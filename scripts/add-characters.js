// 新ブレインロット追加の「たたき」。
// new-characters/追加キャラ.csv（手記入）＋ new-characters/images/（画像）を読み、
//   - チェックモード（引数なし）: 記入内容＆画像の有無を検証して表示（何も変更しない）
//   - --apply: 画像を IndexPng にコピー＋ characters_edit.csv に追記
// その後は: python build_from_csv.py → 画像/図鑑リポ push → VMで絵文字追加＆再起動（Claudeが実施）。
import { readFileSync, writeFileSync, readdirSync, copyFileSync, existsSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CSV_IN = join(ROOT, 'new-characters', '追加キャラ.csv');
const IMG_STAGE = join(ROOT, 'new-characters', 'images');
// INDEX側（手元）の正本CSVと画像マスター
const INDEXPNG = 'C:/AI/projects/IndexPng';
const EDIT_CSV = 'C:/AI/projects/event-tool/discord-bot/characters_edit.csv';

const RARITY_OK = new Set([
  'Common', 'Rare', 'Epic', 'Legendary', 'Mythic', 'BrainrotGod',
  'Secret', 'Boss', 'Ultimate Boss', 'YokaiBoss', 'Unknown',
]);
const RARITY_REMAP = { '極Boss': 'Ultimate Boss', '百鬼': 'YokaiBoss', '課金': 'Boss' };
const HEAD = ['名前', 'レア度', '戦闘力', '生産', '価格', '入手方法', '画像名'];

const apply = process.argv.includes('--apply');

// --- CSV読み込み（カンマ無し前提のシンプルパーサ）---
const lines = readFileSync(CSV_IN, 'utf8').split(/\r?\n/).filter((l) => l.trim());
const header = lines.shift().split(',').map((s) => s.trim());
const rows = lines
  .map((l) => l.split(',').map((s) => s.trim()))
  .map((cols) => Object.fromEntries(header.map((h, i) => [h, cols[i] || ''])))
  .filter((r) => r['名前'] && !r['名前'].startsWith('（例）'));

if (!rows.length) {
  console.log('記入された新キャラがありません（追加キャラ.csv にサンプル以外を書いてね）。');
  process.exit(0);
}

const stageFiles = existsSync(IMG_STAGE) ? readdirSync(IMG_STAGE) : [];
const errors = [];
const plan = [];
for (const r of rows) {
  const name = r['名前'];
  let rarity = r['レア度'];
  rarity = RARITY_REMAP[rarity] || rarity;
  const img = r['画像名'] || name;
  if (!RARITY_OK.has(rarity)) errors.push(`${name}: レア度「${r['レア度']}」が不正`);
  // 画像チェック: T_<img>_ で始まるファイルが staging か IndexPng にあるか
  const re = new RegExp('^T_' + img.replace(/[^a-zA-Z0-9_]/g, '') + '_', 'i');
  const inStage = stageFiles.filter((f) => re.test(f));
  const hasDefault = inStage.some((f) => /_1default/i.test(f)) ||
    (existsSync(INDEXPNG) && readdirSync(INDEXPNG).some((f) => re.test(f) && /_1default/i.test(f)));
  if (!inStage.length && !hasDefault) errors.push(`${name}: 画像 T_${img}_*.PNG が images/ に見つからない`);
  plan.push({ name, rarity, attack: r['戦闘力'], production: r['生産'], price: r['価格'], how: r['入手方法'], img, files: inStage, hasDefault });
}

console.log(`\n=== 追加予定 ${plan.length}体 ===`);
for (const p of plan) {
  console.log(`・${p.name} [${p.rarity}] ⚔️${p.attack} 🏭${p.production} 💰${p.price} 画像:${p.files.length || (p.hasDefault ? '(IndexPngに有)' : '❌なし')}`);
}
if (errors.length) {
  console.log('\n⚠️ エラー:');
  for (const e of errors) console.log('  - ' + e);
  console.log('\n直してから再実行してね。');
  process.exit(1);
}

if (!apply) {
  console.log('\n✅ チェックOK。反映するには: node scripts/add-characters.js --apply');
  process.exit(0);
}

// --- 反映 ---
// 1) 画像を IndexPng へコピー
let copied = 0;
for (const f of stageFiles) {
  if (!/\.png$/i.test(f)) continue;
  copyFileSync(join(IMG_STAGE, f), join(INDEXPNG, f));
  copied++;
}
// 2) characters_edit.csv へ追記（列順: name,rarity,tier,attack,production,price,how_to_get,drop_rate,hyakki,image_name）
let added = '';
for (const p of plan) {
  added += `${p.name},${p.rarity},,${p.attack},${p.production},${p.price},${p.how},,,${p.img}\n`;
}
appendFileSync(EDIT_CSV, added, 'utf8');

console.log(`\n✅ 反映: 画像${copied}枚コピー / characters_edit.csv に${plan.length}行追記`);
console.log('次（Claudeが実施）:');
console.log('  1) python build_from_csv.py   （characters.json 再生成）');
console.log('  2) 画像リポ & 図鑑リポを git push');
console.log('  3) VM: cd ~/brainrot-bot && git pull / cd ~/brainrot-market && node scripts/upload-app-emojis.js && sudo systemctl restart brainrot-market');
