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
import { closeThreadSoon } from './threads.js';

const COLOR = 0x57f287;
// 取引ルーム：無反応5分で警告（残り時間表示＋ホストPing）→計10分で削除＆自動再出品。
const ROOM_WARN = 5 * 60 * 1000; // 5分無反応で「あと約5分で削除」警告＋ホストPing
const ROOM_IDLE_TTL = 10 * 60 * 1000; // 10分無反応で削除（＋自動再出品）
const ROOM_HARD_MAX = 24 * 60 * 60 * 1000; // 活動があっても24hで強制終了（保険）
const LISTING_TTL = 7 * 24 * 60 * 60 * 1000; // 出品は7日で自動失効
const WEEK = 7 * 24 * 60 * 60 * 1000; // 🔥バッジ・📊ランキングの需要集計に使う窓（据え置き）
const DAY = 24 * 60 * 60 * 1000; // 📰デイリーニュースの投稿間隔＆集計窓
const WATCH_MAX = 5; // 📌ウォッチは1人5件まで
const WATCH_TTL = 14 * 24 * 60 * 60 * 1000; // 放置ウォッチは14日で自動解除
const MATCH_DEDUP_TTL = 6 * 60 * 60 * 1000; // 同じ2人への💞マッチ通知は6hに1回まで
const HOT_DEMAND_MIN = 3; // 🔥バッジ：直近7日の需要がこれ以上 かつ 供給の2倍以上
const RELIST_STRIKE_MAX = 5; // 出品者の不在（自動再出品）がこの回数に達したら自動取り下げ
const DONE_REMIND_EVERY = 50 * 1000; // 片方✅済みの間、押してない側へ毎分リマインド（掃除は60秒周期なので50秒判定＝毎回発火）
const DONE_PENDING_MAX = 30 * 60 * 1000; // 確認待ちは最初の✅から30分まで。過ぎたら通常の無反応クローズに戻す
// 取引ルームの常設注意（日英併記・ピン留め）。子供が読めるよう最小限に絞る
const SCAM_NOTICE =
  '⚠️ 取引は**自己責任** / Trade at your own risk\n' +
  '🚫 **クロストレード・先払い・DM誘導 ＝ 詐欺！** / Cross-trading, pay-first & DM lures = SCAM\n' +
  '✅ 終わったら**2人とも「取引完了」**を押す / **BOTH** press Done when finished\n' +
  '⏰ 10分無言で自動クローズ / Auto-closes after 10 min of silence';
// 取引完了ボタンの説明（作成時＆スティッキー貼り直しで共用・1行）
const CONTROL_HINT =
  '👇 終わったら**2人とも**「✅取引完了」（両方押すと実績にカウント）・間違えたら「🚪退出」\n' +
  '**BOTH** press ✅ Done when finished (counts for both) — wrong room? 🚪 Leave';
// 出品者が退出＝この取引はナシ。部屋を解散する時に流すお知らせ
const SELLER_LEFT_NOTICE =
  '🚪 出品者がこの取引から抜けたので、この部屋は閉じるね（出品はリストに残ってるよ）\n' +
  'The seller left this trade — closing this room. The listing stays in the feed.';
// 取引ルーム同時生成のレース防止（単一プロセス内ロック）。値＝ロックした時刻。
// 時刻で持つのは、万一解放し損ねた時に一定時間で自然に無効化するため。
// （Setで持っていた頃、解放漏れでその出品が永久に「作成中」になり押せなくなる事故があった）
const creatingRooms = new Map();
const ROOM_LOCK_MS = 30_000; // これを過ぎたロックは死んだものとして無視する
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
  // 戦闘力：base と ★5最大（実機の★5戦闘倍率=2.8）。濃縮の伸びしろが分かる。
  if (m.attack != null) parts.push(`⚔️ ${m.attack}（★5→${Math.floor(m.attack * 2.8)}）`);
  if (m.rarity) parts.push(`💎 ${m.rarity}`);
  if (m.price) parts.push(`💰 ${m.price}`);
  if (m.production) parts.push(`🏭 ${m.production}`);
  return parts.length ? parts.join('　') : null;
}

