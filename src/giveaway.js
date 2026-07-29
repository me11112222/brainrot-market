// 抽選（プレゼント企画）システム
// 思想: 企画=DB行＋カード1枚。スレッドを一切使わないので1000スレッド枠を消費しない。
// フロー: /抽選作成 → モーダル → カード投稿（賞品画像・締切カウントダウン・参加者数ライブ表示）
//        → メンバーは🎟️ワンタップで参加 → 締切に自動抽選 → 当選者を@メンション＋ID付きで全体発表。
// 公平性: 抽選は crypto.randomInt（Math.randomは使わない）。参加者リストはDBに残るので後から検証できる。
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
} from 'discord.js';
import { randomInt } from 'node:crypto';
import * as db from './db.js';
import * as catalog from './catalog.js';
import { t } from './i18n.js';
import { cleanText, contentIssue, rateOk } from './moderation.js';

const COLOR = 0xf1c40f; // ゴールド
const COLOR_DONE = 0x95a5a6;
const NO_PING = { parse: [] };
const MAX_WINNERS = 20;
const MAX_HOURS = 24 * 14; // 最長2週間

// 賞品名から変異(スキン)を拾って画像を切り替えるための語彙
const SKIN_WORDS = {
  Neon: ['neon', 'ネオン'],
  Gold: ['gold', 'ゴールド', '金'],
  Diamond: ['diamond', 'ダイヤ'],
  Rainbow: ['rainbow', 'レインボー', '虹'],
  Angel: ['angel', '天使'],
  Devil: ['devil', '悪魔'],
  Royal: ['royal', 'ロイヤル'],
  Yokai: ['yokai', '妖怪'],
  Pirate: ['pirate', 'パイレーツ', '海賊'],
};

export const giveawayCommands = [
  new SlashCommandBuilder()
    .setName('抽選作成')
    .setDescription('【運営用】このチャンネルにプレゼント抽選を作る（締切に自動抽選）')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption((o) =>
      o
        .setName('最低アカウント日数')
        .setDescription('複垢対策。Discordアカウント作成からの日数（既定0＝誰でも参加OK）')
        .setMinValue(0)
        .setMaxValue(3650),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName('抽選中止')
    .setDescription('【運営用】まだ締切前の抽選を中止する')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption((o) =>
      o.setName('番号').setDescription('カード下部の「抽選 #番号」').setRequired(true),
    )
    .toJSON(),
];

// ===== 賞品の解決（図鑑にあれば画像とステータスを自動で付ける）=====
function resolvePrize(input) {
  const tokens = input.split(/[\s　]+/).filter(Boolean);
  // 正規化＋カタカナエイリアス込みの検索。全語AND扱いなので、まず全文→ダメなら語ごとに試す
  let hit = catalog.searchNames(input, 1)[0] || null;
  if (!hit) {
    for (const tk of tokens) {
      const h = catalog.searchNames(tk, 1)[0];
      if (h) {
        hit = h;
        break;
      }
    }
  }
  if (!hit) hit = catalog.suggestNames(tokens[0] || input, 1)[0] || null; // あいまい一致で最後の救済
  if (!hit) return { name: null, img: null };
  const low = input.toLowerCase();
  let skin = 'Default';
  for (const [key, words] of Object.entries(SKIN_WORDS)) {
    if (words.some((w) => low.includes(w))) {
      skin = key;
      break;
    }
  }
  const keys = catalog.skinKeys(hit);
  if (skin !== 'Default' && !keys.includes(skin)) skin = 'Default';
  return { name: hit, img: catalog.skinImage(hit, skin) };
}

function prizeStats(name) {
  const m = name ? catalog.metaOf(name) : null;
  if (!m) return null;
  const parts = [];
  if (m.attack != null) parts.push(`⚔️ ${m.attack}（★5→${Math.floor(m.attack * 2.8)}）`);
  if (m.rarity) parts.push(`💎 ${m.rarity}`);
  if (m.production) parts.push(`🏭 ${m.production}`);
  return parts.length ? parts.join('　') : null;
}

// ===== カード =====
function joinRow(id, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`gw_join_${id}`)
      .setLabel('参加する / Join')
      .setEmoji('🎟️')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
  );
}

