// パーティ募集システム（⚔️ボス戦ラッシュ / 🔮儀式召喚）
// マーケットと同じ思想: 募集=DB行＋カード1枚（スレッドを食わない）、部屋=プライベートスレッド1本。
// フロー: ボタン→モーダル→カード＆部屋が即できる → 参加者はワンタップ＋戦闘力/FN ID入力 → 部屋に自動追加
//        → 満員で全員にピン → ホストが「✅マッチ完了」で解散。募集はTTLで自動失効。
// FN IDは公開カードに出さず部屋の中だけ（晒され防止）。
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
} from 'discord.js';
import * as db from './db.js';
import * as catalog from './catalog.js';
import { t } from './i18n.js';
import { cleanText, contentIssue, rateOk } from './moderation.js';
import { closeThreadSoon } from './threads.js';

const PARTY_TTL = 6 * 60 * 60 * 1000; // 募集は6時間で自動失効（ボスラッシュは当日集めが基本）
// スレッド枠（ギルド全体1000）を守る2本柱:
//   ①部屋は「最初の参加者が来た時」に作る＝参加者ゼロの募集はスレッド0本
//   ②部屋は無人1時間で自動クローズ＝出発済みの部屋が枠に居座らない
const PARTY_IDLE_TTL = 60 * 60 * 1000;
// 満員になった部屋は20分で畳む。集合してゲームへ移った後の部屋が1時間居座ると、
// ピーク時（毎時130部屋）には584枠＝全体の6割を占めてしまい、取引ルームが作れなくなる。
// まだ募集中の部屋は上の1時間のままにして、ゆっくり集まる募集を巻き込まない。
const PARTY_FULL_IDLE_TTL = 20 * 60 * 1000;
const NO_PING = { parse: [] };

// 種別ごとの見た目・ルール
const KINDS = {
  boss: {
    emoji: '⚔️',
    color: 0xed4245,
    title: 'ボス戦パーティ / Boss Party',
    fixedSize: 8, // ボスラッシュは8人固定
  },
  ritual: {
    emoji: '🔮',
    color: 0x9b59b6,
    title: '儀式パーティ / Ritual Party',
    defaultSize: 4,
    maxSize: 8,
  },
};

export const partyCommands = [
  new SlashCommandBuilder()
    .setName('募集パネル設置')
    .setDescription('【運営用】このチャンネルにパーティ募集パネルを設置（ボス戦/儀式）')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),
];

// ===== パネル（共有・日英併記・募集中件数のライブ表示つき）=====
export function buildPartyPanel() {
  const counts = db.countOpenPartiesByKind();
  const boss = counts.boss || 0;
  const ritual = counts.ritual || 0;
  const embed = new EmbedBuilder()
    .setColor(0xfee75c)
    .setTitle('🎮 パーティ募集 / Party Finder')
    .setDescription(
      [
        `**いま募集中 / Open now: ⚔️ ${boss}件 ・ 🔮 ${ritual}件**`,
        '',
        '⚔️ **ボス戦募集 / Boss** … 8人で挑もう！毎週水曜はボスラッシュ！ / 8-player boss rush party',
        '🔮 **儀式募集 / Ritual** … キャラ持ち寄りで召喚 / bring characters, summon together',
        '🔍 **探す / Find** … 自分の戦闘力に近い募集をワンタップ表示 / parties near your power',
        '📋 **マイ募集 / Mine** … 上げ直し・解散 / bump & disband',
        '',
        '流れ: 参加を押す → 部屋でフレンドID交換 → ゲームに集合！',
        'Flow: tap Join → swap Fortnite IDs in the room → meet in game!',
      ].join('\n'),
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('pty_new_boss')
      .setLabel('ボス戦募集 / Boss')
      .setEmoji('⚔️')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('pty_new_ritual')
      .setLabel('儀式募集 / Ritual')
      .setEmoji('🔮')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('pty_find')
      .setLabel('探す / Find')
      .setEmoji('🔍')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('pty_mine')
      .setLabel('マイ募集 / Mine')
      .setEmoji('📋')
      .setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row] };
}

