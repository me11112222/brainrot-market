// DBとDiscordを突き合わせて、「Botがもう管理していないのに生き残っているスレッド」を見つけて片付ける。
//
// なぜ必要か:
//   部屋を閉じる時、DBの行を消してからスレッドを削除している。
//   削除がレート制限などで失敗すると、DB側はもう閉じた扱いなので誰も再試行せず、
//   スレッドだけが1000本の枠に残り続ける（＝幽霊）。閉じる直前にお知らせを投稿しているため
//   「最後の発言が新しい」状態になり、停止時間で探す方法でも見つからない。
//
// このスクリプトは在庫の側から突き合わせるので、その幽霊を確実に特定できる。
//
// 使い方（~/brainrot-market で実行）:
//   node scripts/reconcile-rooms.js           # 確認のみ
//   node scripts/reconcile-rooms.js --apply   # 幽霊をアーカイブ（枠が返る・中身は残る）
//   node scripts/reconcile-rooms.js --apply --delete   # アーカイブではなく削除（中身も消える）
//
// DBは読み取り専用で開くので、稼働中のBotに影響しない。
import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const token = process.env.DISCORD_TOKEN;
const guildId = process.env.GUILD_ID;
if (!token || !guildId) {
  console.error('❌ .env の DISCORD_TOKEN / GUILD_ID が必要です');
  process.exit(1);
}
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const DELETE = args.includes('--delete');

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'data.sqlite');
// 読み取り専用で開く。古いNodeに readOnly オプションが無い場合は通常オープンに落とすが、
// このスクリプトはSELECTしか実行しないので、どちらでも稼働中のBotには影響しない。
let db;
try {
  db = new DatabaseSync(DB_PATH, { readOnly: true });
} catch {
  db = new DatabaseSync(DB_PATH);
}

// Botが「まだ生きている」と思っている部屋のスレッドID
const live = new Set();
for (const r of db
  .prepare(`SELECT thread_id FROM parties WHERE status IN ('open','full') AND thread_id IS NOT NULL`)
  .all()) {
  live.add(r.thread_id);
}
const partyLive = live.size;
for (const r of db.prepare(`SELECT thread_id FROM match_rooms`).all()) live.add(r.thread_id);
const roomLive = live.size - partyLive;

const rest = new REST({ version: '10' }).setToken(token);
const channels = await rest.get(Routes.guildChannels(guildId));
const nameById = new Map(channels.map((c) => [c.id, c.name]));
const active = await rest.get(Routes.guildActiveThreads(guildId));
const threads = active.threads || [];

const ghosts = threads.filter((t) => !live.has(t.id));

console.log('— Botが管理している部屋（DB）—');
console.log(`  募集中/満員のパーティ部屋: ${partyLive} 本`);
console.log(`  進行中の取引ルーム:        ${roomLive} 本`);
console.log(`  合計:                      ${live.size} 本\n`);
console.log(`— Discord上に生きているスレッド: ${threads.length} / 1000 —`);
const byParent = new Map();
for (const t of ghosts) {
  const k = t.parent_id || '(親不明)';
  byParent.set(k, (byParent.get(k) || 0) + 1);
}
console.log(`\n👻 どちらにも紐づかない幽霊スレッド: ${ghosts.length} 本`);
for (const [pid, n] of [...byParent.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(5)} 本  ${nameById.get(pid) || pid}`);
}

if (!ghosts.length) {
  console.log('\n→ 片付けるものはありません。');
  process.exit(0);
}
if (!APPLY) {
  console.log('\n— 例（10本）—');
  for (const t of ghosts.slice(0, 10)) console.log(`  ${t.name}`);
  console.log(
    `\n→ 問題なければ --apply を付けて再実行してください（既定はアーカイブ＝中身は残ります）。`,
  );
  process.exit(0);
}

console.log(`\n${DELETE ? '🗑️ 削除' : '🗄️ アーカイブ'}中…`);
let done = 0;
let fail = 0;
for (const t of ghosts) {
  try {
    if (DELETE) await rest.delete(Routes.channel(t.id));
    else await rest.patch(Routes.channel(t.id), { body: { archived: true, locked: false } });
    done++;
    if (done % 25 === 0) console.log(`  …${done}/${ghosts.length}`);
    await new Promise((r) => setTimeout(r, 400));
  } catch (e) {
    fail++;
    console.error(`  ❌ ${t.name || t.id}:`, e?.rawError?.message || e?.message || e);
  }
}
console.log(`✅ 完了: ${done} 本 / 失敗 ${fail} 本`);

const after = await rest.get(Routes.guildActiveThreads(guildId));
console.log(`📊 残りアクティブスレッド: ${(after.threads || []).length} / 1000`);
process.exit(0);