function giveawayEmbed(g, entryCount, winners = null) {
  const done = g.status !== 'open';
  const ends = Math.floor(g.ends_at / 1000);
  const e = new EmbedBuilder()
    .setColor(done ? COLOR_DONE : COLOR)
    .setTitle(`${done ? '🏁' : '🎉'} ${g.title}`);
  const lines = [`🎁 **${g.prize_label}**`];
  const st = prizeStats(g.prize_name);
  if (st) lines.push(st);
  lines.push('');
  lines.push(`🏆 当選 **${g.winners}人** / winners`);
  lines.push(
    done
      ? `⏰ 締切済み / closed <t:${ends}:R>`
      : `⏰ 締切 <t:${ends}:f>（**<t:${ends}:R>**）/ ends`,
  );
  lines.push(`🎟️ 参加者 **${entryCount}人** / entries`);
  if (g.min_acct_days > 0) {
    lines.push(`🔒 参加条件: アカウント作成から**${g.min_acct_days}日以上**`);
  }
  if (g.note) lines.push(`\n📝 ${g.note}`);
  if (g.status === 'cancelled') {
    lines.push('\n🛑 **この抽選は中止されました** / cancelled by staff');
  } else if (done && winners) {
    lines.push('');
    lines.push(
      winners.length
        ? `👑 **当選者 / Winner**\n${winners.map((w) => `<@${w.user_id}>`).join('  ')}`
        : '😢 参加者がいなかったので中止したよ / cancelled (no entries)',
    );
  }
  if (!done) {
    lines.push('\n下の **🎟️参加する** を押すだけ！ / Just tap Join below!');
  }
  e.setDescription(lines.join('\n'));
  if (g.prize_img) e.setImage(g.prize_img);
  e.setFooter({ text: `抽選 #${g.id}` });
  return e;
}

// 参加のたびに編集するとレート制限に当たるので、数秒まとめて1回だけ更新する
const refreshTimers = new Map();
function scheduleCardRefresh(client, id) {
  if (refreshTimers.has(id)) return;
  refreshTimers.set(
    id,
    setTimeout(() => {
      refreshTimers.delete(id);
      refreshCard(client, id).catch(() => {});
    }, 4000),
  );
}
async function refreshCard(client, id, winners = null) {
  const g = db.getGiveaway(id);
  if (!g || !g.channel_id || !g.message_id) return;
  const ch = await client.channels.fetch(g.channel_id).catch(() => null);
  if (!ch) return;
  const msg = await ch.messages.fetch(g.message_id).catch(() => null);
  if (!msg) return;
  const n = db.countGiveawayEntries(id);
  await msg
    .edit({
      embeds: [giveawayEmbed(g, n, winners)],
      components: [joinRow(id, g.status !== 'open')],
    })
    .catch(() => {});
}

// ===== 作成 =====
function createModal(minDays) {
  return new ModalBuilder()
    .setCustomId(`gw_create_${minDays}`)
    .setTitle('プレゼント抽選をつくる')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('title')
          .setLabel('タイトル')
          .setPlaceholder('例: 4万人達成記念プレゼント！')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(80),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('prize')
          .setLabel('賞品（図鑑の名前を書くと画像が自動で付く）')
          .setPlaceholder('例: DearDeer ネオン ★5 / ディアディア')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(80),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('winners')
          .setLabel('当選人数')
          .setPlaceholder('1')
          .setValue('1')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(3),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('hours')
          .setLabel('締切までの時間（時間）')
          .setPlaceholder('24 ＝ 1日後に自動で抽選')
          .setValue('24')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(4),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('note')
          .setLabel('メモ（任意・注意事項など）')
          .setPlaceholder('例: 当選者にはこちらから声をかけます！')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(300),
      ),
    );
}

