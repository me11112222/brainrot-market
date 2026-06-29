// マッチング型マーケットプレイス（完全ボタン化・画像ピッカー・多言語対応）
// ・本人だけに見える応答 → interaction.locale で日/英を出し分け（t()）
// ・全員が見る共有メッセージ（パネル/出品カード/取引ルーム/失効通知） → 日英併記
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
import { t, L } from './i18n.js';
import { cleanText, contentIssue, rateOk, cleanupBuckets } from './moderation.js';

const COLOR = 0x57f287;
// 取引ルーム：無反応10分で警告（出品者にPING）→さらに5分（計15分）で削除。
const ROOM_WARN = 10 * 60 * 1000; // 10分無反応で「あと5分で削除」警告＋ホストPing
const ROOM_IDLE_TTL = 15 * 60 * 1000; // 15分無反応で削除
const ROOM_HARD_MAX = 24 * 60 * 60 * 1000; // 活動があっても24hで強制終了（保険）
const LISTING_TTL = 7 * 24 * 60 * 60 * 1000; // 出品は7日で自動失効
// 取引ルームの常設・詐欺注意（日英併記・ピン留め）
const SCAM_NOTICE =
  '⚠️ **取引は自己責任で / Trade at your OWN RISK**\n' +
  '・運営は取引トラブルに一切責任を負いません / Staff are NOT responsible for any trouble\n' +
  '・**クロストレード禁止（他ゲーム・現金・アカウント等との交換）/ NO cross-trading (other games, real money, accounts, etc.)**\n' +
  '・先払い要求・外部リンク・DM誘導は詐欺の可能性大 / Pay-first, external links or DM lures are likely SCAMS\n' +
  '⏰ 10分会話が無いと、5分後に自動で閉じます / Auto-closes 5 min after 10 min of silence';
// 取引ルーム同時生成のレース防止（単一プロセス内ロック）
const creatingRooms = new Set();
// 荒らし対策のしきい値
const LIMITS = {
  listingsPerMin: 1, // 1分あたりの出品回数（安全寄り）
  roomsPerMin: 3, // 1分あたりの取引ルーム開設回数
  maxActiveListings: 3, // 1人が同時に持てるアクティブ出品数
};
// 共有メッセージはユーザー文がメンションを発火しないように
const NO_PING = { parse: [] };

// 変異(スキン)名の表示ラベル。日本語勢にはJP、英語勢には英語名。
const SKIN_LABELS_JA = {
  Default: '通常', Neon: 'ネオン', Gold: 'ゴールド', Diamond: 'ダイヤ', Rainbow: 'レインボー',
  Angel: '天使', Devil: '悪魔', Royal: 'ロイヤル', Yokai: '妖怪', Pirate: 'パイレーツ',
};
const SKIN_LABELS_EN = {
  Default: 'Normal', Neon: 'Neon', Gold: 'Gold', Diamond: 'Diamond', Rainbow: 'Rainbow',
  Angel: 'Angel', Devil: 'Devil', Royal: 'Royal', Yokai: 'Yokai', Pirate: 'Pirate',
};
function skinLabel(locale, key) {
  return (L(locale) === 'ja' ? SKIN_LABELS_JA : SKIN_LABELS_EN)[key] || key;
}

// 共有メッセージ用の日英併記フィールド名（言語混在の場でも両者に伝わる）
const F_GIVE = '⬆️ 出すもの / Offering';
const F_WANT = '⬇️ ほしいもの / Want';
const F_NOTE = '📝 メモ / Note';
const F_STATS = '📊 ステータス / Stats';

// 図鑑の戦闘力・レア度・価格・生産を1行にまとめる（取引判断の材料）
function statsLine(name) {
  const m = catalog.metaOf(name);
  if (!m) return null;
  const parts = [];
  if (m.attack != null) parts.push(`⚔️ ${m.attack}`);
  if (m.rarity) parts.push(`💎 ${m.rarity}`);
  if (m.price) parts.push(`💰 ${m.price}`);
  if (m.production) parts.push(`🏭 ${m.production}`);
  return parts.length ? parts.join('　') : null;
}

export const marketplaceCommands = [
  new SlashCommandBuilder()
    .setName('パネル設置')
    .setDescription('【運営用】このチャンネルに操作パネルを設置（出品/探す/マイ出品/ランキング）')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),
  new SlashCommandBuilder()
    .setName('フィード設置')
    .setDescription('【運営用】出品カードをこのチャンネルに流す（出品フィード）')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),
];

// ===== パネル（共有・日英併記）=====
export function buildPanel() {
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle('🛒 交換マーケット / Trade Market')
    .setDescription(
      [
        '🟢 **出品する / Post** … 画像で選んで出品 / pick by image',
        '🔍 **ほしいモノを探す / Find** … 画像で選ぶ→出品者を表示 / pick by image → show sellers',
        '📋 **マイ出品 / My listings** … 確認・取り下げ / view & withdraw',
        '📊 **ランキング / Ranking** … 人気の出品・需要を見る / popular supply & demand',
        '',
        '※ 1出品=1ルーム・24hで自動クローズ / 1 room per listing, auto-closes in 24h.',
      ].join('\n'),
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('mkt_create')
      .setLabel('出品する / Post')
      .setEmoji('🟢')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('mkt_search')
      .setLabel('探す / Find')
      .setEmoji('🔍')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('mkt_mine')
      .setLabel('マイ出品 / Mine')
      .setEmoji('📋')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('mkt_rank')
      .setLabel('ランキング / Ranking')
      .setEmoji('📊')
      .setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row] };
}