export const marketplaceCommands = [
  new SlashCommandBuilder()
    .setName('パネル設置')
    .setDescription('【運営用】このチャンネルに操作パネルを設置（言語ごとに複数設置OK）')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((o) =>
      o
        .setName('フィード')
        .setDescription('このパネルからの出品カードを流すチャンネル（省略時は既定のフィード）')
        .addChannelTypes(ChannelType.GuildText),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName('フィード設置')
    .setDescription('【運営用】出品カードをこのチャンネルに流す（出品フィード）')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),
  new SlashCommandBuilder()
    .setName('図鑑リロード')
    .setDescription('【運営用】図鑑(characters.json)を再読込（bot再起動なしで新キャラ反映）')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),
  new SlashCommandBuilder()
    .setName('日報設置')
    .setDescription('【運営用】デイリーマーケットニュースをこのチャンネルに自動投稿（毎日）')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),
  new SlashCommandBuilder()
    .setName('実績ロール設定')
    .setDescription('【運営用】取引成立◯回で自動付与するロールを設定')
    .addRoleOption((o) =>
      o.setName('ロール').setDescription('付与するロール（Botのロールより下に置く）').setRequired(true),
    )
    .addIntegerOption((o) =>
      o.setName('回数').setDescription('必要な取引成立回数').setMinValue(1).setRequired(true),
    )
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
        '※ 1出品=1ルーム・取引成立は**2人とも✅** / 1 room per listing・**BOTH** press ✅ to complete.',
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
// 🔥需要バッジ：直近7日でよく探されてる割に出品が少ないアイテムに付ける（出品促進）
function hotSuffix(name) {
  if (!name) return '';
  try {
    const demand = db.demandCount(name, WEEK);
    if (demand >= HOT_DEMAND_MIN && demand >= db.countActiveByName(name) * 2) {
      return ' 🔥人気/HOT';
    }
  } catch {
    /* バッジは飾りなので失敗しても出品は止めない */
  }
  return '';
}
// 出品者フッター（✅取引実績つき＝信頼の可視化・詐欺抑止）
function sellerFooter(listing, sellerTag) {
  const tag = listing.seller_tag || sellerTag || '?';
  const n = listing.seller_id ? db.tradesOf(listing.seller_id) : 0;
  const foot = {
    text: `出品者 / Seller: ${tag}${n > 0 ? `　✅取引実績 ${n}回 / ${n} trade(s)` : ''}`,
  };
  if (listing.seller_avatar) foot.iconURL = listing.seller_avatar;
  return foot;
}
function listingEmbed(listing, sellerTag) {
  const e = new EmbedBuilder()
    .setColor(COLOR)
    .setAuthor({ name: `出品 / Listing #${listing.id}${hotSuffix(listing.give_name)}` })
    .addFields({ name: F_GIVE, value: listing.give_item });
  if (listing.want_item) e.addFields({ name: F_WANT, value: listing.want_item });
  if (listing.note) e.addFields({ name: F_NOTE, value: listing.note });
  const stats = statsLine(listing.give_name);
  if (stats) e.addFields({ name: F_STATS, value: stats });
  if (listing.give_img) e.setImage(listing.give_img);
  if (listing.want_img) e.setThumbnail(listing.want_img);
  e.setFooter(sellerFooter(listing, sellerTag));
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
      .setLabel('取引完了 / Done')
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

// パネル→フィードの解決。パネル固有の設定 → 既定フィード の順（日本語版/英語版で別フィードにできる）
function feedIdFor(panelChannelId) {
  const p = panelChannelId ? db.getMarketPanel(panelChannelId) : null;
  return p?.feed_channel_id || db.getSetting('feed_channel_id') || null;
}
// その出品のカードが載っているチャンネル（＝出品者が使った言語のフィード）を優先して返す。
// 取引ルーム・再出品・各種告知を「元と同じ場所」に出すために使う。
async function channelForListing(client, listing) {
  if (listing?.channel_id) {
    const ch = await client.channels.fetch(listing.channel_id).catch(() => null);
    if (ch) return ch;
  }
  const fid = db.getSetting('feed_channel_id');
  return fid ? await client.channels.fetch(fid).catch(() => null) : null;
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
  // 取引ルームは「そのカードが載っているフィード」側に作る
  // → 操作チャンネルにスレッドが立たない＝パネルが流れない。日本語版/英語版それぞれの場所に立つ。
  let parent = await channelForListing(interaction.client, listing);
  if (!parent) {
    parent = interaction.channel;
    if (parent?.isThread()) parent = parent.parent;
  }
  if (!parent || parent.type !== ChannelType.GuildText) {
    return interaction.reply({ content: t(lc, 'cant_make_room'), flags: MessageFlags.Ephemeral });
  }
  if (!rateOk('room', user.id, LIMITS.roomsPerMin)) {
    return interaction.reply({ content: t(lc, 'rl_room'), flags: MessageFlags.Ephemeral });
  }
  // 二重生成レース防止：同じ出品を同時に処理させない
  const lockedAt = creatingRooms.get(listing.id);
  if (lockedAt && Date.now() - lockedAt < ROOM_LOCK_MS) {
    return interaction.reply({ content: t(lc, 'room_busy'), flags: MessageFlags.Ephemeral });
  }
  creatingRooms.set(listing.id, Date.now());
  try {
    // deferReply も必ず try の中で。ここで失敗（3秒超過でinteraction期限切れ等）しても
    // finally でロックを解放するため。外に置くと解放漏れ＝その出品が永久ロックになる。
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
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
      autoArchiveDuration: 60, // Bot停止中の保険: Discord自身が無活動1hでアーカイブ＝枠を返す
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
      content: CONTROL_HINT,
      components: [doneRow(listing.id)],
    });
    db.setRoomControl(listing.id, ctrl.id);
    await interaction.editReply(t(lc, 'room_created', { thread }));
  } catch (err) {
    console.error('ルーム作成失敗:', err);
    if (err?.rawError?.errors) {
      console.error('ルーム作成 50035詳細:', JSON.stringify(err.rawError.errors));
    }
    // deferReply 自体が失敗している場合は editReply も必ず失敗するので、送れる時だけ返す
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(t(lc, 'room_fail')).catch(() => {});
    }
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
    if (thread) closeThreadSoon(thread, 4000);
  }
}