// ===== 表示部品 =====
function emojiMention(name) {
  const e = db.getEmoji(name);
  if (!e) return '';
  return `<${e.animated ? 'a' : ''}:it:${e.emoji_id}> `;
}
function memberLines(party) {
  const rows = db.partyMembers(party.id);
  const lines = [
    `👑 ${party.host_tag || 'host'}${party.power ? `　⚔️${party.power}` : ''}`,
    ...rows.map((m) => `・${m.tag || m.user_id}${m.power ? `　⚔️${m.power}` : ''}`),
  ];
  return { count: rows.length + 1, lines }; // ホスト込みの人数
}
function partyEmbed(party) {
  const k = KINDS[party.kind];
  const { count, lines } = memberLines(party);
  const full = count >= party.size;
  const e = new EmbedBuilder()
    .setColor(k.color)
    .setAuthor({ name: `${k.title} #${party.id}${full ? '　🈵満員/FULL' : ''}` });
  if (party.kind === 'ritual' && party.character) {
    e.addFields({
      name: '🔮 召喚キャラ / Character',
      value: `${emojiMention(party.character)}**${party.character}**`,
    });
    const img = catalog.imageUrl(party.character);
    if (img) e.setThumbnail(img);
  }
  e.addFields({
    name: `👥 メンバー / Members: ${count} / ${party.size}`,
    value: lines.slice(0, 10).join('\n'),
  });
  if (party.min_power) {
    e.addFields({ name: '🎯 参加条件 / Req', value: `⚔️ ${party.min_power} 以上 / or higher` });
  }
  if (party.note) e.addFields({ name: '📝 メモ / Note', value: party.note });
  const foot = { text: '🙋参加を押す→部屋でフレンドID交換 / Tap Join → swap IDs in the room' };
  if (party.host_avatar) foot.iconURL = party.host_avatar;
  e.setFooter(foot);
  return e;
}
function joinRow(party, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`pty_join_${party.id}`)
      .setLabel(disabled ? '満員 / FULL' : '参加する / Join')
      .setEmoji('🙋')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
  );
}
function controlRow(partyId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`pty_done_${partyId}`)
      .setLabel('マッチ完了 / Done (host)')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`pty_leave_${partyId}`)
      .setLabel('退出 / Leave')
      .setEmoji('🚪')
      .setStyle(ButtonStyle.Secondary),
  );
}
const CONTROL_HINT_PTY =
  '👇 集まって出発したらホストが「✅マッチ完了」・抜ける人は「🚪退出」\n' +
  'Host: tap ✅ once the party sets off — leaving? tap 🚪';

// ===== モーダル =====
// 戦闘力の寛容パース: 全角（１４０００）・カンマ・スペース・「1.4万」「14k」全部OK
function parsePower(s) {
  let v = String(s || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[,\s，、．]/g, (c) => (c === '．' ? '.' : ''));
  if (!v) return null;
  let mult = 1;
  if (/万$/.test(v)) {
    mult = 10000;
    v = v.slice(0, -1);
  } else if (/k$/.test(v)) {
    mult = 1000;
    v = v.slice(0, -1);
  }
  const n = parseFloat(v.replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(Math.round(n * mult), 999999);
}
// 入力欄（プレースホルダー＝薄字の記入例つき。profileがあれば前回の値を自動入力）
function fnidInput(lc, profile) {
  const i = new TextInputBuilder()
    .setCustomId('fnid')
    .setLabel(t(lc, 'pty_m_fnid'))
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(40)
    .setPlaceholder(t(lc, 'pty_ph_fnid'));
  if (profile?.fn_id) i.setValue(profile.fn_id);
  return i;
}
function powerInput(lc, required, profile) {
  const i = new TextInputBuilder()
    .setCustomId('power')
    .setLabel(t(lc, 'pty_m_power'))
    .setStyle(TextInputStyle.Short)
    .setRequired(required)
    .setMaxLength(10)
    .setPlaceholder(t(lc, 'pty_ph_power'));
  if (profile?.power) i.setValue(String(profile.power));
  return i;
}
function newPartyModal(kind, character, lc, profile) {
  // customId にキャラ名を埋め込む（セッション不要・再起動に強い）
  const m = new ModalBuilder()
    .setCustomId(`pty_newm|${kind}|${character || ''}`)
    .setTitle(
      kind === 'boss' ? t(lc, 'pty_new_boss_title') : t(lc, 'pty_new_ritual_title'),
    );
  m.addComponents(
    new ActionRowBuilder().addComponents(fnidInput(lc, profile)),
    new ActionRowBuilder().addComponents(powerInput(lc, kind === 'boss', profile)),
  );
  if (kind === 'boss') {
    m.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('minpower')
          .setLabel(t(lc, 'pty_m_minpower'))
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(10)
          .setPlaceholder(t(lc, 'pty_ph_minpower')),
      ),
    );
  } else {
    m.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('size')
          .setLabel(t(lc, 'pty_m_size'))
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(2)
          .setPlaceholder(t(lc, 'pty_ph_size')),
      ),
    );
  }
  m.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('note')
        .setLabel(t(lc, 'pty_m_note'))
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(100)
        .setPlaceholder(t(lc, 'pty_ph_note')),
    ),
  );
  return m;
}
function joinModal(party, lc, profile) {
  return new ModalBuilder()
    .setCustomId(`pty_joinm_${party.id}`)
    .setTitle(t(lc, 'pty_join_title', { id: party.id }))
    .addComponents(
      new ActionRowBuilder().addComponents(fnidInput(lc, profile)),
      new ActionRowBuilder().addComponents(powerInput(lc, party.kind === 'boss', profile)),
    );
}

