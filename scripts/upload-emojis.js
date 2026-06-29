// 図鑑の全アイテム画像を「サーバーのカスタム絵文字」として一括登録するスクリプト。
// これで選択メニューの各項目に小さい画像アイコンを出せる（Discordで画像を選択肢に出す唯一の方法）。
//
// 使い方:
//   node scripts/upload-emojis.js <guildId> [maxCount]
//   例) テスト鯖NONE(枠50)で45個まで:  node scripts/upload-emojis.js 424065083593850892 45
//   例) 本番(ブースト鯖)で全部:        node scripts/upload-emojis.js <本番guildId>
//
// 特徴: 再実行OK（DBに登録済みはスキップ）／枠が埋まったら自動停止／レート制限はRESTが自動待機。
// トークンは .env から読むだけで一切出力しない。
import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import * as catalog from '../src/catalog.js';
import { getEmoji, setEmoji, emojiCount } from '../src/db.js';

const token = process.env.DISCORD_TOKEN;
const guildId = process.argv[2];
const maxCount = process.argv[3] ? parseInt(process.argv[3], 10) : Infinity;

if (!token) {
  console.error('❌ DISCORD_TOKEN が .env にありません。');
  process.exit(1);
}
if (!guildId) {
  console.error('❌ guildId を指定してください:  node scripts/upload-emojis.js <guildId> [maxCount]');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

// 絵文字名: 英数字とアンダースコアのみ・2〜32文字・サーバー内でユニーク
const usedSlugs = new Set();
function slugify(name, i) {
  let s = (name || '')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9_]/g, '');
  if (s.length < 2) s = 'it' + i; // 日本語名などで空になった場合のフォールバック
  s = s.slice(0, 28); // 重複サフィックス用に余白
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
  // 縦横比を保って中央に収める（はみ出しは余白）
  const scale = Math.min(size / img.width, size / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
  return cv.toBuffer('image/png');
}

const names = catalog.allItemNames();
console.log(`📚 対象 ${names.length}体 ／ 既存登録 ${emojiCount()}個 ／ 今回の上限 ${maxCount === Infinity ? '無制限' : maxCount}`);

// 既存ぶんのslugを予約（再実行時の名前衝突回避）。ただし元名→slugは保持してないので、
// 既存はスキップ判定のみで使い、新規slugは新たに採番する。
let done = 0;
let skipped = 0;
let uploaded = 0;
let full = false;

for (let i = 0; i < names.length; i++) {
  if (uploaded >= maxCount) break;
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
    if (buf.length > 256000) buf = await toEmojiPng(url, 96); // 256KB上限対策
    const slug = slugify(name, i);
    const dataUri = `data:image/png;base64,${buf.toString('base64')}`;
    const res = await rest.post(Routes.guildEmojis(guildId), {
      body: { name: slug, image: dataUri },
    });
    setEmoji(name, res.id, res.animated ? 1 : 0);
    uploaded++;
    done++;
    console.log(`  ✅ [${done}] ${name}  → :${res.name}: (${res.id})`);
    await new Promise((r) => setTimeout(r, 250));
  } catch (e) {
    // 30008 = Maximum number of emojis reached（枠が埋まった）
    const code = e?.code || e?.rawError?.code;
    if (code === 30008) {
      full = true;
      console.warn('⚠️ 絵文字の枠が埋まりました。ここで停止します（ブーストで枠を増やせば続行可能）。');
      break;
    }
    console.error(`  ❌ 失敗: ${name} →`, e?.message || e);
  }
}

console.log('───────────────');
console.log(`完了: 新規 ${uploaded}個 / スキップ ${skipped}個 / 合計登録 ${emojiCount()}個${full ? ' / 枠満杯で停止' : ''}`);
process.exit(0);