// ===== 取引完了（両者✅方式）=====
// 出品者＋相手の両方が✅を押して初めて成立 → trades に実績記録。
// 片方の一存で「完了」にならないので、実績の水増し・渡す前クローズ事故を防ぐ。
async function handleDone(interaction, listingId) {
  const lc = interaction.locale;
  const listing = db.getListing(listingId);
  if (!listing) {
    return interaction.reply({ content: t(lc, 'listing_not_found'), flags: MessageFlags.Ephemeral });
  }
  if (listing.status !== 'active') {
    return interaction.reply({ content: t(lc, 'listing_ended'), flags: MessageFlags.Ephemeral });
  }
  const room = db.getRoom(listingId);
  if (!room) {
    // ルーム記録なし（古いメッセージ等）→ 従来どおり出品者のみ即クローズ（実績記録なし）
    return closeListing(interaction, listingId, true);
  }
  db.touchRoom(room.thread_id); // ✅操作も活動扱い＝確認待ちの間に無反応クローズさせない
  const uid = interaction.user.id;
  if (uid === listing.seller_id) {
    if (room.done_buyer_id) return finalizeTrade(interaction, listing, room.done_buyer_id);
    if (room.done_seller) {
      return interaction.reply({ content: t(lc, 'done_already'), flags: MessageFlags.Ephemeral });
    }
    db.setRoomDoneSeller(listingId);
    db.setRoomDoneAt(listingId, Date.now()); // 確認待ち30分タイマーの起点
    db.setRoomRemind(listingId, Date.now()); // いま告知するので次のリマインドは約1分後から
    const partners = db.getRoomMembers(listingId).filter((id) => id !== listing.seller_id);
    await interaction.reply({ content: t(lc, 'done_wait_partner'), flags: MessageFlags.Ephemeral });
    await interaction.channel
      ?.send({
        content:
          `✅ 出品者が押したよ！${partners.map((id) => `<@${id}>`).join(' ')} **キミも✅を押すと成立**（両方押さないと実績にカウントされないよ）\n` +
          '✅ Seller pressed Done! **Press ✅ too** — it only counts when BOTH press!',
        allowedMentions: { users: partners.slice(0, 5) },
      })
      .catch(() => {});
  } else {
    if (room.done_seller) return finalizeTrade(interaction, listing, uid);
    if (room.done_buyer_id === uid) {
      return interaction.reply({ content: t(lc, 'done_already'), flags: MessageFlags.Ephemeral });
    }
    db.setRoomDoneBuyer(listingId, uid);
    db.setRoomDoneAt(listingId, Date.now()); // 確認待ち30分タイマーの起点
    db.setRoomRemind(listingId, Date.now());
    await interaction.reply({ content: t(lc, 'done_wait_partner'), flags: MessageFlags.Ephemeral });
    await interaction.channel
      ?.send({
        content:
          `✅ <@${uid}> が押したよ！<@${listing.seller_id}> **キミも✅を押すと成立**（両方押さないと実績にカウントされないよ）\n` +
          '✅ Partner pressed Done! **Seller: press ✅ too** — it only counts when BOTH press!',
        allowedMentions: { users: [listing.seller_id] },
      })
      .catch(() => {});
  }
}

// 成立処理：実績記録 → 出品クローズ＆カード削除 → 🎉アナウンス → 実績ロール → ルーム片付け
async function finalizeTrade(interaction, listing, buyerId) {
  const lc = interaction.locale;
  db.addTrade({
    listingId: listing.id,
    sellerId: listing.seller_id,
    buyerId,
    give: listing.give_item,
    giveName: listing.give_name,
    want: listing.want_item,
  });
  db.setStatus(listing.id, 'closed');
  if (listing.channel_id && listing.message_id) {
    const ch = await interaction.client.channels.fetch(listing.channel_id).catch(() => null);
    await ch?.messages?.delete(listing.message_id).catch(() => {});
  }
  await interaction.reply({ content: t(lc, 'deal_done'), flags: MessageFlags.Ephemeral });
  // 実績カウント＋ロールまでの残り回数を見せる（集めたくなる仕掛け）
  const ns = db.tradesOf(listing.seller_id);
  const nb = db.tradesOf(buyerId);
  const roleMin = Number(db.getSetting('trader_role_min') || 0);
  let roleLine = '';
  if (db.getSetting('trader_role_id') && roleMin && (ns < roleMin || nb < roleMin)) {
    roleLine = `\n🏅 ${roleMin}回で実績ロールGET！ / Reach ${roleMin} trades for the role!`;
  }
  await interaction.channel
    ?.send({
      content:
        `🎉 **取引成立！ / Trade complete!**\n` +
        `✅ 実績 / Trades: <@${listing.seller_id}> **${ns}回** ・ <@${buyerId}> **${nb}回**${roleLine}`,
      allowedMentions: NO_PING,
    })
    .catch(() => {});
  await grantTraderRole(interaction.guild, listing.seller_id);
  await grantTraderRole(interaction.guild, buyerId);
  const room = db.getRoom(listing.id);
  if (room) {
    db.deleteRoom(listing.id);
    const thread = await interaction.client.channels.fetch(room.thread_id).catch(() => null);
    if (thread) closeThreadSoon(thread, 5000);
  }
}