// ===== 募集作成 =====
async function createParty(interaction, kind, character) {
  const lc = interaction.locale;
  const uid = interaction.user.id;
  // モーダルを複数開いた等の二重作成防止（ボタン時にもチェック済みだが最終防衛）
  if (db.activePartyByHost(uid, kind)) {
    return interaction.reply({ content: t(lc, 'pty_exists'), flags: MessageFlags.Ephemeral });
  }
  const fnid = cleanText(interaction.fields.getTextInputValue('fnid'));
  const note = cleanText(
    interaction.fields.getTextInputValue('note') || '',
  );
  const issue = contentIssue(fnid) || contentIssue(note);
  if (issue) {
    return interaction.reply({
      content: t(lc, issue === 'url' ? 'bad_url' : 'bad_word'),
      flags: MessageFlags.Ephemeral,
    });
  }
  const power = parsePower(interaction.fields.getTextInputValue('power'));
  if (kind === 'boss' && !power) {
    return interaction.reply({ content: t(lc, 'pty_bad_power'), flags: MessageFlags.Ephemeral });
  }
  let size;
  let minPower = null;
  if (kind === 'boss') {
    size = KINDS.boss.fixedSize;
    minPower = parsePower(interaction.fields.getTextInputValue('minpower'));
  } else {
    const s = parsePower(interaction.fields.getTextInputValue('size'));
    size = Math.max(2, Math.min(s || KINDS.ritual.defaultSize, KINDS.ritual.maxSize));
  }
  // 部屋を作れる場所（パネルのあるテキストチャンネル）
  let parent = interaction.channel;
  if (parent?.isThread?.()) parent = parent.parent;
  if (!parent || parent.type !== ChannelType.GuildText) {
    return interaction.reply({ content: t(lc, 'cant_make_room'), flags: MessageFlags.Ephemeral });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  db.saveProfile(uid, fnid, power); // 次回のモーダルに自動入力
  const partyId = db.addParty({
    kind,
    hostId: uid,
    hostTag: interaction.user.tag,
    hostAvatar: interaction.user.displayAvatarURL(),
    power,
    minPower,
    fnId: fnid,
    character,
    size,
    note,
  });
  const party = db.getParty(partyId);
  try {
    // 募集カード（参加ボタン付き）だけを出す。部屋（スレッド）は最初の参加者が来た時に作る
    // ＝参加者ゼロの募集はスレッド枠（ギルド全体1000）を一切食わない
    const msg = await parent.send({
      embeds: [partyEmbed(party)],
      components: [joinRow(party)],
      allowedMentions: NO_PING,
    });
    db.setPartyMessage(partyId, msg.channelId, msg.id);
    schedulePartyPanelRepost(parent);
    await interaction.editReply(t(lc, 'pty_created'));
  } catch (err) {
    console.error('パーティ作成失敗:', err);
    db.setPartyStatus(partyId, 'closed');
    await interaction.editReply(t(lc, 'pty_create_fail'));
  }
}

// 部屋（プライベートスレッド）を用意する。無ければ作ってホストを入れ、案内とボタンを設置。
// 作れなければ null（スレッド上限など）。呼び出し側で参加を中止する。
async function ensurePartyThread(client, party) {
  if (party.thread_id) {
    const existing = await client.channels.fetch(party.thread_id).catch(() => null);
    if (existing) return existing;
  }
  const parent = await client.channels.fetch(party.channel_id).catch(() => null);
  if (!parent || parent.type !== ChannelType.GuildText) return null;
  try {
    const threadName =
      party.kind === 'ritual' && party.character
        ? `🔮儀式 ${party.character} #${party.id}`.slice(0, 90)
        : `⚔️ボス戦 #${party.id} ${party.host_tag || ''}`.slice(0, 90);
    const thread = await parent.threads.create({
      name: threadName,
      type: ChannelType.PrivateThread,
      invitable: false,
      autoArchiveDuration: 60, // Bot停止中の保険: Discord自身が無活動1hでアーカイブ＝枠を返す
      reason: 'パーティ募集 / party recruit',
    });
    await thread.members.add(party.host_id).catch(() => {});
    db.setPartyThread(party.id, thread.id);
    await thread.send({
      content: `<@${party.host_id}>`,
      embeds: [partyEmbed(party)],
      allowedMentions: { users: [party.host_id] },
    });
    const pin = await thread.send(
      `🎮 手順: ①フレンド申請 ②ゲームに集合 ③出発したらホストが✅ / add friends → meet in game → host taps ✅\n` +
        `👑 ホストFN / Host FN ID: \`${party.fn_id || '?'}\``,
    );
    await pin.pin().catch(() => {});
    await thread.send({ content: CONTROL_HINT_PTY, components: [controlRow(party.id)] });
    return thread;
  } catch (err) {
    console.error('パーティ部屋作成失敗:', err);
    return null;
  }
}

// カードを現在のメンバー状況に更新
async function refreshPartyCard(client, party) {
  if (!party.channel_id || !party.message_id) return;
  const ch = await client.channels.fetch(party.channel_id).catch(() => null);
  const msg = await ch?.messages?.fetch(party.message_id).catch(() => null);
  if (!msg) return;
  const { count } = memberLines(party);
  await msg
    .edit({
      embeds: [partyEmbed(party)],
      components: [joinRow(party, count >= party.size || party.status !== 'open')],
    })
    .catch(() => {});
}

// ===== 参加 =====
async function joinParty(interaction, partyId) {
  const lc = interaction.locale;
  const uid = interaction.user.id;
  const party = db.getParty(partyId);
  if (!party) {
    return interaction.reply({ content: t(lc, 'pty_notfound'), flags: MessageFlags.Ephemeral });
  }
  if (party.status !== 'open') {
    return interaction.reply({ content: t(lc, 'pty_ended'), flags: MessageFlags.Ephemeral });
  }
  if (party.host_id === uid) {
    return interaction.reply({ content: t(lc, 'pty_own'), flags: MessageFlags.Ephemeral });
  }
  if (db.isPartyMember(partyId, uid)) {
    const th = party.thread_id
      ? await interaction.client.channels.fetch(party.thread_id).catch(() => null)
      : null;
    return interaction.reply({
      content: t(lc, 'pty_already', { thread: th ?? '' }),
      flags: MessageFlags.Ephemeral,
    });
  }
  await interaction.showModal(joinModal(party, lc, db.getProfile(uid)));
}
async function submitJoin(interaction, partyId) {
  const lc = interaction.locale;
  const uid = interaction.user.id;
  const party = db.getParty(partyId);
  if (!party || party.status !== 'open') {
    return interaction.reply({ content: t(lc, 'pty_ended'), flags: MessageFlags.Ephemeral });
  }
  const fnid = cleanText(interaction.fields.getTextInputValue('fnid'));
  if (contentIssue(fnid)) {
    return interaction.reply({ content: t(lc, 'bad_url'), flags: MessageFlags.Ephemeral });
  }
  const power = parsePower(interaction.fields.getTextInputValue('power'));
  if (party.kind === 'boss' && !power) {
    return interaction.reply({ content: t(lc, 'pty_bad_power'), flags: MessageFlags.Ephemeral });
  }
  if (party.min_power && (!power || power < party.min_power)) {
    return interaction.reply({
      content: t(lc, 'pty_minpower', { min: party.min_power, p: power || '?' }),
      flags: MessageFlags.Ephemeral,
    });
  }
  const { count } = memberLines(party);
  if (count >= party.size) {
    return interaction.reply({ content: t(lc, 'pty_full_ep'), flags: MessageFlags.Ephemeral });
  }
  if (!rateOk('ptyjoin', uid, 5)) {
    return interaction.reply({ content: t(lc, 'rl_room'), flags: MessageFlags.Ephemeral });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  // 最後の1枠への同時参加レース対策（defer中に埋まった場合）
  if (memberLines(party).count >= party.size || db.getParty(partyId)?.status !== 'open') {
    return interaction.editReply(t(lc, 'pty_full_ep'));
  }
  db.saveProfile(uid, fnid, power); // 次回のモーダルに自動入力
  // 部屋を先に確保（初参加ならここで作られる）。作れなければ参加を中止＝データを汚さない
  const thread = await ensurePartyThread(interaction.client, party);
  if (!thread) {
    return interaction.editReply(t(lc, 'pty_room_fail'));
  }
  db.addPartyMember(partyId, uid, interaction.user.tag, power, fnid);
  db.touchParty(partyId);
  await thread.members.add(uid).catch(() => {});
  const after = memberLines(party).count;
  await thread
    .send({
      content:
        `🙋 <@${uid}> 参加 / joined!　${power ? `⚔️${power}　` : ''}FN: \`${fnid}\`　（${after}/${party.size}）\n` +
        `<@${party.host_id}> フレンド申請してね！ / Host: send a friend request!`,
      allowedMentions: { users: [party.host_id] },
    })
    .catch(() => {});
  // 満員 → 全員にピン＆カードを満員表示に
  if (after >= party.size) {
    db.setPartyStatus(partyId, 'full');
    const all = [party.host_id, ...db.partyMembers(partyId).map((m) => m.user_id)];
    await thread
      .send({
        content:
          `🎉 **${party.size}人そろった！ / Party full!** ${all.map((id) => `<@${id}>`).join(' ')}\n` +
          `全員フレンド申請→ゲームに集合！出発したらホストが「✅マッチ完了」！ / Add friends & meet in game — host taps ✅!`,
        allowedMentions: { users: all.slice(0, 10) },
      })
      .catch(() => {});
  }
  await refreshPartyCard(interaction.client, db.getParty(partyId));
  await interaction.editReply(t(lc, 'pty_joined', { thread }));
}

// ===== 退出 / 完了 =====
async function leaveParty(interaction, partyId) {
  const lc = interaction.locale;
  const uid = interaction.user.id;
  const party = db.getParty(partyId);
  if (!party) {
    return interaction.reply({ content: t(lc, 'pty_notfound'), flags: MessageFlags.Ephemeral });
  }
  if (party.host_id === uid) {
    return interaction.reply({ content: t(lc, 'pty_host_cant_leave'), flags: MessageFlags.Ephemeral });
  }
  db.removePartyMember(partyId, uid);
  if (party.status === 'full') db.setPartyStatus(partyId, 'open'); // 枠が空いたら再オープン
  if (interaction.channel?.isThread?.()) {
    await interaction.channel.members.remove(uid).catch(() => {});
    await interaction.channel
      .send({ content: `🚪 <@${uid}> が退出（枠が空いたよ）/ left — a slot opened`, allowedMentions: NO_PING })
      .catch(() => {});
  }
  await refreshPartyCard(interaction.client, db.getParty(partyId));
  await interaction.reply({ content: t(lc, 'pty_left'), flags: MessageFlags.Ephemeral });
}
async function closeParty(interaction, partyId) {
  const lc = interaction.locale;
  const party = db.getParty(partyId);
  if (!party) {
    return interaction.reply({ content: t(lc, 'pty_notfound'), flags: MessageFlags.Ephemeral });
  }
  if (party.host_id !== interaction.user.id) {
    return interaction.reply({ content: t(lc, 'pty_host_only'), flags: MessageFlags.Ephemeral });
  }
  db.setPartyStatus(partyId, 'closed');
  await interaction.reply({ content: t(lc, 'pty_done'), flags: MessageFlags.Ephemeral });
  await cleanupParty(interaction.client, party, '🎉 マッチ完了！たのしんで！ / Matched — have fun!');
}
// カード削除＋スレッド後始末（完了/失効 共通）
async function cleanupParty(client, party, threadMsg) {
  if (party.channel_id && party.message_id) {
    const ch = await client.channels.fetch(party.channel_id).catch(() => null);
    await ch?.messages?.delete(party.message_id).catch(() => {});
  }
  if (party.thread_id) {
    const thread = await client.channels.fetch(party.thread_id).catch(() => null);
    if (thread) {
      if (threadMsg) await thread.send(threadMsg).catch(() => {});
      closeThreadSoon(thread);
    }
  }
}

// ===== 🔍 探す（自分の戦闘力に近い順・埋まりかけ優先）=====
async function replyFind(interaction) {
  const lc = interaction.locale;
  const uid = interaction.user.id;
  const myPower = db.getProfile(uid)?.power || null;
  let list = db.openParties(50).filter((p) => p.host_id !== uid);
  // 条件未達（min_power > 自分の戦闘力）の募集は最初から見せない＝ガッカリを防ぐ
  if (myPower) list = list.filter((p) => !p.min_power || myPower >= p.min_power);
  const withCount = list.map((p) => ({ p, count: memberLines(p).count }));
  withCount.sort((a, b) => {
    if (myPower) {
      const da = a.p.power ? Math.abs(a.p.power - myPower) : 1e9;
      const dbb = b.p.power ? Math.abs(b.p.power - myPower) : 1e9;
      if (da !== dbb) return da - dbb; // ①戦闘力が近い順
    }
    const ra = a.p.size - a.count;
    const rb = b.p.size - b.count;
    if (ra !== rb) return ra - rb; // ②あと少しで満員を優先
    return b.p.created_at - a.p.created_at; // ③新しい順
  });
  const top = withCount.slice(0, 10);
  if (!top.length) {
    return interaction.reply({ content: t(lc, 'pty_find_none'), flags: MessageFlags.Ephemeral });
  }
  const lines = top.map(({ p, count }) => {
    const k = KINDS[p.kind];
    const bits = [`${k.emoji} **#${p.id}**`];
    if (p.kind === 'ritual' && p.character) bits.push(`${emojiMention(p.character)}${p.character}`);
    bits.push(`👑 ${p.host_tag || '?'}${p.power ? `　⚔️${p.power}` : ''}`);
    bits.push(`👥 ${count}/${p.size}`);
    if (p.min_power) bits.push(`🎯⚔️${p.min_power}〜`);
    if (p.note) bits.push(`📝${String(p.note).slice(0, 20)}`);
    return bits.join('　');
  });
  const sel = new StringSelectMenuBuilder()
    .setCustomId('pty_pick_join')
    .setPlaceholder(t(lc, 'pty_pick_join'))
    .addOptions(
      top.map(({ p, count }) => {
        const k = KINDS[p.kind];
        return {
          label: `#${p.id} ${p.kind === 'ritual' && p.character ? p.character : `⚔️${p.power || '?'}`}　${count}/${p.size}`.slice(0, 100),
          description: (p.note || p.host_tag || '').slice(0, 100),
          value: String(p.id),
          emoji: k.emoji,
        };
      }),
    );
  await interaction.reply({
    content: myPower
      ? t(lc, 'pty_find_header_p', { n: top.length, p: myPower })
      : t(lc, 'pty_find_header', { n: top.length }),
    embeds: [new EmbedBuilder().setColor(0xfee75c).setDescription(lines.join('\n'))],
    components: [new ActionRowBuilder().addComponents(sel)],
    flags: MessageFlags.Ephemeral,
  });
}

// ===== ⬆️ 上げ直し（埋もれ対策: カードを消して最下部に再掲載。10分に1回）=====
async function bumpParty(interaction, partyId) {
  const lc = interaction.locale;
  const party = db.getParty(partyId);
  if (!party) {
    return interaction.reply({ content: t(lc, 'pty_notfound'), flags: MessageFlags.Ephemeral });
  }
  if (party.host_id !== interaction.user.id) {
    return interaction.reply({ content: t(lc, 'pty_host_only'), flags: MessageFlags.Ephemeral });
  }
  if (party.status !== 'open') {
    return interaction.reply({ content: t(lc, 'pty_ended'), flags: MessageFlags.Ephemeral });
  }
  if (!rateOk('ptybump', interaction.user.id, 1, 10 * 60 * 1000)) {
    return interaction.reply({ content: t(lc, 'pty_bump_rate'), flags: MessageFlags.Ephemeral });
  }
  const ch = await interaction.client.channels.fetch(party.channel_id).catch(() => null);
  if (!ch) {
    return interaction.reply({ content: t(lc, 'pty_notfound'), flags: MessageFlags.Ephemeral });
  }
  if (party.message_id) {
    const old = await ch.messages.fetch(party.message_id).catch(() => null);
    if (old) await old.delete().catch(() => {});
  }
  const msg = await ch.send({
    embeds: [partyEmbed(party)],
    components: [joinRow(party)],
    allowedMentions: NO_PING,
  });
  db.setPartyMessage(partyId, msg.channelId, msg.id);
  schedulePartyPanelRepost(ch);
  await interaction.reply({ content: t(lc, 'pty_bumped'), flags: MessageFlags.Ephemeral });
}

// ===== マイ募集 =====
async function replyMine(interaction) {
  const lc = interaction.locale;
  const mine = db.activePartiesByHost(interaction.user.id);
  if (!mine.length) {
    return interaction.reply({ content: t(lc, 'pty_mine_none'), flags: MessageFlags.Ephemeral });
  }
  await interaction.reply({
    content: t(lc, 'pty_mine_count', { n: mine.length }),
    embeds: mine.slice(0, 4).map((p) => partyEmbed(p)),
    components: mine.slice(0, 4).map((p) =>
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`pty_bump_${p.id}`)
          .setLabel(t(lc, 'pty_bump', { id: p.id }))
          .setEmoji('⬆️')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`pty_done_${p.id}`)
          .setLabel(t(lc, 'pty_disband', { id: p.id }))
          .setEmoji('🗑️')
          .setStyle(ButtonStyle.Danger),
      ),
    ),
    flags: MessageFlags.Ephemeral,
  });
}