// ===== 掲示・取引（共有・日英併記）=====
function listingEmbed(listing, sellerTag) {
  const e = new EmbedBuilder()
    .setColor(COLOR)
    .setAuthor({ name: `出品 / Listing #${listing.id}` })
    .addFields({ name: F_GIVE, value: listing.give_item });
  if (listing.want_item) e.addFields({ name: F_WANT, value: listing.want_item });
  if (listing.note) e.addFields({ name: F_NOTE, value: listing.note });
  const stats = statsLine(listing.give_name);
  if (stats) e.addFields({ name: F_STATS, value: stats });
  if (listing.give_img) e.setImage(listing.give_img);
  if (listing.want_img) e.setThumbnail(listing.want_img);
  e.setFooter({ text: `出品者 / Seller: ${sellerTag}` });
  return e;
}
function matchEmbed(listing) {
  const e = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle('🤝 取引ルーム / Trade Room')
    .addFields({ name: F_GIVE, value: listing.give_item });
  if (listing.want_item) e.addFields({ name: F_WANT, value: listing.want_item });
  if (listing.note) e.addFields({ name: F_NOTE, value: listing.note });
  const stats = statsLine(listing.give_name);
  if (stats) e.addFields({ name: F_STATS, value: stats });
  if (listing.give_img) e.setImage(listing.give_img);
  return e;
}
function dealRow(listingId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`mkt_deal_${listingId}`)
      .setLabel('この人と取引 / Trade')
      .setEmoji('🤝')
      .setStyle(ButtonStyle.Success),
  );
}
function doneRow(listingId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`mkt_done_${listingId}`)
      .setLabel('取引完了 / Done (seller)')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`mkt_leave_${listingId}`)
      .setLabel('退出 / Leave')
      .setEmoji('🚪')
      .setStyle(ButtonStyle.Secondary),
  );
}
// 不在で時間切れした出品者向け：ワンタップ再出品ボタン（DMに付ける）
function relistRow(listingId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`mkt_relist_${listingId}`)
      .setLabel('同じ条件で再出品 / Re-list')
      .setEmoji('🔁')
      .setStyle(ButtonStyle.Success),
  );
}
function roomName(listing) {
  return `🤝${listing.give_item}`.slice(0, 90);
}

async function startMatch(interaction, listing) {
  const lc = interaction.locale;
  const user = interaction.user;
  if (listing.status !== 'active') {
    return interaction.reply({ content: t(lc, 'listing_ended'), flags: MessageFlags.Ephemeral });
  }
  const room = db.getRoom(listing.id);
  if (room) {
    const thread = await interaction.client.channels.fetch(room.thread_id).catch(() => null);
    if (thread) {
      await thread.members.add(user.id).catch(() => {});
      return interaction.reply({
        content: t(lc, 'room_here', { thread }),
        flags: MessageFlags.Ephemeral,
      });
    }
    db.deleteRoom(listing.id);
  }
  if (listing.seller_id === user.id) {
    return interaction.reply({ content: t(lc, 'own_listing'), flags: MessageFlags.Ephemeral });
  }
  let parent = interaction.channel;
  if (parent?.isThread()) parent = parent.parent;
  if (!parent || parent.type !== ChannelType.GuildText) {
    return interaction.reply({ content: t(lc, 'cant_make_room'), flags: MessageFlags.Ephemeral });
  }
  if (!rateOk('room', user.id, LIMITS.roomsPerMin)) {
    return interaction.reply({ content: t(lc, 'rl_room'), flags: MessageFlags.Ephemeral });
  }
  // 二重生成レース防止：同じ出品を同時に処理させない
  if (creatingRooms.has(listing.id)) {
    return interaction.reply({ content: t(lc, 'room_busy'), flags: MessageFlags.Ephemeral });
  }
  creatingRooms.add(listing.id);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    // 直前に別人が部屋を作っていたら、そこへ合流（新規スレッドを作らない）
    const existing = db.getRoom(listing.id);
    if (existing) {
      const th = await interaction.client.channels.fetch(existing.thread_id).catch(() => null);
      if (th) {
        await th.members.add(user.id).catch(() => {});
        db.addRoomMember(listing.id, user.id);
        await interaction.editReply(t(lc, 'room_here', { thread: th }));
        return;
      }
      db.deleteRoom(listing.id);
    }
    const thread = await parent.threads.create({
      name: roomName(listing),
      type: ChannelType.PrivateThread,
      invitable: false,
      reason: 'マーケット取引 / marketplace trade',
    });
    await thread.members.add(listing.seller_id).catch(() => {});
    await thread.members.add(user.id).catch(() => {});
    db.addRoom(listing.id, thread.id);
    db.addRoomMember(listing.id, listing.seller_id);
    db.addRoomMember(listing.id, user.id);
    await thread.send({
      content: `<@${listing.seller_id}> ↔ <@${user.id}>`,
      embeds: [matchEmbed(listing)],
      allowedMentions: { users: [listing.seller_id, user.id] },
    });
    const notice = await thread.send(SCAM_NOTICE);
    await notice.pin().catch(() => {});
    const ctrl = await thread.send({
      content:
        '👇 出品者は終わったら「✅取引完了」、間違えて入った人は「🚪退出」/ ' +
        'Seller: ✅ Done when finished. Wrong room? 🚪 Leave',
      components: [doneRow(listing.id)],
    });
    db.setRoomControl(listing.id, ctrl.id);
    await interaction.editReply(t(lc, 'room_created', { thread }));
  } catch (err) {
    console.error('ルーム作成失敗:', err);
    if (err?.rawError?.errors) {
      console.error('ルーム作成 50035詳細:', JSON.stringify(err.rawError.errors));
    }
    await interaction.editReply(t(lc, 'room_fail'));
  } finally {
    creatingRooms.delete(listing.id);
  }
}

