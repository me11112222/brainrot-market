// チャンネルの作成/削除を、誰がいつやったか（JST）で一覧にする。
// 「勝手にチャンネルが増えた/消えた」を推測ではなく記録で示すためのもの。
//
// 使い方（~/brainrot-market で実行）:
//   node scripts/audit-report.js             # 直近48時間
//   node scripts/audit-report.js --hours 24  # 期間を変える
//
// 読み取り専用。何も変更しない。
// Botに「監査ログを表示」権限が必要（無い場合は403で止まるのでその旨を出す）。
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
const HOURS = hi >= 0 ? Number(args[hi + 1]) : 48;
if (!Number.isFinite(HOURS) || HOURS <= 0) {
  console.error('❌ --hours には正の数を指定してください');
  process.exit(1);
}

const DISCORD_EPOCH = 1420070400000n;
const tsOf = (s) => (s ? Number((BigInt(s) >> 22n) + DISCORD_EPOCH) : null);
// サーバーのTZに依存せず日本時間で出す（証跡として時刻がぶれると意味がないため）
const jst = (ms) =>
  new Date(ms + 9 * 3600000).toISOString().replace('T', ' ').slice(0, 19) + ' JST';

const ACTIONS = {
  10: 'チャンネル作成',
  11: 'チャンネル設定変更',
  12: 'チャンネル削除',
};
const CH_TYPE = { 0: 'テキスト', 2: 'VC', 4: 'カテゴリ', 5: 'アナウンス', 15: 'フォーラム' };

const since = Date.now() - HOURS * 3600000;
console.log(`📋 監査ログ: 直近 ${HOURS} 時間のチャンネル作成/削除/設定変更\n`);

const rows = [];
const users = new Map();
for (const action of Object.keys(ACTIONS)) {
  let log;
  try {
    log = await rest.get(`${Routes.guildAuditLog(guildId)}?action_type=${action}&limit=100`);
  } catch (e) {
    if (e?.status === 403) {
      console.error('❌ Botに「監査ログを表示」権限がありません。');
      console.error('   サーバー設定 → ロール → MEGA MECHSPOT に「監査ログを表示」を付けて再実行してください。');
      process.exit(1);
    }
    throw e;
  }
  for (const u of log.users || []) users.set(u.id, u);
  for (const e of log.audit_log_entries || []) {
    const at = tsOf(e.id);
    if (at < since) continue;
    rows.push({ at, action: Number(action), e });
  }
}

if (!rows.length) {
  console.log('この期間にチャンネルの作成/削除/設定変更はありません。');
  process.exit(0);
}

rows.sort((a, b) => a.at - b.at);
const byUser = new Map();
for (const r of rows) {
  const u = users.get(r.e.user_id);
  const who = u ? `${u.username}${u.global_name ? `（${u.global_name}）` : ''}` : r.e.user_id;
  const name =
    r.e.changes?.find((c) => c.key === 'name')?.new_value ||
    r.e.changes?.find((c) => c.key === 'name')?.old_value ||
    r.e.target_id;
  const typeVal = r.e.changes?.find((c) => c.key === 'type')?.new_value;
  const kind = CH_TYPE[typeVal] || '';
  console.log(
    `  ${jst(r.at)}  ${ACTIONS[r.action].padEnd(8)}  ${String(name).padEnd(28)} ${kind}  by ${who}`,
  );
  if (r.action === 10) byUser.set(who, (byUser.get(who) || 0) + 1);
}

if (byUser.size) {
  console.log('\n— この期間にチャンネルを作った人 —');
  for (const [who, n] of [...byUser.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)} 個  ${who}`);
  }
}

// 影響の実測値も一緒に出す（作成の事実だけでなく、何が起きたかを数字で示すため）
const active = await rest.get(Routes.guildActiveThreads(guildId));
const threads = active.threads || [];
console.log(`\n📊 現在のアクティブスレッド: ${threads.length} / 1000（上限に達すると取引ルームが作れません）`);
process.exit(0);
