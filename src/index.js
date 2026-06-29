import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  Events,
  Options,
  REST,
  Routes,
  SlashCommandBuilder,
} from 'discord.js';
import {
  marketplaceCommands,
  handleMarketplaceInteraction,
  startRoomExpiryLoop,
  maybeRepostSticky,
  maybeRepostThreadControl,
  syncEmojisAcrossGuilds,
} from './marketplace.js';
import { importItemNames } from './db.js';
import { readFileSync } from 'node:fs';

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error('❌ .env が未設定です（DISCORD_TOKEN / CLIENT_ID は必須）');
  process.exit(1);
}

// --- Phase 0: 動作確認用のスラッシュコマンド ---
const commands = [
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('BrainrotBot の応答確認')
    .toJSON(),
  ...marketplaceCommands,
];

const client = new Client({
  // 必要最小限のインテント（メモリ＆負荷削減。MessageContent/GuildMembersはPhase2で必要になったら追加）
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  // 3万人規模でメモリが溢れないようキャッシュを抑制（メンバーは基本キャッシュしない）
  makeCache: Options.cacheWithLimits({
    ...Options.DefaultMakeCacheSettings,
    MessageManager: 20,
    GuildMemberManager: {
      maxSize: 50,
      keepOverLimit: (m) => m.id === m.client.user.id, // 自分(bot)だけは保持
    },
    UserManager: { maxSize: 200, keepOverLimit: (u) => u.id === u.client.user.id },
    PresenceManager: 0,
  }),
  sweepers: {
    ...Options.DefaultSweeperSettings,
    messages: { interval: 600, lifetime: 900 }, // 古いメッセージキャッシュを定期破棄
    threads: { interval: 3600, lifetime: 3600 },
  },
});

// サーバーロック：メインサーバー以外には居座らせない
// （RMT業者などが MEGA MECHSPOT を自分のサーバーに招待しても即退出させる）
const ALLOWED_GUILD = GUILD_ID; // 本番は固定。空（開発時）なら制限しない
async function enforceGuildLock(guild) {
  if (!ALLOWED_GUILD || guild.id === ALLOWED_GUILD) return false;
  console.log(`🔒 許可外サーバーから退出: ${guild.name} (${guild.id})`);
  await guild.leave().catch((e) => console.error('退出失敗:', e));
  return true;
}

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ ログイン成功: ${c.user.tag}`);

  // 参加中のサーバーを一覧表示（GUILD_ID確認用）
  console.log('📋 参加中のサーバー:');
  for (const g of c.guilds.cache.values()) {
    console.log(`   - ${g.name}  (ID: ${g.id})`);
  }

  // サーバーロック：許可外サーバーから退出
  if (ALLOWED_GUILD) {
    for (const g of [...c.guilds.cache.values()]) await enforceGuildLock(g);
  }

  // ギルドコマンドを即時登録（反映が速い）。
  // GUILD_ID 指定があればそこだけ、無ければ参加中の全サーバーに登録。
  const rest = new REST().setToken(DISCORD_TOKEN);
  const targetGuildIds = GUILD_ID
    ? [GUILD_ID]
    : [...c.guilds.cache.keys()];
  for (const gid of targetGuildIds) {
    try {
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, gid), {
        body: commands,
      });
      console.log(`✅ スラッシュコマンド登録完了（guild: ${gid}）`);
    } catch (err) {
      console.error(`❌ コマンド登録失敗（guild: ${gid}）:`, err);
    }
  }

  // 図鑑（244体）を辞書に取り込む（マッチング精度向上）
  try {
    const raw = readFileSync(
      process.env.CATALOG_PATH || 'C:/AI/projects/event-tool/discord-bot/characters.json',
      'utf8',
    );
    const names = JSON.parse(raw)
      .map((c) => c.name)
      .filter(Boolean);
    console.log(`📚 図鑑取込: ${importItemNames(names)}件`);
  } catch (e) {
    console.warn('📚 図鑑読込スキップ:', e.message);
  }

  await syncEmojisAcrossGuilds(client); // 削除済み絵文字をDBから掃除
  startRoomExpiryLoop(client); // 取引ルームの無反応1h自動クローズ
  console.log('🛒 マーケットプレイス機能 起動');
});

// 招待されても許可外サーバーなら即退出
client.on(Events.GuildCreate, (guild) => {
  enforceGuildLock(guild);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // サーバーロック：許可外サーバーからの操作は無視（保険）
    if (ALLOWED_GUILD && interaction.guildId && interaction.guildId !== ALLOWED_GUILD) {
      return;
    }
    // /ping（基盤確認）
    if (interaction.isChatInputCommand() && interaction.commandName === 'ping') {
      await interaction.reply(
        `🏓 pong! BrainrotBot 稼働中（応答 ${Math.round(client.ws.ping)}ms）`,
      );
      return;
    }
    // マーケットプレイス（コマンド・ボタン・モーダル）
    await handleMarketplaceInteraction(interaction);
  } catch (err) {
    console.error('インタラクション処理エラー:', err);
    if (err?.rawError?.errors) {
      console.error('50035詳細:', JSON.stringify(err.rawError.errors));
    }
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      interaction.reply({ content: '❌ エラーが発生したよ。', ephemeral: true }).catch(() => {});
    }
  }
});

// スティッキー：パネルチャンネルに投稿が来たらパネルを最下部へ貼り直す
client.on(Events.MessageCreate, (message) => {
  try {
    maybeRepostSticky(message); // 募集チャンネルのパネルを最下部へ
    maybeRepostThreadControl(message); // 取引ルームの「取引完了」を最下部へ
  } catch (err) {
    console.error('スティッキー処理エラー:', err);
  }
});

client.login(DISCORD_TOKEN);