async function closeListing(interaction, listingId, byDone) {
  const lc = interaction.locale;
  const listing = db.getListing(listingId);
  if (!listing) {
    await interaction.reply({ content: t(lc, 'listing_not_found'), flags: MessageFlags.Ephemeral });
    return;
  }
  if (listing.seller_id !== interaction.user.id) {
    await interaction.reply({ content: t(lc, 'only_own'), flags: MessageFlags.Ephemeral });
    return;
  }
  db.setStatus(listingId, 'closed');
  if (listing.channel_id && listing.message_id) {
    const ch = await interaction.client.channels.fetch(listing.channel_id).catch(() => null);
    await ch?.messages?.delete(listing.message_id).catch(() => {});
  }
  await interaction.reply({
    content: byDone ? t(lc, 'deal_done') : t(lc, 'withdrawn', { id: listingId }),
    flags: MessageFlags.Ephemeral,
  });
  const room = db.getRoom(listingId);
  if (room) {
    db.deleteRoom(listingId);
    const thread = await interaction.client.channels.fetch(room.thread_id).catch(() => null);
    if (thread) setTimeout(() => thread.delete().catch(() => {}), 4000);
  }
}

// ===== さがす（ピッカー型検索）=====
// アイテムのカスタム絵文字を埋め込みテキストで使うためのメンション文字列
function emojiMention(name) {
  const e = db.getEmoji(name);
  if (!e) return '';
  return `<${e.animated ? 'a' : ''}:it:${e.emoji_id}>`;
}
// 検索結果1件ぶんのコンパクトな埋め込み（サムネ＋戦闘力）。最大10件並べるため軽量に。
function resultEmbed(listing, lc) {
  const e = new EmbedBuilder()
    .setColor(COLOR)
    .setAuthor({ name: `出品 / Listing #${listing.id}` })
    .addFields({ name: F_GIVE, value: listing.give_item });
  if (listing.want_item) e.addFields({ name: F_WANT, value: listing.want_item });
  if (listing.note) e.addFields({ name: F_NOTE, value: listing.note });
  const stats = statsLine(listing.give_name);
  if (stats) e.addFields({ name: F_STATS, value: stats });
  if (listing.give_img) e.setThumbnail(listing.give_img);
  return e;
}
// 結果から取引相手を選ぶプルダウン（ボタン10個は不可なので選択メニューで）
function dealSelect(listings, lc) {
  const sel = new StringSelectMenuBuilder()
    .setCustomId('mkt_pick_deal')
    .setPlaceholder(t(lc, 'pick_deal'))
    .addOptions(
      listings.slice(0, 25).map((l) => {
        const o = { label: `#${l.id} ${l.give_item}`.slice(0, 100), value: String(l.id) };
        const em = db.getEmoji(l.give_name);
        if (em) o.emoji = { id: em.emoji_id, animated: !!em.animated };
        return o;
      }),
    );
  return new ActionRowBuilder().addComponents(sel);
}
// 探すで選ばれたアイテムの出品を表示。ぴったり無ければ「戦闘力が近い出品」を最大10件。
async function showSearchResults(interaction, name) {
  const lc = interaction.locale;
  db.recordWant(name, interaction.user.id); // 需要として記録（ユーザー単位ユニーク）
  let list = db.searchListings(name, 10);
  let header = list.length ? t(lc, 'search_results_for', { item: name, n: list.length }) : null;
  if (!list.length) {
    const target = catalog.attackOf(name);
    if (target != null) {
      // 実際の戦闘力(attack)が近い順に並べる
      list = db
        .activeListings(300)
        .filter(
          (l) => l.give_name && l.give_name !== name && catalog.attackOf(l.give_name) != null,
        )
        .sort(
          (a, b) =>
            Math.abs(catalog.attackOf(a.give_name) - target) -
            Math.abs(catalog.attackOf(b.give_name) - target),
        )
        .slice(0, 10);
    } else {
      // 戦闘力不明なものは同カテゴリでフォールバック
      const cat = catalog.categoryOf(name);
      list = cat
        ? db.activeListingsByNames(catalog.itemsByCategory(cat), 10).filter((l) => l.give_name !== name)
        : [];
    }
    header = list.length ? t(lc, 'search_similar', { item: name }) : null;
  }
  if (!list.length) {
    return interaction.update({
      content: t(lc, 'search_empty', { item: name }),
      embeds: [],
      components: [],
    });
  }
  return interaction.update({
    content: header,
    embeds: list.map((l) => resultEmbed(l, lc)),
    components: [dealSelect(list, lc)],
  });
}
// 人気ランキング（供給＝出品の多い物／需要＝探された多い物）
async function replyRanking(interaction) {
  const lc = interaction.locale;
  const sup = db.topSupply(10);
  const dem = db.topWants(10);
  const fmt = (rows) =>
    rows.length
      ? rows
          .map((r, i) => `**${i + 1}.** ${emojiMention(r.name)} ${r.name} ×${r.c}`)
          .join('\n')
      : t(lc, 'rank_empty');
  const e = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(t(lc, 'ranking_title'))
    .addFields(
      { name: t(lc, 'rank_supply'), value: fmt(sup), inline: true },
      { name: t(lc, 'rank_demand'), value: fmt(dem), inline: true },
    )
    .setFooter({ text: t(lc, 'rank_hint') });
  await interaction.reply({ embeds: [e], flags: MessageFlags.Ephemeral });
}
// 自分の出品一覧＋🗑️取り下げボタンのペイロード（マイ出品・上限到達時に共用）
function myListingsPayload(userId, tag, lc, header) {
  const mine = db.listByUser(userId);
  if (mine.length === 0) {
    return { content: t(lc, 'mine_none'), embeds: [], components: [] };
  }
  return {
    content: header ?? t(lc, 'mine_count', { n: mine.length }),
    embeds: mine.slice(0, 5).map((l) => listingEmbed(l, tag)),
    components: mine.slice(0, 5).map((l) =>
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`mkt_close_${l.id}`)
          .setLabel(t(lc, 'withdraw', { id: l.id }))
          .setEmoji('🗑️')
          .setStyle(ButtonStyle.Danger),
      ),
    ),
  };
}
async function replyMyListings(interaction) {
  await interaction.reply({
    ...myListingsPayload(interaction.user.id, interaction.user.tag, interaction.locale),
    flags: MessageFlags.Ephemeral,
  });
}