// 全角数字も拾う
function parseNum(s) {
  const z = String(s || '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  const m = z.match(/\d+/);
  return m ? parseInt(m[0], 10) : NaN;
}

async function createGiveaway(interaction, minDays) {
  const lc = interaction.locale;
  const title = cleanText(interaction.fields.getTextInputValue('title'));
  const prizeRaw = cleanText(interaction.fields.getTextInputValue('prize'));
  const note = cleanText(interaction.fields.getTextInputValue('note') || '');
  const winners = parseNum(interaction.fields.getTextInputValue('winners'));
  const hours = parseNum(interaction.fields.getTextInputValue('hours'));

  if (contentIssue(title) || contentIssue(prizeRaw) || contentIssue(note)) {
    return interaction.reply({ content: t(lc, 'bad_url'), flags: MessageFlags.Ephemeral });
  }
  if (!Number.isFinite(winners) || winners < 1 || winners > MAX_WINNERS ||
      !Number.isFinite(hours) || hours < 1 || hours > MAX_HOURS) {
    return interaction.reply({ content: t(lc, 'gw_bad_input'), flags: MessageFlags.Ephemeral });
  }

  const prize = resolvePrize(prizeRaw);
  const id = db.addGiveaway({
    hostId: interaction.user.id,
    title,
    prizeName: prize.name,
    prizeLabel: prizeRaw,
    prizeImg: prize.img,
    note,
    winners,
    minAcctDays: minDays,
    endsAt: Date.now() + hours * 60 * 60 * 1000,
  });
  const g = db.getGiveaway(id);
  try {
    const msg = await interaction.channel.send({
      embeds: [giveawayEmbed(g, 0)],
      components: [joinRow(id)],
      allowedMentions: NO_PING,
    });
    db.setGiveawayMessage(id, msg.channelId, msg.id);
  } catch (e) {
    console.error('抽選カード投稿失敗:', e);
    db.setGiveawayStatus(id, 'cancelled'); // カードが出せないなら企画ごと無効化（孤児防止）
    return interaction.reply({ content: t(lc, 'gw_post_fail'), flags: MessageFlags.Ephemeral });
  }
  return interaction.reply({
    content:
      t(lc, 'gw_created', { id }) +
      (prize.name ? `\n🖼️ 図鑑と一致: **${prize.name}**（画像を付けたよ）` : '\n⚠️ 図鑑に一致なし＝画像なしで出したよ'),
    flags: MessageFlags.Ephemeral,
  });
}

// ===== 参加 =====
async function joinGiveaway(interaction, id) {
  const lc = interaction.locale;
  const g = db.getGiveaway(id);
  if (!g) {
    return interaction.reply({ content: t(lc, 'gw_not_found'), flags: MessageFlags.Ephemeral });
  }
  if (g.status !== 'open' || g.ends_at <= Date.now()) {
    return interaction.reply({ content: t(lc, 'gw_closed'), flags: MessageFlags.Ephemeral });
  }
  if (!rateOk('gwjoin', interaction.user.id, 5)) {
    return interaction.reply({ content: t(lc, 'gw_rate'), flags: MessageFlags.Ephemeral });
  }
  // 複垢対策（0なら無条件）。アカウント作成日時はIDから分かるのでintent不要。
  if (g.min_acct_days > 0) {
    const days = (Date.now() - interaction.user.createdTimestamp) / 86400000;
    if (days < g.min_acct_days) {
      return interaction.reply({
        content: t(lc, 'gw_too_new', { n: g.min_acct_days }),
        flags: MessageFlags.Ephemeral,
      });
    }
  }
  const fresh = db.addGiveawayEntry(id, interaction.user.id, interaction.user.tag);
  if (!fresh) {
    return interaction.reply({ content: t(lc, 'gw_already'), flags: MessageFlags.Ephemeral });
  }
  await interaction.reply({
    content: t(lc, 'gw_entered', { n: db.countGiveawayEntries(id) }),
    flags: MessageFlags.Ephemeral,
  });
  scheduleCardRefresh(interaction.client, id);
}

// ===== 抽選 =====
// 暗号学的乱数で部分シャッフル＝先頭k件が公平な当選者
function pickWinners(list, n) {
  const a = list.slice();
  const k = Math.min(n, a.length);
  for (let i = 0; i < k; i++) {
    const j = i + randomInt(a.length - i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, k);
}

async function drawGiveaway(client, g) {
  const entries = db.allGiveawayEntries(g.id);
  const winners = pickWinners(entries, g.winners);
  for (const w of winners) db.addGiveawayWinner(g.id, w.user_id, w.user_tag);
  db.setGiveawayStatus(g.id, 'drawn');

  const ch = await client.channels.fetch(g.channel_id).catch(() => null);
  await refreshCard(client, g.id, winners); // カードを🏁終了＋当選者入りに更新
  if (!ch) return;

  if (!winners.length) {
    await ch
      .send({
        content: `😢 **${g.title}** は参加者がいなかったので中止したよ。\nNo entries — giveaway cancelled.`,
        allowedMentions: NO_PING,
      })
      .catch(() => {});
    return;
  }

  // 🥁ドラムロール → 3秒後に結果へ差し替え（発表感を出す）
  const rate = ((winners.length / entries.length) * 100).toFixed(1);
  const body =
    `🎉🎉 **当選者発表 / WINNER** 🎉🎉\n` +
    `🎁 **${g.prize_label}**（${g.title}）\n\n` +
    winners
      .map((w) => `👑 <@${w.user_id}>　\`${w.user_tag || '?'}\`　\`ID: ${w.user_id}\``)
      .join('\n') +
    `\n\n📊 参加 **${entries.length}人** → 当選 **${winners.length}人**（当選確率 ${rate}%）\n` +
    `🙌 参加してくれたみんなありがとう！ / Thanks to everyone who entered!\n` +
    `📮 <@${g.host_id}> 受け渡しよろしく！`;
  try {
    const drum = await ch.send({ content: '🥁 **抽選中…** / Drawing…', allowedMentions: NO_PING });
    setTimeout(() => {
      drum
        .edit({
          content: body,
          allowedMentions: { users: [...winners.map((w) => w.user_id), g.host_id] },
        })
        .catch(() => {
          ch.send({
            content: body,
            allowedMentions: { users: [...winners.map((w) => w.user_id), g.host_id] },
          }).catch(() => {});
        });
    }, 3000);
  } catch (e) {
    console.error('抽選発表失敗:', e);
  }
}

// ===== 中止 =====
async function cancelGiveaway(interaction, id) {
  const lc = interaction.locale;
  const g = db.getGiveaway(id);
  if (!g) {
    return interaction.reply({ content: t(lc, 'gw_not_found'), flags: MessageFlags.Ephemeral });
  }
  if (g.status !== 'open') {
    return interaction.reply({ content: t(lc, 'gw_closed'), flags: MessageFlags.Ephemeral });
  }
  db.setGiveawayStatus(id, 'cancelled');
  await refreshCard(interaction.client, id, []);
  return interaction.reply({ content: t(lc, 'gw_cancelled', { id }), flags: MessageFlags.Ephemeral });
}

// ===== ハンドラ =====
export async function handleGiveawayInteraction(interaction) {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === '抽選作成') {
      const minDays = interaction.options.getInteger('最低アカウント日数') ?? 0;
      await interaction.showModal(createModal(minDays));
      return true;
    }
    if (interaction.commandName === '抽選中止') {
      await cancelGiveaway(interaction, interaction.options.getInteger('番号'));
      return true;
    }
    return false;
  }
  if (interaction.isModalSubmit() && interaction.customId.startsWith('gw_create_')) {
    const minDays = parseInt(interaction.customId.slice('gw_create_'.length), 10) || 0;
    await createGiveaway(interaction, minDays);
    return true;
  }
  if (interaction.isButton() && interaction.customId.startsWith('gw_join_')) {
    await joinGiveaway(interaction, Number(interaction.customId.slice('gw_join_'.length)));
    return true;
  }
  return false;
}

// ===== 締切監視ループ =====
let sweeping = false;
export function startGiveawaySweepLoop(client) {
  const tick = async () => {
    if (sweeping) return; // 多重実行ガード（二重抽選の防止）
    sweeping = true;
    try {
      for (const g of db.dueGiveaways()) {
        try {
          await drawGiveaway(client, g);
        } catch (e) {
          console.error(`抽選#${g.id} 失敗:`, e);
          db.setGiveawayStatus(g.id, 'drawn'); // 無限リトライで荒らさない
        }
      }
    } catch (e) {
      console.error('抽選ループ失敗:', e);
    } finally {
      sweeping = false;
    }
  };
  tick(); // 起動直後に1回＝停止中に過ぎた締切を取りこぼさない
  setInterval(tick, 30 * 1000);
}
