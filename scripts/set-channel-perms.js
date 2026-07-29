// チャンネルの「ロール別権限（上書き）」を安全にセットする。
// 用途: English版チャンネル（trading / trade-listings / boss-raids）を日本語版と同じ設定にする。
//   閲覧 ✅ ／ 履歴 ✅ ／ チャット送信 ❌（bot専用の掲示板）／ スレッド内の会話 ✅
//
// 使い方（~/brainrot-market で実行。.env の DISCORD_TOKEN/GUILD_ID を読む）:
//   1) チャンネル一覧とIDを見る:
//        node scripts/set-channel-perms.js --list
//   2) まず確認（何も変更しない・現在値と変更内容を表示）:
//        node scripts/set-channel-perms.js
//   3) 実際に適用:
//        node scripts/set-channel-perms.js --apply
//
// 安全設計:
//  - 指定ロールの上書きだけを触る。他のロール/ユーザーの上書きには一切手を出さない。
//  - 指定ロールの上書きも「今ある値」に対して対象4項目のビットだけを立て/落とす（マージ）。
//    → 既に付いている他の権限（スレッド作成など）を消さない。
//  - --apply を付けない限り書き込みは一切しない。
import 'dotenv/config';
import { REST, Routes, PermissionFlagsBits } from 'discord.js';

const token = process.env.DISCORD_TOKEN;
const guildId = process.env.GUILD_ID;
if (!token || !guildId) {
  console.error('❌ .env の DISCORD_TOKEN / GUILD_ID が必要です');
  process.exit(1);
}
const rest = new REST({ version: '10' }).setToken(token);

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valOf = (f, d) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const APPLY = has('--apply');
const ROLE_NAME = valOf('--role', 'Member');
// 対象チャンネル（引数で上書き可: node scripts/set-channel-perms.js 123 456）
const DEFAULT_TARGETS = [
  '1532026333335392286', // 🛒｜trading
  '1532026843845361825', // 🔄｜trade-listings
  '1532027841955368992', // 👾｜boss-raids
];
const targets = args.filter((a) => /^\d{17,20}$/.test(a));
const TARGETS = targets.length ? targets : DEFAULT_TARGETS;

// この4つだけを操作する
const ALLOW = [
  ['ViewChannel', PermissionFlagsBits.ViewChannel],
  ['ReadMessageHistory', PermissionFlagsBits.ReadMessageHistory],
  ['SendMessagesInThreads', PermissionFlagsBits.SendMessagesInThreads],
];
const DENY = [['SendMessages', PermissionFlagsBits.SendMessages]];

const channels = await rest.get(Routes.guildChannels(guildId));
const byId = new Map(channels.map((c) => [c.id, c]));

if (has('--list')) {
  const cats = new Map(channels.filter((c) => c.type === 4).map((c) => [c.id, c.name]));
  for (const c of channels
    .filter((c) => c.type !== 4)
    .sort((a, b) => (a.parent_id || '').localeCompare(b.parent_id || '') || a.position - b.position)) {
    console.log(`  [${cats.get(c.parent_id) || '—'}] ${c.name}  (id: ${c.id})`);
  }
  process.exit(0);
}

const roles = await rest.get(Routes.guildRoles(guildId));
const role = roles.find((r) => r.name === ROLE_NAME);
if (!role) {
  console.error(`❌ ロール「${ROLE_NAME}」が見つかりません。--role で名前を指定してください。`);
  console.error('   候補:', roles.map((r) => r.name).join(' / '));
  process.exit(1);
}
console.log(`🎭 対象ロール: ${role.name} (id: ${role.id})`);
console.log(APPLY ? '⚙️  --apply: 実際に変更します\n' : '👀 確認モード（変更しません）。適用は --apply\n');

let changed = 0;
let already = 0;
let failed = 0;

for (const id of TARGETS) {
  const ch = byId.get(id);
  if (!ch) {
    console.error(`❌ ${id}: このサーバーに見つかりません`);
    failed++;
    continue;
  }
  const cur = (ch.permission_overwrites || []).find((o) => o.id === role.id);
  let allow = BigInt(cur?.allow || 0);
  let deny = BigInt(cur?.deny || 0);
  const before = { allow, deny };

  for (const [, bit] of ALLOW) {
    allow |= bit;
    deny &= ~bit;
  }
  for (const [, bit] of DENY) {
    deny |= bit;
    allow &= ~bit;
  }

  const state = (bit) => (allow & bit ? '✅' : deny & bit ? '❌' : '／');
  const wasState = (bit) => (before.allow & bit ? '✅' : before.deny & bit ? '❌' : '／');
  console.log(`# ${ch.name} (${ch.id})${cur ? '' : '  ※このロールの上書きは未設定 → 新規作成'}`);
  for (const [name, bit] of [...ALLOW, ...DENY]) {
    const w = wasState(bit);
    const n = state(bit);
    console.log(`   ${name.padEnd(24)} ${w} → ${n}${w === n ? '' : '  ←変更'}`);
  }

  if (allow === before.allow && deny === before.deny) {
    console.log('   ✔ 変更なし（すでに設定済み）\n');
    already++;
    continue;
  }
  if (!APPLY) {
    console.log('   （確認モードのため未適用）\n');
    changed++;
    continue;
  }
  try {
    await rest.put(Routes.channelPermission(ch.id, role.id), {
      body: { type: 0, allow: allow.toString(), deny: deny.toString() },
    });
    console.log('   ✅ 適用しました\n');
    changed++;
    await new Promise((r) => setTimeout(r, 400));
  } catch (e) {
    console.error('   ❌ 失敗:', e?.rawError?.message || e?.message || e, '\n');
    failed++;
  }
}

console.log(
  APPLY
    ? `完了: 変更 ${changed} / 変更不要 ${already} / 失敗 ${failed}`
    : `確認: 要変更 ${changed} / 変更不要 ${already} / エラー ${failed}\n→ 問題なければ --apply を付けて再実行してください。`,
);

if (APPLY) {
  // 適用後に取り直して検証（「やったつもり」を潰す）
  const after = await rest.get(Routes.guildChannels(guildId));
  const map = new Map(after.map((c) => [c.id, c]));
  console.log('\n— 検証（サーバーから取り直した実際の値）—');
  for (const id of TARGETS) {
    const ch = map.get(id);
    if (!ch) continue;
    const o = (ch.permission_overwrites || []).find((x) => x.id === role.id);
    const a = BigInt(o?.allow || 0);
    const d = BigInt(o?.deny || 0);
    const s = (bit) => (a & bit ? '✅' : d & bit ? '❌' : '／');
    console.log(
      `  ${ch.name.padEnd(20)} 閲覧${s(PermissionFlagsBits.ViewChannel)}` +
        ` 履歴${s(PermissionFlagsBits.ReadMessageHistory)}` +
        ` 送信${s(PermissionFlagsBits.SendMessages)}` +
        ` スレッド送信${s(PermissionFlagsBits.SendMessagesInThreads)}`,
    );
  }
}
process.exit(0);
