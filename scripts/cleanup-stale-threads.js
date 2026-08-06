// アクティブスレッド枠（ギルド全体1000本）を、止まっているスレッドだけアーカイブして空ける。
//
// archive-forum-threads.js との違い:
//   あちらは「指定チャンネルの全スレッド」を無条件にアーカイブする（旧フォーラム退役用）。
//   こちらは「最後の発言から N 時間たっているスレッド」だけを選ぶので、
//   進行中の取引ルーム・募集部屋を巻き込まない。日常のメンテはこちらを使う。
//
// アーカイブ＝枠から外れるだけ。中身は残り、書き込めば復活する。
//
// 使い方（~/brainrot-market で実行）:
//   node scripts/cleanup-stale-threads.js                  # 確認のみ（既定: 3時間以上停止）
//   node scripts/cleanup-stale-threads.js --hours 6        # しきい値を変える
//   node scripts/cleanup-stale-threads.js --channel <id>   # 特定チャンネルだけ（複数可）
//   node scripts/cleanup-stale-threads.js --stats          # 停止時間の分布を見る（原因調査用）
//   node scripts/cleanup-stale-threads.js --apply          # 実際にアーカイブ
import 'dotenv/config';
import { REST, Routes } from 'discord.js';

const token = process.env.DISCORD_TOKEN;
const guildId = process.env.GUILD_ID;
if (!token || !guildId) {
  console.error('❌ .env の DISCORD_TOKEN / GUILD_ID が必要です');
  process.exit(1);
}
const rest = new REST({ version: '10' }).setToken(token);

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const STATS = args.includes('--stats');
const hoursArg = args.indexOf('--hours');
const HOURS = hoursArg >= 0 ? Number(args[hoursArg + 1]) : 3;
if (!Number.isFinite(HOURS) || HOURS <= 0) {
  console.error('❌ --hours には正の数を指定してください');
  process.exit(1);
}
const only = new Set();
args.forEach((a, i) => {
  if (a === '--channel' && args[i + 1]) only.add(args[i + 1]);
});

// Discordのスノーフレークには生成時刻が埋まっている。
// last_message_id から「最後の発言時刻」が取れるので、追加のAPI呼び出しなしに停止時間が分かる。
const DISCORD_EPOCH = 1420070400000n;
const tsOf = (snowflake) =>
  snowflake ? Number((BigInt(snowflake) >> 22n) + DISCORD_EPOCH) : null;

const channels = await rest.get(Routes.guildChannels(guildId));
const nameById = new Map(channels.map((c) => [c.id, c.name]));

const active = await rest.get(Routes.guildActiveThreads(guildId));
const threads = active.threads || [];
console.log(`📊 アクティブスレッド: ${threads.length} / 1000`);
console.log(`🕐 判定: 最後の発言から ${HOURS} 時間以上たっていたらアーカイブ対象\n`);

const now = Date.now();
const cutoff = HOURS * 60 * 60 * 1000;
// 最後の発言が無いスレッドは、スレッド自身の作成時刻を「最後の動き」とみなす
const idleMs = (t) => now - (tsOf(t.last_message_id) ?? tsOf(t.id) ?? now);

const stale = [];
const byParent = new Map();
for (const t of threads) {
  if (only.size && !only.has(t.parent_id)) continue;
  const key = t.parent_id || '(親不明)';
  if (!byParent.has(key)) byParent.set(key, { total: 0, stale: 0, idles: [] });
  const row = byParent.get(key);
  row.total++;
  row.idles.push(idleMs(t));
  if (idleMs(t) >= cutoff) {
    row.stale++;
    stale.push(t);
  }
}

// 調査用: 「なぜ停止扱いにならないのか」を見るために停止時間の分布を出す。
// 全部が新しい＝作られ続けている、全部が同じくらい＝何かが一斉に触っている、の判別に使う。
if (STATS) {
  const h = (ms) => (ms / 3600000).toFixed(1) + 'h';
  const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  console.log('— 停止時間の分布（最後の発言からの経過）—');
  for (const [pid, row] of [...byParent.entries()].sort((a, b) => b[1].total - a[1].total)) {
    const s = row.idles.slice().sort((a, b) => a - b);
    console.log(
      `  ${(nameById.get(pid) || pid).padEnd(34)} ${String(row.total).padStart(4)}本  ` +
        `最短${h(s[0])} / 中央${h(pct(s, 0.5))} / 9割${h(pct(s, 0.9))} / 最長${h(s[s.length - 1])}`,
    );
  }
  // 作成時刻の分布も見る（＝いつ作られたスレッドが生き残っているのか）
  console.log('\n— 作成からの経過 —');
  for (const [pid, row] of [...byParent.entries()].sort((a, b) => b[1].total - a[1].total)) {
    const ages = threads
      .filter((t) => (t.parent_id || '(親不明)') === pid)
      .map((t) => now - (tsOf(t.id) ?? now))
      .sort((a, b) => a - b);
    console.log(
      `  ${(nameById.get(pid) || pid).padEnd(34)} ` +
        `最新${h(ages[0])} / 中央${h(pct(ages, 0.5))} / 最古${h(ages[ages.length - 1])}`,
    );
  }
  console.log('');
}

for (const [pid, row] of [...byParent.entries()].sort((a, b) => b[1].stale - a[1].stale)) {
  const name = nameById.get(pid) || pid;
  console.log(
    `  ${String(row.stale).padStart(4)} / ${String(row.total).padEnd(4)} 停止中  ${name}`,
  );
}
console.log(`\n合計 ${stale.length} 本がアーカイブ対象（残る稼働中: ${threads.length - stale.length} 本）`);

if (!stale.length) {
  console.log('→ 空けられるものはありません。');
  process.exit(0);
}
if (!APPLY) {
  // 何が消えるのか分かるように、古い順に少しだけ中身を見せる
  console.log('\n— 対象の例（停止時間が長い順に10本）—');
  for (const t of [...stale].sort((a, b) => idleMs(b) - idleMs(a)).slice(0, 10)) {
    console.log(`  ${(idleMs(t) / 3600000).toFixed(1).padStart(6)}h 停止  ${t.name}`);
  }
  console.log('\n→ 問題なければ --apply を付けて再実行してください。');
  process.exit(0);
}

console.log('\n🗄️ アーカイブ中…');
let done = 0;
let fail = 0;
for (const t of stale) {
  try {
    await rest.patch(Routes.channel(t.id), { body: { archived: true, locked: false } });
    done++;
    if (done % 25 === 0) console.log(`  …${done}/${stale.length}`);
    await new Promise((r) => setTimeout(r, 350)); // レート制限に当てない
  } catch (e) {
    fail++;
    console.error(`  ❌ ${t.name || t.id}:`, e?.rawError?.message || e?.message || e);
  }
}
console.log(`✅ 完了: アーカイブ ${done} / 失敗 ${fail}`);

// 「やったつもり」を潰す: サーバーから取り直して実際の残数を出す
const after = await rest.get(Routes.guildActiveThreads(guildId));
console.log(`📊 残りアクティブスレッド: ${(after.threads || []).length} / 1000`);
process.exit(0);
