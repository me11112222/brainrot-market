// 図鑑の全アイテムを「アプリ絵文字(Application Emojis)」として登録するスクリプト。
// アプリ絵文字＝最大2000個・サーバー枠を消費しない・どのサーバーでも使える（神）。
//
// 使い方（VMの ~/brainrot-market で実行）:
//   node scripts/upload-app-emojis.js --reset
//     --reset: 先にDBのemojisテーブルをクリア（旧サーバー絵文字IDを捨ててアプリ絵文字で取り直す）
//   node scripts/upload-app-emojis.js
//     既存(DB登録済み)はスキップして続きから（途中再開用）
//
// トークンは .env から読むだけで一切出力しない。
import 'dotenv/config';
import { REST } from 'discord.js';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import * as catalog from '../src/catalog.js';
import { getEmoji, setEmoji, emojiCount, clearEmojis } from '../src/db.js';

const token = process.env.DISCORD_TOKEN;
const appId = process.env.CLIENT_ID;
const reset = process.argv.includes('--reset');

if (!token || !appId) {
  console.error('❌ .env の DISCORD_TOKEN / CLIENT_ID が必要です');
  process.exit(1);
}
const rest = new REST({ version: '10' }).setToken(token);

if (reset) {
  clearEmojis();
  console.log('🧹 emojisテーブルをクリア（アプリ絵文字で取り直す）');
}

// 絵文字名：英数字＋アンダースコア・2〜32文字・ユニーク
const usedSlugs = new Set();
function slugify(name, i) {
  let s = (name || '').normalize('NFKD').replace(/[^a-zA-Z0-9_]/g, '');
  if (s.length < 2) s = 'it' + i;
  s = s.slice(0, 28);
  let cand = s;
  let n = 1;
  while (usedSlugs.has(cand.toLowerCase())) {
    cand = (s.slice(0, 26) + '_' + n).slice(0, 32);
    n++;
  }
  usedSlugs.add(cand.toLowerCase());
  return cand;
}

async function toEmojiPng(url, size) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('画像取得失敗 ' + r.status);
  const img = await loadImage(Buffer.from(await r.arrayBuffer()));
  const cv = createCanvas(size, size);
  const ctx = cv.getContext('2d');
  const scale = Math.min(size / img.width, size / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
  return cv.toBuffer('image/png');
}

const names = catalog.allItemNames();
console.log(`📚 対象 ${names.length}体 ／ 既存登録 ${emojiCount()}個 ／ アプリ絵文字(最大2000)へ`);

let uploaded = 0;
let skipped = 0;
let fail = 0;
for (let i = 0; i < names.length; i++) {
  const name = names[i];
  if (getEmoji(name)) {
    skipped++;
    continue;
  }
  const url = catalog.imageUrl(name);
  if (!url) {
    console.warn(`  － 画像なしスキップ: ${name}`);
    continue;
  }
  try {
    let buf = await toEmojiPng(url, 128);
    if (buf.length > 256000) buf = await toEmojiPng(url, 96);
    const slug = slugify(name, i);
    const dataUri = `data:image/png;base64,${buf.toString('base64')}`;
    const res = await rest.post(`/applications/${appId}/emojis`, {
      body: { name: slug, image: dataUri },
    });
    setEmoji(name, res.id, res.animated ? 1 : 0);
    uploaded++;
    console.log(`  ✅ [${uploaded}] ${name} → :${res.name}: (${res.id})`);
    await new Promise((r) => setTimeout(r, 300));
  } catch (e) {
    fail++;
    console.error(`  ❌ 失敗: ${name} →`, e?.rawError?.message || e?.message || e);
  }
}
console.log('───────────────');
console.log(`完了: 新規 ${uploaded} / スキップ ${skipped} / 失敗 ${fail} / 合計 ${emojiCount()}`);
process.exit(0);
