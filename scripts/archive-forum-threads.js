// 旧フォーラム退役用：アクティブなスレッドをアーカイブして「1000本/サーバー」枠を解放する。
// アーカイブ＝枠から外れるだけ（中身は残る・復元可能）。取引ルームが作れない原因を根本解決。
//
// 使い方:
//   1) まず確認（何も変更しない・フォーラム一覧と件数を表示）:
//        node scripts/archive-forum-threads.js
//   2) 指定フォーラムのアクティブスレッドをアーカイブ:
//        node scripts/archive-forum-threads.js <channelId> [channelId...]
//
// 実行前提: ~/brainrot-market で実行（.env の DISCORD_TOKEN/GUILD_ID を読む）。
import 'dotenv/config';
import { REST, Routes } from 'discord.js';

const token = process.env.DISCORD_TOKEN;
const guildId = process.env.GUILD_ID;
const targets = process.argv.slice(2); // アーカイブ対象のチャンネルID群

if (!token || !guildId) {
  console.error('❌ .env の DISCORD_TOKEN / GUILD_ID が必要です');
  process.exit(1);
}
const rest = new REST({ version: '10' }).setToken(token);

const TYPE = { GUILD_FORUM: 15, GUILD_TEXT: 0, ANNOUNCEMENT: 5 };

const channels = await rest.get(Routes.guildChannels(guildId));
const byId = new Map(channels.map((c) => [c.id, c]));
const active = await rest.get(Routes.guildActiveThreads(guildId));
const allActive = active.threads || [];

// 親チャンネルごとにアクティブスレッド数を集計
const countByParent = new Map();
for (const t of allActive) {
  countByParent.set(t.parent_id, (countByParent.get(t.parent_id) || 0) + 1);
}

if (targets.length === 0) {
  // 確認モード
  console.log(`📊 サーバー全体のアクティブスレッド: ${allActive.length} / 1000`);
  console.log('— フォーラム/チャンネル別 —');
  const rows = [...countByParent.entries()]
    .map(([pid, n]) => {
      const ch = byId.get(pid);
      const name = ch ? ch.name : '(不明)';
      const kind = ch && ch.type === TYPE.GUILD_FORUM ? 'FORUM' : 'text';
      return { pid, name, n, kind };
    })
    .sort((a, b) => b.n - a.n);
  for (const r of rows) {
    console.log(`  ${r.n.toString().padStart(4)} 件  [${r.kind}] ${r.name}  (id: ${r.pid})`);
  }
  console.log('\n→ アーカイブしたいチャンネルIDを引数に渡して再実行してください。');
  process.exit(0);
}

// アーカイブ実行
const targetSet = new Set(targets);
const toArchive = allActive.filter((t) => targetSet.has(t.parent_id));
console.log(`🗄️ 対象 ${toArchive.length} スレッドをアーカイブします…`);
let done = 0;
let fail = 0;
for (const t of toArchive) {
  try {
    await rest.patch(Routes.channel(t.id), { body: { archived: true, locked: false } });
    done++;
    if (done % 20 === 0) console.log(`  …${done}/${toArchive.length}`);
    await new Promise((r) => setTimeout(r, 350));
  } catch (e) {
    fail++;
    console.error(`  ❌ ${t.id}:`, e?.rawError?.message || e?.message || e);
  }
}
console.log(`✅ 完了: アーカイブ ${done} / 失敗 ${fail}`);
const after = await rest.get(Routes.guildActiveThreads(guildId));
console.log(`📊 残りアクティブスレッド: ${(after.threads || []).length} / 1000`);
process.exit(0);