// 実績ロール：/実績ロール設定 で決めた回数に達したら自動付与（未設定なら何もしない）
async function grantTraderRole(guild, userId) {
  try {
    const roleId = db.getSetting('trader_role_id');
    const min = Number(db.getSetting('trader_role_min') || 0);
    if (!guild || !roleId || !min) return;
    if (db.tradesOf(userId) < min) return;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member && !member.roles.cache.has(roleId)) {
      await member.roles.add(roleId, `取引実績${min}回達成 / trade milestone`).catch((e) => {
        console.error('実績ロール付与失敗（Botロールの位置/権限を確認）:', e.message);
      });
    }
  } catch (e) {
    console.error('実績ロール処理失敗:', e);
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
    .setAuthor({ name: `出品 / Listing #${listing.id}${hotSuffix(listing.give_name)}` })
    .addFields({ name: F_GIVE, value: listing.give_item });
  if (listing.want_item) e.addFields({ name: F_WANT, value: listing.want_item });
  if (listing.note) e.addFields({ name: F_NOTE, value: listing.note });
  const stats = statsLine(listing.give_name);
  if (stats) e.addFields({ name: F_STATS, value: stats });
  if (listing.give_img) e.setThumbnail(listing.give_img);
  e.setFooter(sellerFooter(listing));
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
// 📌 出品されたら通知（検索空振り→通知予約に変換する）
function watchRow(lc) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('mkt2_watch')
      .setLabel(t(lc, 'watch_button'))
      .setEmoji('📌')
      .setStyle(ButtonStyle.Primary),
  );
}
async function showSearchResults(interaction, name) {
  const lc = interaction.locale;
  db.recordWant(name, interaction.user.id); // 需要として記録（ユーザー単位ユニーク）
  const session = pickerSessions.get(interaction.user.id);
  if (session) session.lastSearch = name; // 📌ウォッチ登録用に検索対象を覚えておく
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
      components: [watchRow(lc)],
    });
  }
  return interaction.update({
    content: header,
    embeds: list.map((l) => resultEmbed(l, lc)),
    components: [dealSelect(list, lc)],
  });
}
// 逆引き：相手の「ほしいもの(want)」をキーワード検索して、その出品者を表示
async function showWantResults(interaction, kw) {
  const lc = interaction.locale;
  const list = kw ? db.searchByWant(kw, 10) : [];
  if (!list.length) {
    return interaction.update({
      content: t(lc, 'want_no_match', { kw }),
      embeds: [],
      components: [],
    });
  }
  return interaction.update({
    content: t(lc, 'want_results', { kw, n: list.length }),
    embeds: list.map((l) => resultEmbed(l, lc)),
    components: [dealSelect(list, lc)],
  });
}
// 人気ランキング（供給＝出品の多い物／需要＝直近7日で探された多い物＝鮮度重視）
async function replyRanking(interaction) {
  const lc = interaction.locale;
  const sup = db.topSupply(10);
  const dem = db.topWants(10, WEEK);
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
// デイリーマーケットニュース（共有・日英併記）。/日報設置 したチャンネルに毎日自動投稿
function buildNewsPayload() {
  const sup = db.topSupply(5);
  const dem = db.topWants(5, DAY);
  const trades = db.tradesSince(DAY);
  const newListings = db.countListingsSince(DAY);
  const totalActive = db.countActive();
  const fmt = (rows) =>
    rows.length
      ? rows.map((r, i) => `**${i + 1}.** ${emojiMention(r.name)} ${r.name} ×${r.c}`).join('\n')
      : '（データなし / no data）';
  const e = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle('📰 デイリーマーケットニュース / Daily Market News')
    .setDescription(
      `🛒 いまの出品総数 **${totalActive}** 件｜今日の新規 **${newListings}** 件・成立した取引 **${trades}** 件\n` +
        `🛒 **${totalActive}** active listings｜today: **${newListings}** new, **${trades}** trades completed`,
    )
    .addFields(
      { name: '⬆️ よく出品されてる / Most listed', value: fmt(sup), inline: true },
      { name: '🔥 よく探されてる / Most wanted (24h)', value: fmt(dem), inline: true },
    )
    .setFooter({
      text: '🛒マーケットパネルの「出品/探す」から参加してね！ / Join from the market panel!',
    });
  return { embeds: [e] };
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
// 逆引き：相手の「ほしいもの」で探すボタン（自分が持ってる物の出し先を見つける）
function wantSearchRow(lc) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('mkt2_want_search')
      .setLabel(t(lc, 'want_search'))
      .setEmoji('💱')
      .setStyle(ButtonStyle.Secondary),
  );
}
function rarityView(lc, mode = 'sell') {
  const components = [rarityRow(lc), searchRow(lc)];
  if (mode === 'search') components.push(wantSearchRow(lc));
  return {
    content: mode === 'search' ? t(lc, 'search_pick_category') : t(lc, 'pick_category'),
    embeds: [],
    components,
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
function wantSearchModal(lc) {
  return new ModalBuilder()
    .setCustomId('mkt2_want_modal')
    .setTitle(t(lc, 'want_modal_title'))
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('q')
          .setLabel(t(lc, 'want_modal_label'))
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(50),
      ),
    );
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
  // 空カテゴリ（古いパネルのラベル・図鑑リロード直後など）で空のセレクトを組むと
  // Discord APIの50035 (options 1-25制約) になるためガード
  if (!all.length) {
    return {
      content: t(lc, 'no_match'),
      embeds: [],
      components: [rarityRow(lc), searchRow(lc)],
    };
  }
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
    panelCh: interaction.channelId, // どの言語のパネルから来たか＝カードを流すフィードの決定に使う
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
    sellerTag: interaction.user.tag,
    sellerAvatar: interaction.user.displayAvatarURL(),
  });
  db.setListingImages(listingId, giveImg, null);
  db.recordItem(s.candidate);
  const listing = db.getListing(listingId);
  // 出品カードは「押されたパネルに紐づくフィード」へ（未設定なら現在のチャンネル）。
  // → 操作チャンネルは静かなまま＝出品/探すボタンが流れず常に押せる。言語ごとのフィードに振り分く。
  const feedId = feedIdFor(s.panelCh);
  let target = interaction.channel;
  if (feedId && feedId !== interaction.channelId) {
    const f = await interaction.client.channels.fetch(feedId).catch(() => null);
    if (f) target = f;
  }
  let msg;
  try {
    msg = await target.send({
      embeds: [listingEmbed(listing, interaction.user.tag)],
      components: [dealRow(listingId)],
      allowedMentions: NO_PING,
    });
  } catch (err) {
    // カードが出せなかった出品はDBに残さない（見えない孤児出品の防止）
    console.error('出品カード送信失敗:', err);
    db.setStatus(listingId, 'closed');
    await interaction.update({ content: t(lc, 'post_fail'), embeds: [], components: [] });
    return;
  }
  db.setListingMessage(listingId, msg.channelId, msg.id);
  // 旧・単一チャンネル運用の時だけパネルを貼り直す（フィード分離時は不要）
  if (!feedId && db.isMarketPanelChannel(msg.channelId)) {
    scheduleRepostPanel(interaction.channel);
  }
  await interaction.update({
    content: t(lc, 'posted', { id: listingId }),
    embeds: [],
    components: [],
  });
  // 応答を返した後で📌ウォッチ通知＆💞自動マッチング（重くても操作をブロックしない）
  afterListingPosted(interaction.client, db.getListing(listingId)).catch((e) =>
    console.error('出品後通知失敗:', e),
  );
}