// ===== 画像ピッカー（出品）=====
const pickerSessions = new Map();

function rarityRow(lc) {
  const opts = catalog
    .categories()
    .slice(0, 25)
    .map((r) => ({ label: r.slice(0, 100), value: r.slice(0, 100) }));
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('mkt2_rar')
      .setPlaceholder(t(lc, 'cat_placeholder'))
      .addOptions(opts.length ? opts : [{ label: t(lc, 'catalog_empty'), value: 'none' }]),
  );
}
function searchRow(lc) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('mkt2_search_name')
      .setLabel(t(lc, 'search_by_name'))
      .setEmoji('🔍')
      .setStyle(ButtonStyle.Secondary),
  );
}
function rarityView(lc, mode = 'sell') {
  return {
    content: mode === 'search' ? t(lc, 'search_pick_category') : t(lc, 'pick_category'),
    embeds: [],
    components: [rarityRow(lc), searchRow(lc)],
  };
}
// 選択メニュー用オプション。登録済みのカスタム絵文字があれば項目にアイコン画像を付ける
function optionFor(name) {
  const o = { label: name.slice(0, 100), value: name.slice(0, 100) };
  const e = db.getEmoji(name);
  if (e) o.emoji = { id: e.emoji_id, animated: !!e.animated };
  return o;
}
function backRarRow(lc) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('mkt2_backrar')
      .setLabel(t(lc, 'back_category'))
      .setStyle(ButtonStyle.Secondary),
  );
}
function searchResultView(names, lc) {
  if (!names.length) {
    return {
      content: t(lc, 'no_match'),
      embeds: [],
      components: [searchRow(lc), backRarRow(lc)],
    };
  }
  const sel = new StringSelectMenuBuilder()
    .setCustomId('mkt2_item')
    .setPlaceholder(t(lc, 'pick_from_results'))
    .addOptions(names.map(optionFor));
  return {
    content: t(lc, 'results_count', { n: names.length }),
    embeds: [],
    components: [new ActionRowBuilder().addComponents(sel), backRarRow(lc)],
  };
}
function nameSearchModal(lc) {
  return new ModalBuilder()
    .setCustomId('mkt2_name_modal')
    .setTitle(t(lc, 'name_modal_title'))
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('q')
          .setLabel(t(lc, 'name_modal_label'))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(50),
      ),
    );
}
function itemView(rarity, page, lc) {
  const all = catalog.itemsByCategory(rarity);
  const pages = Math.max(1, Math.ceil(all.length / 25));
  const p = Math.min(Math.max(0, page), pages - 1);
  const slice = all.slice(p * 25, p * 25 + 25);
  const sel = new StringSelectMenuBuilder()
    .setCustomId('mkt2_item')
    .setPlaceholder(t(lc, 'item_placeholder'))
    .addOptions(slice.map(optionFor));
  const nav = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('mkt2_pgprev')
      .setLabel('◀')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(p <= 0),
    new ButtonBuilder()
      .setCustomId('mkt2_pgnext')
      .setLabel('▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(p >= pages - 1),
    new ButtonBuilder()
      .setCustomId('mkt2_search_name')
      .setLabel(t(lc, 'search_fast'))
      .setEmoji('🔍')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('mkt2_backrar')
      .setLabel(t(lc, 'back_category'))
      .setStyle(ButtonStyle.Secondary),
  );
  const remain = all.length - (p + 1) * 25;
  const more = pages > 1 ? t(lc, 'more_next', { n: remain > 0 ? remain : 0 }) : '';
  return {
    content: t(lc, 'item_list_content', {
      rarity,
      total: all.length,
      p: p + 1,
      pages,
      more,
    }),
    embeds: [],
    components: [new ActionRowBuilder().addComponents(sel), nav],
  };
}

