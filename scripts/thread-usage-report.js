// 「スレッドを誰がどれだけ作っているか」を監査ログから数える。
//
// 出すのは2つ:
//   ① 期間内に作られたスレッド数（作成者別）… 流量。Botの部屋は作っては消えるので、これは「回転数」
//   ② いま生きているスレッド数（親チャンネル別）… 在庫。1000本の上限を食っているのはこっち
//
// この2つを並べると「作った数」と「残っている数」の差＝回収されているかどうかが見える。
// Botの取引/募集部屋は回収される。フォーラムの投稿は回収されずに積み上がる。
//
// 使い方（~/brainrot-market で実行）:
//   node scripts/thread-usage-report.js            # 直近24時間
//   node scripts/thread-usage-report.js --hours 12
//
// 読み取り専用。Botに「監査ログを表示」権限が必要。
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
const hi = args.indexOf('--hours');
const HOURS = hi >= 0 ? Number(args[hi + 1]) : 24;
if (!Number.isFinite(HOURS) || HOURS <= 0) {
  console.error('❌ --hours には正の数を指定してください');
  process.exit(1);
}

const DISCORD_EPOCH = 1420070400000n;
const tsOf = (s) => (s ? Number((BigInt(s) >> 22n) + DISCORD_EPOCH) : null);

const THREAD_CREATE = 110;
const since = Date.now() - HOURS * 3600000;
const MAX_PAGES = 60; // 保険（6000件）。打ち切ったら必ず明示する

const channels = await rest.get(Routes.guildChannels(guildId));
const nameById = new Map(channels.map((c) => [c.id, c.name]));

// 監査ログは1回100件までなので、期間の先頭に届くまで before で遡る
const entries = [];
const users = new Map();
let before = null;
let pages = 0;
let truncated = false;
while (pages < MAX_PAGES) {
  const q = `?action_type=${THREAD_CREATE}&limit=100${before ? `&before=${before}` : ''}`;
  let log;
  try {
    log = await rest.get(`${Routes.guildAuditLog(guildId)}${q}`);
  } catch (e) {
    if (e?.status === 403) {
      console.error('❌ Botに「監査ログを表示」権限がありません。');
      console.error('   サーバー設定 → ロール → MEGA MECHSPOT に「監査ログを表示」を付けて再実行してください。');
      process.exit(1);
    }
    throw e;
  }
  for (const u of log.users || []) users.set(u.id, u);
  const batch = log.audit_log_entries || [];
  if (!batch.length) break;
  pages++;
  let reachedEnd = false;
  for (const e of batch) {
    if (tsOf(e.id) < since) {
      reachedEnd = true;
      continue;
    }
    entries.push(e);
  }
  if (reachedEnd) break;
  before = batch[batch.length - 1].id;
  if (pages === MAX_PAGES) truncated = true;
  await new Promise((r) => setTimeout(r, 200));
}

console.log(`📈 直近 ${HOURS} 時間に作られたスレッド: ${entries.length} 本`);
if (truncated) {
  console.log(`⚠️ ${MAX_PAGES}ページで打ち切りました。実際はこれより多いです（--hours を短くして再測定を）`);
}

const byUser = new Map();
for (const e of entries) {
  const u = users.get(e.user_id);
  const who = u ? `${u.username}${u.bot ? '（Bot）' : ''}` : e.user_id;
  byUser.set(who, (byUser.get(who) || 0) + 1);
}
console.log('\n— 作成者別 —');
for (const [who, n] of [...byUser.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  console.log(`  ${String(n).padStart(5)} 本  ${who}`);
}

// 在庫（いま枠を占有しているもの）
const active = await rest.get(Routes.guildActiveThreads(guildId));
const threads = active.threads || [];
const byParent = new Map();
for (const t of threads) {
  const k = t.parent_id || '(親不明)';
  byParent.set(k, (byParent.get(k) || 0) + 1);
}
console.log(`\n📊 いま生きているスレッド: ${threads.length} / 1000`);
console.log('— 親チャンネル別 —');
for (const [pid, n] of [...byParent.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(5)} 本  ${nameById.get(pid) || pid}`);
}

// 回転しているか（作成数に対して在庫が小さいほど、ちゃんと回収されている）
if (entries.length) {
  const ratio = (threads.length / entries.length) * 100;
  console.log(
    `\n🔁 回収の目安: ${HOURS}時間で ${entries.length} 本作られ、残っているのは ${threads.length} 本` +
      `（${ratio.toFixed(0)}%）。この数字が小さいほど、作った端から回収できています。`,
  );
}
process.exit(0);