// ===== 出品後フック：📌ウォッチ通知 ＆ 💞自動マッチング =====
// どちらも「探す手間をゼロにする」仕掛け。通知はDMではなくフィードへ（DM拒否勢にも届く）
const notifiedPairs = new Map(); // `sellerA:sellerB`（ソート済）→ 最終通知時刻
async function afterListingPosted(client, listing) {
  if (!listing || listing.status !== 'active') return;
  const ch = await channelForListing(client, listing); // その出品が載ったフィードで通知する
  if (!ch) return;
  // 📌 ウォッチャーに入荷通知（1回きり＝通知後に登録解除）
  if (listing.give_name) {
    const watchers = db
      .takeWatchers(listing.give_name)
      .filter((id) => id !== listing.seller_id)
      .slice(0, 15);
    if (watchers.length) {
      await ch
        .send({
          content:
            `📌 **入荷通知 / Watch alert!** ${watchers.map((id) => `<@${id}>`).join(' ')}\n` +
            `ウォッチ中の「**${listing.give_item}**」が出品されたよ！👇ボタンで取引ルームへ\n` +
            `Your watched item was just listed! Tap the button to trade 👇`,
          components: [dealRow(listing.id)],
          allowedMentions: { users: watchers },
        })
        .catch(() => {});
    }
  }
  // 💞 自動マッチング：相互に条件が噛み合う出品を探して両者に提案
  const cand = findBestMatch(listing);
  if (cand) {
    const key = [listing.seller_id, cand.seller_id].sort().join(':');
    const now = Date.now();
    const last = notifiedPairs.get(key);
    if (!last || now - last > MATCH_DEDUP_TTL) {
      notifiedPairs.set(key, now);
      await ch
        .send({
          content:
            `💞 **交換マッチの予感！ / Possible match!**\n` +
            `<@${listing.seller_id}>「**${listing.give_item}**」(#${listing.id}) ⇄ ` +
            `<@${cand.seller_id}>「**${cand.give_item}**」(#${cand.id})\n` +
            `👇 **相手側**のボタンを押すと取引ルームができるよ / Tap the **other side’s** button to open a room`,
          components: [matchPairRow(listing, cand)],
          allowedMentions: { users: [listing.seller_id, cand.seller_id] },
        })
        .catch(() => {});
    }
  }
}
// 相互マッチ（両者のwantが噛み合う）を最優先、無ければ片方向（相手が自分の品を求めてる等）
function findBestMatch(listing) {
  if (!listing.give_name) return null;
  const wantMine = db.listingsWanting(listing.give_name, listing.seller_id, 25);
  const myWant = (listing.want_item || '').trim();
  const offerWanted = myWant ? db.listingsOffering(myWant, listing.seller_id, 25) : [];
  const offerIds = new Set(offerWanted.map((l) => l.id));
  return wantMine.find((l) => offerIds.has(l.id)) || wantMine[0] || offerWanted[0] || null;
}
function matchPairRow(a, b) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`mkt_deal_${a.id}`)
      .setLabel(`🤝 #${a.id} ${a.give_name || ''}`.slice(0, 80))
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`mkt_deal_${b.id}`)
      .setLabel(`🤝 #${b.id} ${b.give_name || ''}`.slice(0, 80))
      .setStyle(ButtonStyle.Success),
  );
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
      case 'mkt2_want_search':
        await interaction.showModal(wantSearchModal(lc));
        return true;
      case 'mkt2_wantmemo':
        await interaction.showModal(wantMemoModal(s, lc));
        return true;
      case 'mkt2_watch': {
        // 📌 出品されたら通知（直前に空振りした検索対象を登録）
        const name = s.lastSearch;
        if (!name) {
          await interaction.update(expiredView(lc));
          return true;
        }
        const r = db.addWatch(interaction.user.id, name, WATCH_MAX);
        await interaction.reply({
          content:
            r === 'limit'
              ? t(lc, 'watch_limit', { n: WATCH_MAX })
              : t(lc, 'watch_saved', { item: name, n: WATCH_MAX }),
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }
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
    if (interaction.customId === 'mkt2_want_modal') {
      if (!s) return interaction.update(expiredView(lc));
      await showWantResults(interaction, interaction.fields.getTextInputValue('q').trim());
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
      // 言語ごとに複数設置できる。フィード未指定なら「このパネルの既存設定 → 既定フィード」を引き継ぐ
      const opt = interaction.options.getChannel('フィード');
      const cur = db.getMarketPanel(interaction.channelId);
      const feedId = opt?.id || cur?.feed_channel_id || db.getSetting('feed_channel_id') || null;
      const msg = await interaction.channel.send(buildPanel());
      db.upsertMarketPanel(msg.channelId, msg.id, feedId);
      await interaction.reply({
        content:
          t(interaction.locale, 'panel_set') +
          (feedId ? `\n📋 出品カードの流し先: <#${feedId}>` : '\n⚠️ フィード未設定：先に流したいチャンネルで `/フィード設置` を実行してね'),
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
    if (interaction.commandName === '図鑑リロード') {
      const n = catalog.reload();
      if (n > 0) db.importItemNames(catalog.allItemNames());
      await interaction.reply({
        content:
          n > 0
            ? `✅ 図鑑を再読込したよ（${n}体）。新キャラの絵文字が未登録なら \`upload-app-emojis.js\` も実行してね。`
            : '❌ 図鑑の再読込に失敗（CATALOG_PATH と characters.json を確認してね）。旧データのまま動いてるよ。',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }
    if (interaction.commandName === '日報設置') {
      db.setSetting('news_channel_id', interaction.channelId);
      db.setSetting('last_daily_news', String(Date.now()));
      await interaction.channel.send(buildNewsPayload()).catch(() => {});
      await interaction.reply({
        content: '✅ デイリーマーケットニュースをこのチャンネルに毎日自動投稿するよ（↑いまのがサンプル）。',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }
    if (interaction.commandName === '実績ロール設定') {
      const role = interaction.options.getRole('ロール');
      const min = interaction.options.getInteger('回数');
      db.setSetting('trader_role_id', role.id);
      db.setSetting('trader_role_min', String(min));
      await interaction.reply({
        content:
          `✅ 取引成立 **${min}回** で ${role} を自動付与するよ。\n` +
          '⚠️ Botのロールがこのロールより**上**にあること＆「ロールの管理」権限が必要だよ。',
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
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
      await handleDone(interaction, Number(id.slice('mkt_done_'.length)));
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
  // 出品者が抜ける＝この取引はナシ → 部屋を解散する。
  // 出品自体はリストに残す（他の人が取引できる）／自分で抜けたので不在ストライクは付けない。
  if (listing && listing.seller_id === interaction.user.id) {
    const thread = interaction.channel;
    await interaction.reply({ content: t(lc, 'seller_left_room'), flags: MessageFlags.Ephemeral });
    db.deleteRoom(listingId);
    if (thread?.isThread?.()) {
      await thread.send(SELLER_LEFT_NOTICE).catch(() => {});
      closeThreadSoon(thread, 5000);
    }
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
// 再出品の中核（自動/手動 共用）：元を失効＋古いカード削除＋同条件で新カードをフィード最新に出す。
// 自動(ping=true)は不在ストライク+1を引き継ぐ。手動＝出品者の生存確認なので0にリセット。
async function doRelist(client, old, ping = false) {
  // 元のカードが載っていたフィードに出し直す（日本語版の出品は日本語版フィードへ戻る）
  const ch = await channelForListing(client, old);
  if (!ch) return null;
  db.setStatus(old.id, 'expired');
  if (old.channel_id && old.message_id) {
    const oc = await client.channels.fetch(old.channel_id).catch(() => null);
    await oc?.messages?.delete(old.message_id).catch(() => {});
  }
  const strikes = ping ? (old.relist_count || 0) + 1 : 0;
  const newId = db.addListing({
    sellerId: old.seller_id,
    give: old.give_item,
    giveName: old.give_name,
    want: old.want_item,
    note: old.note,
    sellerTag: old.seller_tag,
    sellerAvatar: old.seller_avatar,
    relistCount: strikes,
  });
  db.setListingImages(newId, old.give_img, old.want_img);
  if (old.give_name) db.recordItem(old.give_name);
  const listing = db.getListing(newId);
  const msg = await ch.send({
    content: ping
      ? `🔔 <@${old.seller_id}> 不在で時間切れ→自動で再出品したよ（**不在${strikes}回目・${RELIST_STRIKE_MAX}回で自動取り下げ**）/ auto-re-listed (no-show ${strikes}/${RELIST_STRIKE_MAX})`
      : undefined,
    embeds: [listingEmbed(listing)],
    components: [dealRow(newId)],
    allowedMentions: ping ? { users: [old.seller_id] } : NO_PING,
  });
  db.setListingMessage(newId, msg.channelId, msg.id);
  // 再出品でも📌ウォッチ通知＆💞マッチングを回す（ペア6hデデュープでスパムは防ぐ）
  afterListingPosted(client, db.getListing(newId)).catch((e) =>
    console.error('再出品後通知失敗:', e),
  );
  return listing;
}
// 手動再出品（DMの🔁ボタン）
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
  const listing = await doRelist(interaction.client, old);
  await interaction.reply({
    content: listing ? t(lc, 'relisted', { id: listing.id }) : t(lc, 'relist_fail'),
    flags: MessageFlags.Ephemeral,
  });
}

// 閉鎖時の後始末。出品の行き先は3通り:
//   A) 出品者が✅済みのまま相手の確認なし → 取引は済んだ扱いでクローズ（再出品しない・実績カウントなし）
//   B) 不在ストライクが上限（5回）到達 → 自動取り下げ（逃げ出品の掃除）＋フィードで告知
//   C) それ以外 → 自動再出品（ストライク+1）
async function notifyRoomClosed(client, room) {
  try {
    const listing = db.getListing(room.listing_id);
    const item = listing ? listing.give_item : '取引 / trade';
    const sellerId = listing ? listing.seller_id : null;
    // 参加者は自前DBから取得（GuildMembersインテント無しでも確実に届く）
    const ids = new Set(db.getRoomMembers(room.listing_id));
    if (sellerId) ids.add(sellerId);
    ids.delete(client.user.id);
    let relisted = null;
    let sellerMsg;
    let withRelistBtn = false;
    if (listing && listing.status === 'active') {
      if (room.done_seller) {
        // A) 出品者は完了済み＝取引自体は終わった可能性が高い。ゾンビ再出品を防ぐ
        db.setStatus(listing.id, 'closed');
        if (listing.channel_id && listing.message_id) {
          const oc = await client.channels.fetch(listing.channel_id).catch(() => null);
          await oc?.messages?.delete(listing.message_id).catch(() => {});
        }
        sellerMsg =
          `☑️ 「**${item}**」：あなたは✅済みだけど相手の✅が無いまま閉じたよ。出品は取り下げた（**両方✅が無いと実績にはカウントされない**）。\n` +
          `☑️ “**${item}**”: closed without your partner's ✅. Listing removed (no trade counted — BOTH must press ✅).`;
      } else if ((listing.relist_count || 0) + 1 >= RELIST_STRIKE_MAX) {
        // B) 5回不在 → 取り下げ
        db.setStatus(listing.id, 'expired');
        if (listing.channel_id && listing.message_id) {
          const oc = await client.channels.fetch(listing.channel_id).catch(() => null);
          await oc?.messages?.delete(listing.message_id).catch(() => {});
        }
        sellerMsg =
          `🗑️ 「**${item}**」は**不在${RELIST_STRIKE_MAX}回**で自動取り下げたよ。まだ交換したいなら「🟢出品する」からもう一度ね。\n` +
          `🗑️ “**${item}**” was removed after ${RELIST_STRIKE_MAX} no-shows. Re-post from 🟢 Post if you still want to trade.`;
        withRelistBtn = true; // ワンタップで復活できる導線は残す（押した時点で生存確認＝ストライク0）
        // フィードにも告知（DM拒否勢に届ける＆「逃げたら消える」ルールの周知）
        const feed = await channelForListing(client, listing);
        await feed
          ?.send({
            content:
              `🗑️ <@${sellerId}> の「**${item}**」は不在${RELIST_STRIKE_MAX}回で自動取り下げになったよ / removed after ${RELIST_STRIKE_MAX} no-shows`,
            allowedMentions: { users: sellerId ? [sellerId] : [] },
          })
          .catch(() => {});
      } else {
        // C) 通常の自動再出品
        relisted = await doRelist(client, listing, true).catch(() => null);
      }
    }
    const buyerMsg =
      `⌛ 取引ルーム「**${item}**」は無反応で自動で閉じたよ。また「🔍探す」から試してね。\n` +
      `⌛ The trade room for “**${item}**” closed due to inactivity. Try again from “🔍 Find”.`;
    if (!sellerMsg) {
      sellerMsg = relisted
        ? `🔔🔔 あなたの出品「**${item}**」で取引ルームが立ったけど、**不在で10分会話が無く時間切れ**…！\n` +
          `🔁 **自動でもう一度出品しといたよ**（不在${(relisted.relist_count || 0)}回目・${RELIST_STRIKE_MAX}回で自動取り下げ）。\n` +
          `🔔🔔 Room for “**${item}**” timed out (you were away). **Auto-re-listed** (no-show ${(relisted.relist_count || 0)}/${RELIST_STRIKE_MAX}).`
        : `⌛ あなたの出品「**${item}**」の取引ルームが時間切れで閉じたよ。\n⌛ Your trade room for “**${item}**” timed out.`;
      withRelistBtn = !relisted;
    }
    for (const id of ids) {
      const u = await client.users.fetch(id).catch(() => null);
      if (!u) continue;
      if (sellerId && id === sellerId) {
        await u
          .send({
            content: sellerMsg,
            components: withRelistBtn && listing ? [relistRow(listing.id)] : [],
          })
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

// ===== 取引ルームの「無反応」自動クローズ＋定期メンテ =====
let sweepRunning = false; // 多重実行ガード：前回の掃除が長引いても重ねて走らせない（DM二重送信等の防止）
export function startRoomExpiryLoop(client) {
  setInterval(async () => {
    if (sweepRunning) return;
    sweepRunning = true;
    try {
      await sweepOnce(client);
    } catch (e) {
      console.error('定期メンテ失敗:', e);
    } finally {
      sweepRunning = false;
    }
  }, 60 * 1000);
}
async function sweepOnce(client) {
    const now = Date.now();
    for (const r of db.allRooms()) {
      const thread = await client.channels.fetch(r.thread_id).catch(() => null);
      if (!thread) {
        db.deleteRoom(r.listing_id);
        continue;
      }
      const listing = db.getListing(r.listing_id);
      const lastActive = r.last_active || r.created_at;
      const idle = now - lastActive;
      const age = now - r.created_at;
      // 片方だけ✅済み（確認待ち）: 最初の✅から30分間は無反応クローズを保留し、
      // 押してない側に毎分リマインド。30分過ぎたら通常の無反応クローズに戻す
      // （出品者✅済み→取り下げ / 買い手のみ✅→出品者の不在ストライク）。
      const pending =
        listing &&
        listing.status === 'active' &&
        ((r.done_seller && !r.done_buyer_id) || (!r.done_seller && r.done_buyer_id));
      const pendingFor = now - (r.done_at || r.created_at);
      if (pending && pendingFor < DONE_PENDING_MAX && age < ROOM_HARD_MAX) {
        // 押してない側＝出品者 or 出品者以外のルーム参加者（退出済みは対象外＝再追加ピンで引き戻さない）
        const targets = !r.done_seller
          ? [listing.seller_id]
          : db.getRoomMembers(r.listing_id).filter((id) => id !== listing.seller_id);
        if (targets.length) {
          if (now - (r.done_remind_at || 0) >= DONE_REMIND_EVERY) {
            db.setRoomRemind(r.listing_id, now);
            const deadline = Math.floor(((r.done_at || now) + DONE_PENDING_MAX) / 1000);
            await thread
              .send({
                content:
                  `⏰ ${targets.map((id) => `<@${id}>`).join(' ')} 「✅取引完了」を押してね！**2人とも押すと成立**（実績にカウント）。押されないと <t:${deadline}:R> に閉じるよ！\n` +
                  `⏰ Press ✅ Done! It only counts when **BOTH** press — closing <t:${deadline}:R> otherwise!`,
                allowedMentions: { users: targets.slice(0, 5) },
              })
              .catch(() => {});
          }
          continue; // 確認待ちの間は閉じない
        }
        // リマインドする相手がいない（全員退出）→ 通常の無反応クローズに任せる
      }
      if (idle >= ROOM_IDLE_TTL || age >= ROOM_HARD_MAX) {
        await notifyRoomClosed(client, r); // 出品者✅済み→クローズ / 5ストライク→取り下げ / 他→自動再出品
        try {
          await thread.delete();
        } catch (e) {
          console.error('部屋の削除に失敗→アーカイブで枠を返す:', e?.rawError?.message || e?.message || e);
          await thread.setArchived(true).catch(() => {});
        }
        db.deleteRoom(r.listing_id);
      } else if (idle >= ROOM_WARN && !r.warned) {
        const ping = listing ? `<@${listing.seller_id}>` : '';
        const closeAt = Math.floor((lastActive + ROOM_IDLE_TTL) / 1000); // Discordが自動カウントダウン表示
        await thread
          .send(
            `⏰🔔 **あと約5分で自動クローズ**（<t:${closeAt}:R>）！会話が無いと閉じるよ。続けるならメッセージしてね！ ${ping}\n` +
              `Auto-closes <t:${closeAt}:R> if no chat — send a message to keep it open!`,
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
    // 掃除：メモリ＋古い行（closed/expired出品・需要記録・マッチ記録・放置ウォッチ・通知デデュープ）
    pruneMemory(now);
    try {
      db.pruneOldListings(7 * 24 * 60 * 60 * 1000);
      db.pruneWantHits(30 * 24 * 60 * 60 * 1000);
      db.pruneMatches(7 * 24 * 60 * 60 * 1000);
      db.pruneWatches(WATCH_TTL);
      for (const [k, ts] of notifiedPairs) {
        if (now - ts > MATCH_DEDUP_TTL) notifiedPairs.delete(k);
      }
    } catch (e) {
      console.error('出品プルーニング失敗:', e);
    }
    // デイリーマーケットニュース（/日報設置 済みなら24hごとに投稿）
    try {
      const newsCh = db.getSetting('news_channel_id');
      if (newsCh) {
        const last = Number(db.getSetting('last_daily_news') || 0);
        if (now - last >= DAY) {
          db.setSetting('last_daily_news', String(now)); // 先に記録＝送信失敗しても連投しない
          const ch = await client.channels.fetch(newsCh).catch(() => null);
          if (ch) await ch.send(buildNewsPayload()).catch((e) => console.error('日報投稿失敗:', e));
        }
      }
    } catch (e) {
      console.error('日報処理失敗:', e);
    }
    // パネルを常に最下部に保つ（操作チャンネルで最後のメッセージがパネルでなければ貼り直す）
    try {
      // 設置されている全パネル（日本語版・英語版…）をそれぞれ最下部に保つ
      for (const p of db.allMarketPanels()) {
        const channel = await client.channels.fetch(p.channel_id).catch(() => null);
        if (!channel) continue;
        const last = await channel.messages.fetch({ limit: 1 }).catch(() => null);
        const lastId = last && last.first() ? last.first().id : null;
        if (lastId && lastId !== p.message_id) {
          if (p.message_id) {
            const old = await channel.messages.fetch(p.message_id).catch(() => null);
            if (old) await old.delete().catch(() => {});
          }
          const msg = await channel.send(buildPanel());
          db.setMarketPanelMessage(p.channel_id, msg.id);
        }
      }
    } catch (e) {
      console.error('パネル最下部維持失敗:', e);
    }
}

// 起動時：DBの絵文字IDを「アプリ絵文字」と突合し、存在しないものを除去（メニューが壊れるのを防ぐ）
export async function syncEmojisAcrossGuilds(client) {
  try {
    const appId = client.application?.id;
    if (!appId) return;
    const res = await client.rest.get(`/applications/${appId}/emojis`).catch(() => null);
    const items = res && Array.isArray(res.items) ? res.items : Array.isArray(res) ? res : null;
    if (!items) return; // 取得失敗時は何もしない（消しすぎ防止）
    const have = new Set(items.map((e) => e.id));
    let pruned = 0;
    for (const row of db.allEmojis()) {
      if (!have.has(row.emoji_id)) {
        db.deleteEmoji(row.name);
        pruned++;
      }
    }
    if (pruned) console.log(`🧹 絵文字DB整合: ${pruned}件除去（アプリ絵文字に無いもの）`);
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
  if (db.isMarketPanelChannel(message.channelId)) scheduleRepostPanel(message.channel);
}
async function repostPanel(channel) {
  try {
    const p = db.getMarketPanel(channel.id);
    if (!p) return;
    if (p.message_id) {
      const old = await channel.messages.fetch(p.message_id).catch(() => null);
      if (old) await old.delete().catch(() => {});
    }
    const msg = await channel.send(buildPanel());
    db.setMarketPanelMessage(channel.id, msg.id);
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
      content: CONTROL_HINT,
      components: [doneRow(room.listing_id)],
    });
    db.setRoomControl(room.listing_id, msg.id);
  } catch (e) {
    console.error('取引完了ボタン貼り直し失敗:', e);
  }
}