// 出品名（保存・公開される文字列なので言語中立：英語スキン名＋★＋🧬特性数）
function giveLabel(s) {
  const skin = s.skin && s.skin !== 'Default' ? ` [${s.skin}]` : '';
  const star = s.star > 0 ? ` ★${s.star}` : '';
  const trait = s.trait > 0 ? ` 🧬${s.trait}` : '';
  return `${s.candidate}${skin}${star}${trait}`;
}
// アイテム選択後の1画面（変異・★・特性は任意。選ばなくても出品可）
function itemWindow(s, lc) {
  const e = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(giveLabel(s))
    .setDescription(t(lc, 'item_window_desc'));
  const img = catalog.skinImage(s.candidate, s.skin || 'Default');
  if (img) e.setImage(img);
  if (s.want) e.addFields({ name: t(lc, 'field_want'), value: s.want });
  if (s.note) e.addFields({ name: t(lc, 'field_note'), value: s.note });
  const skinKeys = catalog.skinKeys(s.candidate);
  const skinSel = new StringSelectMenuBuilder()
    .setCustomId('mkt2_skin')
    .setPlaceholder(s.skin ? t(lc, 'skin_chosen', { x: skinLabel(lc, s.skin) }) : t(lc, 'skin_optional'))
    .addOptions(
      (skinKeys.length ? skinKeys : ['Default'])
        .slice(0, 25)
        .map((k) => ({ label: skinLabel(lc, k), value: k })),
    );
  const starSel = new StringSelectMenuBuilder()
    .setCustomId('mkt2_star')
    .setPlaceholder(s.star > 0 ? t(lc, 'star_chosen', { n: s.star }) : t(lc, 'star_optional'))
    .addOptions([
      { label: t(lc, 'star_none'), value: '0' },
      { label: '★1', value: '1' },
      { label: '★2', value: '2' },
      { label: '★3', value: '3' },
      { label: '★4', value: '4' },
      { label: t(lc, 'star_max'), value: '5' },
    ]);
  const traitSel = new StringSelectMenuBuilder()
    .setCustomId('mkt2_trait')
    .setPlaceholder(s.trait > 0 ? t(lc, 'trait_chosen', { n: s.trait }) : t(lc, 'trait_optional'))
    .addOptions([
      { label: t(lc, 'trait_none'), value: '0' },
      { label: t(lc, 'trait_n', { n: 1 }), value: '1' },
      { label: t(lc, 'trait_n', { n: 2 }), value: '2' },
      { label: t(lc, 'trait_n', { n: 3 }), value: '3' },
      { label: t(lc, 'trait_n', { n: 4 }), value: '4' },
      { label: t(lc, 'trait_n', { n: 5 }), value: '5' },
    ]);
  return {
    content: '',
    embeds: [e],
    components: [
      new ActionRowBuilder().addComponents(skinSel),
      new ActionRowBuilder().addComponents(starSel),
      new ActionRowBuilder().addComponents(traitSel),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('mkt2_post')
          .setLabel(t(lc, 'btn_post'))
          .setEmoji('🟢')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('mkt2_wantmemo')
          .setLabel(t(lc, 'btn_wantmemo'))
          .setEmoji('📝')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('mkt2_backitem')
          .setLabel(t(lc, 'btn_reselect'))
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}
function wantMemoModal(s, lc) {
  return new ModalBuilder()
    .setCustomId('mkt2_wantmemo_modal')
    .setTitle(t(lc, 'wantmemo_title'))
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('want')
          .setLabel(t(lc, 'want_label'))
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(150)
          .setValue(s?.want || ''),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('note')
          .setLabel(t(lc, 'note_label'))
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(300)
          .setValue(s?.note || ''),
      ),
    );
}
const expiredView = (lc) => ({
  content: t(lc, 'expired'),
  embeds: [],
  components: [],
});

async function startPicker(interaction, mode = 'sell') {
  pickerSessions.set(interaction.user.id, {
    mode,
    candidate: null,
    skin: null,
    star: 0,
    trait: 0,
    want: '',
    note: '',
    rarity: null,
    page: 0,
    ts: Date.now(),
  });
  await interaction.reply({
    ...rarityView(interaction.locale, mode),
    flags: MessageFlags.Ephemeral,
  });
}
async function finalizePicker(interaction, s) {
  const lc = interaction.locale;
  pickerSessions.delete(interaction.user.id);
  const give = giveLabel(s);
  const giveImg = catalog.skinImage(s.candidate, s.skin || 'Default');
  const listingId = db.addListing({
    sellerId: interaction.user.id,
    give,
    giveName: s.candidate,
    want: cleanText(s.want || ''),
    note: cleanText(s.note || ''),
  });
  db.setListingImages(listingId, giveImg, null);
  db.recordItem(s.candidate);
  const listing = db.getListing(listingId);
  // 出品カードはフィードチャンネルへ（未設定なら現在のチャンネル）。
  // → 操作チャンネルは静かなまま＝出品/探すボタンが流れず常に押せる。
  const feedId = db.getSetting('feed_channel_id');
  let target = interaction.channel;
  if (feedId && feedId !== interaction.channelId) {
    const f = await interaction.client.channels.fetch(feedId).catch(() => null);
    if (f) target = f;
  }
  const msg = await target.send({
    embeds: [listingEmbed(listing, interaction.user.tag)],
    components: [dealRow(listingId)],
    allowedMentions: NO_PING,
  });
  db.setListingMessage(listingId, msg.channelId, msg.id);
  // 旧・単一チャンネル運用の時だけパネルを貼り直す（フィード分離時は不要）
  if (!feedId && db.getSetting('panel_channel_id') === msg.channelId) {
    scheduleRepostPanel(interaction.channel);
  }
  await interaction.update({
    content: t(lc, 'posted', { id: listingId }),
    embeds: [],
    components: [],
  });
}