// ===== 儀式キャラ選択 =====
async function showRitualPicker(interaction) {
  const lc = interaction.locale;
  const names = catalog.ritualNames();
  if (!names.length) {
    return interaction.reply({ content: t(lc, 'pty_no_ritual'), flags: MessageFlags.Ephemeral });
  }
  const sel = new StringSelectMenuBuilder()
    .setCustomId('pty_ritsel')
    .setPlaceholder(t(lc, 'pty_pick_ritual'))
    .addOptions(
      names.slice(0, 25).map((n) => {
        const o = { label: n.slice(0, 100), value: n.slice(0, 100) };
        const m = catalog.metaOf(n);
        if (m?.attack) o.description = `⚔️${m.attack}`;
        const em = db.getEmoji(n);
        if (em) o.emoji = { id: em.emoji_id, animated: !!em.animated };
        return o;
      }),
    );
  await interaction.reply({
    content: t(lc, 'pty_ritual_intro'),
    components: [new ActionRowBuilder().addComponents(sel)],
    flags: MessageFlags.Ephemeral,
  });
}

// ===== 総合ハンドラ（pty_ 名前空間だけ処理して true を返す）=====
export async function handlePartyInteraction(interaction) {
  // 運営: パネル設置
  if (interaction.isChatInputCommand() && interaction.commandName === '募集パネル設置') {
    // マーケットのパネル/フィードと同じチャンネルはNG（スティッキー同士が最下部を取り合って無限貼り直しになる）
    const cid = interaction.channelId;
    if (
      db.isMarketPanelChannel(cid) ||
      db.isMarketFeedChannel(cid) ||
      cid === db.getSetting('feed_channel_id')
    ) {
      await interaction.reply({
        content: '⚠️ マーケットのパネル/フィードと同じチャンネルには置けないよ。専用チャンネルで実行してね。',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }
    const msg = await interaction.channel.send(buildPartyPanel());
    db.upsertPartyPanel(msg.channelId, msg.id); // 言語ごとに複数設置できる
    await interaction.reply({ content: t(interaction.locale, 'pty_panel_set'), flags: MessageFlags.Ephemeral });
    return true;
  }
  if (interaction.isButton()) {
    const id = interaction.customId;
    if (!id.startsWith('pty_')) return false;
    if (id === 'pty_new_boss') {
      const uid = interaction.user.id;
      if (db.activePartyByHost(uid, 'boss')) {
        await interaction.reply({ content: t(interaction.locale, 'pty_exists'), flags: MessageFlags.Ephemeral });
        return true;
      }
      if (!rateOk('party', uid, 2)) {
        await interaction.reply({ content: t(interaction.locale, 'rl_listing'), flags: MessageFlags.Ephemeral });
        return true;
      }
      await interaction.showModal(
        newPartyModal('boss', null, interaction.locale, db.getProfile(uid)),
      );
      return true;
    }
    if (id === 'pty_new_ritual') {
      const uid = interaction.user.id;
      if (db.activePartyByHost(uid, 'ritual')) {
        await interaction.reply({ content: t(interaction.locale, 'pty_exists'), flags: MessageFlags.Ephemeral });
        return true;
      }
      await showRitualPicker(interaction);
      return true;
    }
    if (id === 'pty_mine') {
      await replyMine(interaction);
      return true;
    }
    if (id === 'pty_find') {
      await replyFind(interaction);
      return true;
    }
    if (id.startsWith('pty_bump_')) {
      await bumpParty(interaction, Number(id.slice('pty_bump_'.length)));
      return true;
    }
    if (id.startsWith('pty_join_')) {
      await joinParty(interaction, Number(id.slice('pty_join_'.length)));
      return true;
    }
    if (id.startsWith('pty_done_')) {
      await closeParty(interaction, Number(id.slice('pty_done_'.length)));
      return true;
    }
    if (id.startsWith('pty_leave_')) {
      await leaveParty(interaction, Number(id.slice('pty_leave_'.length)));
      return true;
    }
    return false;
  }
  if (interaction.isStringSelectMenu() && interaction.customId === 'pty_pick_join') {
    // 🔍探すの結果から選択 → 参加チェック＆モーダル
    await joinParty(interaction, Number(interaction.values[0]));
    return true;
  }
  if (interaction.isStringSelectMenu() && interaction.customId === 'pty_ritsel') {
    // キャラ決定 → そのままモーダルへ（選択メニューの応答としてモーダルを出す）
    await interaction.showModal(
      newPartyModal(
        'ritual',
        interaction.values[0],
        interaction.locale,
        db.getProfile(interaction.user.id),
      ),
    );
    return true;
  }
  if (interaction.isModalSubmit()) {
    const id = interaction.customId;
    if (id.startsWith('pty_newm|')) {
      const [, kind, character] = id.split('|');
      await createParty(interaction, kind, character || null);
      return true;
    }
    if (id.startsWith('pty_joinm_')) {
      await submitJoin(interaction, Number(id.slice('pty_joinm_'.length)));
      return true;
    }
    return false;
  }
  return false;
}

// ===== スティッキー（パネルを最下部に保つ）＆コントロール貼り直し =====
const stickyTimers = new Map();
function schedulePartyPanelRepost(channel) {
  const key = channel.id;
  if (stickyTimers.has(key)) clearTimeout(stickyTimers.get(key));
  stickyTimers.set(key, setTimeout(() => repostPartyPanel(channel), 1500));
}
async function repostPartyPanel(channel) {
  try {
    const p = db.getPartyPanel(channel.id);
    const oldId = p ? p.message_id : null;
    if (oldId) {
      const old = await channel.messages.fetch(oldId).catch(() => null);
      if (old) await old.delete().catch(() => {});
    }
    const msg = await channel.send(buildPartyPanel());
    db.upsertPartyPanel(channel.id, msg.id);
  } catch (e) {
    console.error('募集パネル貼り直し失敗:', e);
  }
}
export function maybeRepostPartySticky(message) {
  if (message.author?.bot) return;
  if (db.isPartyPanelChannel(message.channelId)) schedulePartyPanelRepost(message.channel);
}
const threadStickyTimers = new Map();
export function maybeRepostPartyControl(message) {
  if (message.author?.bot) return;
  const party = db.getPartyByThread(message.channelId);
  if (!party || !['open', 'full'].includes(party.status)) return;
  db.touchPartyByThread(message.channelId); // 会話中は無人クローズしない
  const key = message.channelId;
  if (threadStickyTimers.has(key)) clearTimeout(threadStickyTimers.get(key));
  threadStickyTimers.set(
    key,
    setTimeout(async () => {
      try {
        await message.channel.send({
          content: CONTROL_HINT_PTY,
          components: [controlRow(party.id)],
        });
      } catch (e) {
        console.error('パーティ操作ボタン貼り直し失敗:', e);
      }
    }, 1500),
  );
}

// ===== 定期メンテ（募集の自動失効＋パネル最下部維持）=====
let partySweepRunning = false;
export function startPartySweepLoop(client) {
  setInterval(async () => {
    if (partySweepRunning) return;
    partySweepRunning = true;
    try {
      await sweepParties(client);
    } catch (e) {
      console.error('パーティ定期メンテ失敗:', e);
    } finally {
      partySweepRunning = false;
    }
  }, 60 * 1000);
}
async function sweepParties(client) {
  // 満員after20分クローズ（集合済み＝もうゲームの中。部屋だけが枠に残るのを防ぐ）
  for (const p of db.idleFullPartiesWithThread(PARTY_FULL_IDLE_TTL)) {
    db.setPartyStatus(p.id, 'closed');
    await cleanupParty(
      client,
      p,
      `🎉 集合おつかれ！部屋を閉じるね。またボス戦で会おう！ / Squad's off — closing this room. GLHF!`,
    );
  }
  // 部屋の無人1時間クローズ（出発済み/放置の部屋がスレッド枠に居座らないように）
  for (const p of db.idlePartiesWithThread(PARTY_IDLE_TTL)) {
    db.setPartyStatus(p.id, 'expired');
    await cleanupParty(
      client,
      p,
      `🕐 1時間動きがなかったので部屋を閉じたよ。ゲーム楽しんで！ / Room closed after 1h of quiet — enjoy the game!`,
    );
  }
  // 6時間で自動失効（カード削除＋スレッドにお知らせ→削除）
  for (const p of db.expireParties(PARTY_TTL)) {
    await cleanupParty(
      client,
      p,
      `⌛ <@${p.host_id}> 時間切れで募集を閉じたよ。また「⚔️/🔮」から募集してね！ / Recruit expired — post again anytime!`,
    );
  }
  db.prunePartyRows(7 * 24 * 60 * 60 * 1000);
  // パネルを常に最下部へ
  try {
    // 設置されている全パネル（日本語版・英語版…）をそれぞれ最下部に保つ
    for (const p of db.allPartyPanels()) {
      const channel = await client.channels.fetch(p.channel_id).catch(() => null);
      if (!channel) continue;
      const last = await channel.messages.fetch({ limit: 1 }).catch(() => null);
      const lastId = last && last.first() ? last.first().id : null;
      if (lastId && lastId !== p.message_id) {
        if (p.message_id) {
          const old = await channel.messages.fetch(p.message_id).catch(() => null);
          if (old) await old.delete().catch(() => {});
        }
        const msg = await channel.send(buildPartyPanel());
        db.setPartyPanelMessage(p.channel_id, msg.id);
      }
    }
  } catch (e) {
    console.error('募集パネル最下部維持失敗:', e);
  }
}