async function handlePicker(interaction) {
  const lc = interaction.locale;
  const s = pickerSessions.get(interaction.user.id);
  if (s) s.ts = Date.now(); // セッション最終操作時刻（メモリ掃除の判定用）
  if (interaction.isStringSelectMenu()) {
    if (!s) return interaction.update(expiredView(lc));
    switch (interaction.customId) {
      case 'mkt2_rar':
        s.rarity = interaction.values[0];
        s.page = 0;
        return interaction.update(itemView(s.rarity, 0, lc));
      case 'mkt2_item':
        if (s.mode === 'search') return showSearchResults(interaction, interaction.values[0]);
        s.candidate = interaction.values[0];
        s.skin = null;
        s.star = 0;
        s.trait = 0;
        return interaction.update(itemWindow(s, lc));
      case 'mkt2_skin':
        s.skin = interaction.values[0];
        return interaction.update(itemWindow(s, lc));
      case 'mkt2_star':
        s.star = Number(interaction.values[0]) || 0;
        return interaction.update(itemWindow(s, lc));
      case 'mkt2_trait':
        s.trait = Number(interaction.values[0]) || 0;
        return interaction.update(itemWindow(s, lc));
      default:
        return false;
    }
  }
  if (interaction.isButton() && interaction.customId.startsWith('mkt2_')) {
    if (!s) {
      await interaction.update(expiredView(lc));
      return true;
    }
    switch (interaction.customId) {
      case 'mkt2_pgprev':
        s.page = Math.max(0, (s.page || 0) - 1);
        await interaction.update(itemView(s.rarity, s.page, lc));
        return true;
      case 'mkt2_pgnext':
        s.page = (s.page || 0) + 1;
        await interaction.update(itemView(s.rarity, s.page, lc));
        return true;
      case 'mkt2_backrar':
        await interaction.update(rarityView(lc, s.mode));
        return true;
      case 'mkt2_backitem':
        await interaction.update(itemView(s.rarity, s.page || 0, lc));
        return true;
      case 'mkt2_search_name':
        await interaction.showModal(nameSearchModal(lc));
        return true;
      case 'mkt2_wantmemo':
        await interaction.showModal(wantMemoModal(s, lc));
        return true;
      case 'mkt2_post': {
        if (!s.candidate) {
          await interaction.reply({ content: t(lc, 'need_give'), flags: MessageFlags.Ephemeral });
          return true;
        }
        const uid = interaction.user.id;
        if (db.listByUser(uid).length >= LIMITS.maxActiveListings) {
          await interaction.reply({
            ...myListingsPayload(
              uid,
              interaction.user.tag,
              lc,
              t(lc, 'cap_listing', { n: LIMITS.maxActiveListings }),
            ),
            flags: MessageFlags.Ephemeral,
          });
          return true;
        }
        if (!rateOk('listing', uid, LIMITS.listingsPerMin)) {
          await interaction.reply({ content: t(lc, 'rl_listing'), flags: MessageFlags.Ephemeral });
          return true;
        }
        await finalizePicker(interaction, s);
        return true;
      }
      default:
        return false;
    }
  }
  if (interaction.isModalSubmit()) {
    if (interaction.customId === 'mkt2_name_modal') {
      if (!s) return interaction.update(expiredView(lc));
      const names = catalog.suggestNames(interaction.fields.getTextInputValue('q'), 25);
      await interaction.update(searchResultView(names, lc));
      return true;
    }
    if (interaction.customId === 'mkt2_wantmemo_modal') {
      if (!s) return interaction.update(expiredView(lc));
      const want = interaction.fields.getTextInputValue('want');
      const note = interaction.fields.getTextInputValue('note');
      const issue = contentIssue(want) || contentIssue(note);
      if (issue) {
        await interaction.reply({
          content: t(lc, issue === 'url' ? 'bad_url' : 'bad_word'),
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }
      s.want = cleanText(want);
      s.note = cleanText(note);
      await interaction.update(itemWindow(s, lc));
      return true;
    }
    return false;
  }
  return false;
}

// ===== 総合ハンドラ =====
export async function handleMarketplaceInteraction(interaction) {
  // 検索結果のプルダウンから取引相手を選ぶ
  if (interaction.isStringSelectMenu() && interaction.customId === 'mkt_pick_deal') {
    const listing = db.getListing(Number(interaction.values[0]));
    if (!listing) {
      await interaction.reply({
        content: t(interaction.locale, 'listing_not_found'),
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }
    await startMatch(interaction, listing);
    return true;
  }
  if (
    interaction.isStringSelectMenu() ||
    (interaction.isButton() && interaction.customId.startsWith('mkt2_')) ||
    (interaction.isModalSubmit() && interaction.customId.startsWith('mkt2_'))
  ) {
    return handlePicker(interaction);
  }

  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'パネル設置') {
      const msg = await interaction.channel.send(buildPanel());
      db.setSetting('panel_channel_id', msg.channelId);
      db.setSetting('panel_message_id', msg.id);
      await interaction.reply({
        content: t(interaction.locale, 'panel_set'),
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }
    if (interaction.commandName === 'フィード設置') {
      db.setSetting('feed_channel_id', interaction.channelId);
      await interaction.reply({
        content: t(interaction.locale, 'feed_set'),
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }
    return false;
  }

  if (interaction.isButton()) {
    const id = interaction.customId;
    if (id === 'mkt_create') {
      await startPicker(interaction);
      return true;
    }
    if (id === 'mkt_search') {
      await startPicker(interaction, 'search');
      return true;
    }
    if (id === 'mkt_mine') {
      await replyMyListings(interaction);
      return true;
    }
    if (id === 'mkt_rank') {
      await replyRanking(interaction);
      return true;
    }
    if (id.startsWith('mkt_deal_')) {
      const listing = db.getListing(Number(id.slice('mkt_deal_'.length)));
      if (!listing) {
        await interaction.reply({
          content: t(interaction.locale, 'listing_not_found'),
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }
      await startMatch(interaction, listing);
      return true;
    }
    if (id.startsWith('mkt_done_')) {
      await closeListing(interaction, Number(id.slice('mkt_done_'.length)), true);
      return true;
    }
    if (id.startsWith('mkt_close_')) {
      await closeListing(interaction, Number(id.slice('mkt_close_'.length)), false);
      return true;
    }
    if (id.startsWith('mkt_leave_')) {
      await leaveRoom(interaction, Number(id.slice('mkt_leave_'.length)));
      return true;
    }
    if (id.startsWith('mkt_relist_')) {
      await relistListing(interaction, Number(id.slice('mkt_relist_'.length)));
      return true;
    }
    return false;
  }

  return false;
}

// 取引ルームから退出（間違えて入った人向け。出品者は退出不可）
async function leaveRoom(interaction, listingId) {
  const lc = interaction.locale;
  const listing = db.getListing(listingId);
  if (listing && listing.seller_id === interaction.user.id) {
    await interaction.reply({ content: t(lc, 'seller_cant_leave'), flags: MessageFlags.Ephemeral });
    return;
  }
  try {
    if (interaction.channel?.isThread?.()) {
      await interaction.channel.members.remove(interaction.user.id).catch(() => {});
    }
    db.removeRoomMember(listingId, interaction.user.id);
  } catch (e) {
    console.error('退出失敗:', e);
  }
  await interaction.reply({ content: t(lc, 'left_room'), flags: MessageFlags.Ephemeral });
}

// 同じ条件で再出品（不在で時間切れした出品者向け。元を失効させ新カードを最新に出す）
async function relistListing(interaction, oldId) {
  const lc = interaction.locale;
  const old = db.getListing(oldId);
  if (!old) {
    await interaction.reply({ content: t(lc, 'relist_fail'), flags: MessageFlags.Ephemeral });
    return;
  }
  if (old.seller_id !== interaction.user.id) {
    await interaction.reply({ content: t(lc, 'relist_not_yours'), flags: MessageFlags.Ephemeral });
    return;
  }
  const feedId = db.getSetting('feed_channel_id');
  const ch = feedId ? await interaction.client.channels.fetch(feedId).catch(() => null) : null;
  if (!ch) {
    await interaction.reply({ content: t(lc, 'relist_fail'), flags: MessageFlags.Ephemeral });
    return;
  }
  // 元を失効＋古いカード削除
  db.setStatus(oldId, 'expired');
  if (old.channel_id && old.message_id) {
    const oc = await interaction.client.channels.fetch(old.channel_id).catch(() => null);
    await oc?.messages?.delete(old.message_id).catch(() => {});
  }
  // 同条件で新規作成
  const newId = db.addListing({
    sellerId: old.seller_id,
    give: old.give_item,
    giveName: old.give_name,
    want: old.want_item,
    note: old.note,
  });
  db.setListingImages(newId, old.give_img, old.want_img);
  if (old.give_name) db.recordItem(old.give_name);
  const listing = db.getListing(newId);
  const msg = await ch.send({
    embeds: [listingEmbed(listing, interaction.user.tag)],
    components: [dealRow(newId)],
    allowedMentions: NO_PING,
  });
  db.setListingMessage(newId, msg.channelId, msg.id);
  await interaction.reply({
    content: t(lc, 'relisted', { id: newId }),
    flags: MessageFlags.Ephemeral,
  });
}

// 閉鎖時に参加者へDM通知（スレッドは消えるので外から知らせる）
async function notifyRoomClosed(client, thread, room) {
  try {
    const listing = db.getListing(room.listing_id);
    const item = listing ? listing.give_item : '取引 / trade';
    const sellerId = listing ? listing.seller_id : null;
    // 参加者は自前DBから取得（GuildMembersインテント無しでも確実に届く）
    const ids = new Set(db.getRoomMembers(room.listing_id));
    if (sellerId) ids.add(sellerId);
    ids.delete(client.user.id);
    const buyerMsg =
      `⌛ 取引ルーム「**${item}**」は無反応のため自動で閉じたよ。タイミングが合わなかったかも。また「🔍探す」から試してね。\n` +
      `⌛ The trade room for “**${item}**” closed due to inactivity. Try again from “🔍 Find”.`;
    const sellerMsg =
      `⌛ あなたの出品「**${item}**」で取引ルームが立ったけど、**会話が無いまま時間切れ**で閉じたよ（相手とタイミングが合わなかったみたい）。\n` +
      `🔁 下のボタンで**同じ条件のまま再出品**できる（出品リストの最新に出る）。\n` +
      `⌛ A trade room for your listing “**${item}**” closed with no conversation. Tap below to **re-list with the same details**.`;
    for (const id of ids) {
      const u = await client.users.fetch(id).catch(() => null);
      if (!u) continue;
      if (sellerId && id === sellerId && listing) {
        await u
          .send({ content: sellerMsg, components: [relistRow(listing.id)] })
          .catch(() => {});
      } else {
        await u.send(buyerMsg).catch(() => {});
      }
    }
  } catch (e) {
    console.error('閉鎖通知失敗:', e);
  }
}

// メモリ掃除（放置セッション・レート記録）
function pruneMemory(now) {
  for (const [uid, s] of pickerSessions) {
    if (now - (s.ts || 0) > 15 * 60 * 1000) pickerSessions.delete(uid);
  }
  cleanupBuckets();
}

// ===== 取引ルームの「無反応1時間」自動クローズ＋通知 =====
export function startRoomExpiryLoop(client) {
  setInterval(async () => {
    const now = Date.now();
    for (const r of db.allRooms()) {
      const thread = await client.channels.fetch(r.thread_id).catch(() => null);
      if (!thread) {
        db.deleteRoom(r.listing_id);
        continue;
      }
      const lastActive = r.last_active || r.created_at;
      const idle = now - lastActive;
      const age = now - r.created_at;
      if (idle >= ROOM_IDLE_TTL || age >= ROOM_HARD_MAX) {
        await notifyRoomClosed(client, thread, r);
        await thread.delete().catch(() => {});
        db.deleteRoom(r.listing_id);
      } else if (idle >= ROOM_WARN && !r.warned) {
        const listing = db.getListing(r.listing_id);
        const ping = listing ? `<@${listing.seller_id}>` : '';
        await thread
          .send(
            `⏰ 10分会話がないよ。**あと約5分で自動削除**！続けるならメッセージしてね。/ ` +
              `No chat for 10 min — **auto-deletes in ~5 min**. Send a message to keep it open! ${ping}`,
          )
          .catch(() => {});
        db.markRoomWarned(r.listing_id);
      }
    }
    // 出品の7日失効：放置（取引されなかった）出品を expired にしてカードを消す
    try {
      const expired = db.expireOld(LISTING_TTL);
      for (const l of expired) {
        if (l.channel_id && l.message_id) {
          const ch = await client.channels.fetch(l.channel_id).catch(() => null);
          await ch?.messages?.delete(l.message_id).catch(() => {});
        }
      }
    } catch (e) {
      console.error('出品失効失敗:', e);
    }
    // 掃除：メモリ＋古い行（7日より前の closed/expired をDBから物理削除）
    pruneMemory(now);
    try {
      db.pruneOldListings(7 * 24 * 60 * 60 * 1000);
    } catch (e) {
      console.error('出品プルーニング失敗:', e);
    }
  }, 5 * 60 * 1000);
}

// 起動時：削除済みカスタム絵文字をDBから除去（選択メニューが壊れるのを防ぐ）
export async function syncEmojisAcrossGuilds(client) {
  try {
    const have = new Set();
    for (const g of client.guilds.cache.values()) {
      const em = await g.emojis.fetch().catch(() => null);
      if (em) for (const e of em.values()) have.add(e.id);
    }
    if (!have.size) return; // 取得失敗時は何もしない（消しすぎ防止）
    let pruned = 0;
    for (const row of db.allEmojis()) {
      if (!have.has(row.emoji_id)) {
        db.deleteEmoji(row.name);
        pruned++;
      }
    }
    if (pruned) console.log(`🧹 絵文字DB整合: ${pruned}件除去（削除済み）`);
  } catch (e) {
    console.error('絵文字同期失敗:', e);
  }
}

// ===== スティッキー =====
const stickyTimers = new Map();
function scheduleRepostPanel(channel) {
  const k = channel.id;
  if (stickyTimers.has(k)) clearTimeout(stickyTimers.get(k));
  stickyTimers.set(k, setTimeout(() => repostPanel(channel), 1500));
}
export function maybeRepostSticky(message) {
  if (message.author?.bot) return;
  const chId = db.getSetting('panel_channel_id');
  if (chId && message.channelId === chId) scheduleRepostPanel(message.channel);
}
async function repostPanel(channel) {
  try {
    const oldId = db.getSetting('panel_message_id');
    if (oldId) {
      const old = await channel.messages.fetch(oldId).catch(() => null);
      if (old) await old.delete().catch(() => {});
    }
    const msg = await channel.send(buildPanel());
    db.setSetting('panel_message_id', msg.id);
  } catch (e) {
    console.error('スティッキー貼り直し失敗:', e);
  }
}

const threadStickyTimers = new Map();
export function maybeRepostThreadControl(message) {
  if (message.author?.bot) return;
  const room = db.getRoomByThread(message.channelId);
  if (!room) return;
  db.touchRoom(message.channelId); // 人の発言で活動時刻を更新（無反応クローズの延長）
  const k = message.channelId;
  if (threadStickyTimers.has(k)) clearTimeout(threadStickyTimers.get(k));
  threadStickyTimers.set(k, setTimeout(() => repostThreadControl(message.channel), 1500));
}
async function repostThreadControl(thread) {
  try {
    const room = db.getRoomByThread(thread.id);
    if (!room) return;
    if (room.control_msg_id) {
      const old = await thread.messages.fetch(room.control_msg_id).catch(() => null);
      if (old) await old.delete().catch(() => {});
    }
    const msg = await thread.send({
      content:
        '👇 出品者は終わったら「✅取引完了」、間違えて入った人は「🚪退出」/ ' +
        'Seller: ✅ Done when finished. Wrong room? 🚪 Leave',
      components: [doneRow(room.listing_id)],
    });
    db.setRoomControl(room.listing_id, msg.id);
  } catch (e) {
    console.error('取引完了ボタン貼り直し失敗:', e);
  }
}
