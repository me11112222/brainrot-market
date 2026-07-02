// マーケットプレイスのデータ保存層（Node24標準の node:sqlite を使用 = 依存ゼロ）
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(join(__dirname, '..', 'data.sqlite'));

// 同時アクセス耐性：WAL（読み書き並行OK）＋ロック時は最大5秒待つ。
// 絵文字アップロード等の別プロセスとbot本体が同じDBを触っても「database is locked」で落ちないように。
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS listings (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_id  TEXT    NOT NULL,
    give_item  TEXT    NOT NULL,   -- 出すもの
    want_item  TEXT,               -- ほしいもの（求）
    note       TEXT,               -- メモ
    status     TEXT    NOT NULL DEFAULT 'active', -- active / matched / expired / closed
    channel_id TEXT,
    message_id TEXT,
    created_at INTEGER NOT NULL
  );
`);

// 出品の画像URL列（変異/スキン対応）を後付け
try {
  db.exec(`ALTER TABLE listings ADD COLUMN give_img TEXT`);
} catch {
  /* 既にある */
}
try {
  db.exec(`ALTER TABLE listings ADD COLUMN want_img TEXT`);
} catch {
  /* 既にある */
}
// 集計用：出すものの「ベース名」（変異/★を除いた素のキャラ名）。供給ランキングに使う
try {
  db.exec(`ALTER TABLE listings ADD COLUMN give_name TEXT`);
} catch {
  /* 既にある */
}
// 出品者の表示名＆アイコン（カードのフッターに出す）
try {
  db.exec(`ALTER TABLE listings ADD COLUMN seller_tag TEXT`);
} catch {
  /* 既にある */
}
try {
  db.exec(`ALTER TABLE listings ADD COLUMN seller_avatar TEXT`);
} catch {
  /* 既にある */
}

// 大規模運用向けインデックス（検索・集計・自分の出品の高速化）
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_listings_status   ON listings(status);
  CREATE INDEX IF NOT EXISTS idx_listings_seller   ON listings(seller_id, status);
  CREATE INDEX IF NOT EXISTS idx_listings_givename ON listings(give_name, status);
  CREATE INDEX IF NOT EXISTS idx_listings_created  ON listings(status, created_at);
`);

// アイテム辞書（出品されるたびに自動で育つ＝ハイブリッドの土台）
db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    name TEXT PRIMARY KEY,
    uses INTEGER NOT NULL DEFAULT 0
  );
`);

// 初期シード（よく出るブレインロット系。使われるほど候補が増えていく）
const SEED_ITEMS = [
  '変異ゴジラ', 'ゴジラ', 'ティノ', 'デビルケロベ', 'ノマドラ',
  'マコラ', 'モビー', '花', '変異', 'ボス級',
];
{
  const seed = db.prepare(`INSERT OR IGNORE INTO items (name, uses) VALUES (?, 0)`);
  for (const s of SEED_ITEMS) seed.run(s);
}

export function addListing({ sellerId, give, giveName, want, note, sellerTag, sellerAvatar }) {
  const info = db
    .prepare(
      `INSERT INTO listings (seller_id, give_item, give_name, want_item, note, seller_tag, seller_avatar, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      sellerId,
      give,
      giveName || null,
      want || null,
      note || null,
      sellerTag || null,
      sellerAvatar || null,
      Date.now(),
    );
  return Number(info.lastInsertRowid);
}

// 供給ランキング：今アクティブな出品を「ベース名」ごとに集計（多い順）
export function topSupply(limit = 10) {
  return db
    .prepare(
      `SELECT give_name AS name, COUNT(*) AS c
       FROM listings
       WHERE status='active' AND give_name IS NOT NULL AND give_name <> ''
       GROUP BY give_name ORDER BY c DESC, name LIMIT ?`,
    )
    .all(limit);
}

// 全アクティブ出品（戦闘力など任意基準で並べ替える用）
export function activeListings(limit = 200) {
  return db
    .prepare(`SELECT * FROM listings WHERE status='active' ORDER BY created_at DESC LIMIT ?`)
    .all(limit);
}

// 同カテゴリ等「近い出品」を引く（一致なしの代替表示用）
export function activeListingsByNames(names, limit = 5) {
  const list = (names || []).filter(Boolean);
  if (!list.length) return [];
  const ph = list.map(() => '?').join(',');
  return db
    .prepare(
      `SELECT * FROM listings
       WHERE status='active' AND give_name IN (${ph})
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(...list, limit);
}

export function setListingMessage(id, channelId, messageId) {
  db.prepare(`UPDATE listings SET channel_id=?, message_id=? WHERE id=?`).run(
    channelId,
    messageId,
    id,
  );
}
export function setListingImages(id, giveImg, wantImg) {
  db.prepare(`UPDATE listings SET give_img=?, want_img=? WHERE id=?`).run(
    giveImg || null,
    wantImg || null,
    id,
  );
}

export function getListing(id) {
  return db.prepare(`SELECT * FROM listings WHERE id=?`).get(id);
}

// LIKE用にユーザー入力の % _ \ をエスケープ（ワイルドカード注入防止）
function likeArg(keyword) {
  return '%' + String(keyword).replace(/([\\%_])/g, '\\$1') + '%';
}

// 出すものを検索：まず「ベース名の完全一致」（正確）→足りなければ表記の部分一致で補完
export function searchListings(keyword, limit = 5) {
  const exact = db
    .prepare(
      `SELECT * FROM listings
       WHERE status='active' AND give_name = ?
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(keyword, limit);
  if (exact.length >= limit) return exact;
  const seen = new Set(exact.map((r) => r.id));
  const fuzzy = db
    .prepare(
      `SELECT * FROM listings
       WHERE status='active' AND give_item LIKE ? ESCAPE '\\'
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(likeArg(keyword), limit)
    .filter((r) => !seen.has(r.id));
  return [...exact, ...fuzzy].slice(0, limit);
}

// 逆引き：相手の「ほしいもの(want)」をキーワード検索（自分が持ってる物の出し先を探す）
export function searchByWant(keyword, limit = 10) {
  return db
    .prepare(
      `SELECT * FROM listings
       WHERE status='active' AND want_item LIKE ? ESCAPE '\\'
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(likeArg(keyword), limit);
}

// 自動マッチング用①：相手の want に「このベース名」が含まれるアクティブ出品
export function listingsWanting(giveName, excludeSellerId, limit = 25) {
  return db
    .prepare(
      `SELECT * FROM listings
       WHERE status='active' AND seller_id <> ? AND want_item LIKE ? ESCAPE '\\'
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(excludeSellerId, likeArg(giveName), limit);
}

// 自動マッチング用②：自分の want 文に相手の give_name が含まれるアクティブ出品
export function listingsOffering(wantText, excludeSellerId, limit = 25) {
  return db
    .prepare(
      `SELECT * FROM listings
       WHERE status='active' AND seller_id <> ?
         AND give_name IS NOT NULL AND give_name <> ''
         AND instr(?, give_name) > 0
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(excludeSellerId, String(wantText), limit);
}

// あるベース名のアクティブ出品数（🔥需要バッジの供給側）
export function countActiveByName(name) {
  return db
    .prepare(`SELECT COUNT(*) AS c FROM listings WHERE status='active' AND give_name=?`)
    .get(name).c;
}

// 直近N日の新規出品数（週報用）
export function countListingsSince(sinceMs) {
  return db
    .prepare(`SELECT COUNT(*) AS c FROM listings WHERE created_at >= ?`)
    .get(Date.now() - sinceMs).c;
}

export function listByUser(userId) {
  return db
    .prepare(
      `SELECT * FROM listings WHERE seller_id=? AND status='active'
       ORDER BY created_at DESC`,
    )
    .all(userId);
}

export function setStatus(id, status) {
  db.prepare(`UPDATE listings SET status=? WHERE id=?`).run(status, id);
}

// 古い closed/expired 出品を物理削除（DB肥大化を防ぐ）。返り値は削除件数。
export function pruneOldListings(maxAgeMs) {
  const cutoff = Date.now() - maxAgeMs;
  const info = db
    .prepare(
      `DELETE FROM listings WHERE status IN ('closed','expired') AND created_at < ?`,
    )
    .run(cutoff);
  return Number(info.changes || 0);
}

// 期限切れ（古い出品）を expired に。返り値は期限切れになった行（掲示メッセージ掃除用）
export function expireOld(maxAgeMs) {
  const cutoff = Date.now() - maxAgeMs;
  const rows = db
    .prepare(`SELECT * FROM listings WHERE status='active' AND created_at < ?`)
    .all(cutoff);
  db.prepare(
    `UPDATE listings SET status='expired' WHERE status='active' AND created_at < ?`,
  ).run(cutoff);
  return rows;
}

// アイテム辞書に記録（出品時に呼ぶ）。使用回数を加算。
export function recordItem(name) {
  const n = (name || '').trim();
  if (!n) return;
  db.prepare(
    `INSERT INTO items (name, uses) VALUES (?, 1)
     ON CONFLICT(name) DO UPDATE SET uses = uses + 1`,
  ).run(n);
}

// オートコンプリート候補（部分一致を人気順で）
export function suggestItems(query, limit = 25) {
  const q = (query || '').trim();
  if (!q) {
    return db
      .prepare(`SELECT name FROM items ORDER BY uses DESC, name LIMIT ?`)
      .all(limit)
      .map((r) => r.name);
  }
  return db
    .prepare(
      `SELECT name FROM items WHERE name LIKE ? ORDER BY uses DESC, name LIMIT ?`,
    )
    .all(`%${q}%`, limit)
    .map((r) => r.name);
}

// 取引（マッチ）記録：同じ人が同じ出品に連打しても重複ルームを作らないため
db.exec(`
  CREATE TABLE IF NOT EXISTS matches (
    listing_id INTEGER NOT NULL,
    buyer_id   TEXT    NOT NULL,
    thread_id  TEXT    NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (listing_id, buyer_id)
  );
`);

export function getMatch(listingId, buyerId) {
  return db
    .prepare(`SELECT * FROM matches WHERE listing_id=? AND buyer_id=?`)
    .get(listingId, buyerId);
}

export function addMatch(listingId, buyerId, threadId) {
  db.prepare(
    `INSERT OR REPLACE INTO matches (listing_id, buyer_id, thread_id, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(listingId, buyerId, threadId, Date.now());
}

// 取引ルーム（1出品＝1ルーム）。失効アナウンス済みフラグ＋操作メッセージID付き。
db.exec(`
  CREATE TABLE IF NOT EXISTS match_rooms (
    listing_id     INTEGER PRIMARY KEY,
    thread_id      TEXT    NOT NULL,
    created_at     INTEGER NOT NULL,
    announced12    INTEGER NOT NULL DEFAULT 0,
    announced1     INTEGER NOT NULL DEFAULT 0,
    control_msg_id TEXT
  );
`);
// 既存テーブル向けに列を追加（無ければ）
try {
  db.exec(`ALTER TABLE match_rooms ADD COLUMN control_msg_id TEXT`);
} catch {
  /* 既にある場合は無視 */
}
// 無反応クローズ用：最終活動時刻と警告済みフラグ
try {
  db.exec(`ALTER TABLE match_rooms ADD COLUMN last_active INTEGER`);
} catch {
  /* 既にある */
}
try {
  db.exec(`ALTER TABLE match_rooms ADD COLUMN warned INTEGER NOT NULL DEFAULT 0`);
} catch {
  /* 既にある */
}
// 両者✅方式：出品者の✅フラグと、✅を押した相手（買い手）のID
try {
  db.exec(`ALTER TABLE match_rooms ADD COLUMN done_seller INTEGER NOT NULL DEFAULT 0`);
} catch {
  /* 既にある */
}
try {
  db.exec(`ALTER TABLE match_rooms ADD COLUMN done_buyer_id TEXT`);
} catch {
  /* 既にある */
}

export function getRoom(listingId) {
  return db.prepare(`SELECT * FROM match_rooms WHERE listing_id=?`).get(listingId);
}
export function addRoom(listingId, threadId) {
  const now = Date.now();
  db.prepare(
    `INSERT OR REPLACE INTO match_rooms (listing_id, thread_id, created_at, last_active, announced12, announced1, warned)
     VALUES (?, ?, ?, ?, 0, 0, 0)`,
  ).run(listingId, threadId, now, now);
}
// 活動があったら最終活動時刻を更新＆警告フラグ解除（チャット中は閉じない）
export function touchRoom(threadId) {
  db.prepare(`UPDATE match_rooms SET last_active=?, warned=0 WHERE thread_id=?`).run(
    Date.now(),
    threadId,
  );
}
export function markRoomWarned(listingId) {
  db.prepare(`UPDATE match_rooms SET warned=1 WHERE listing_id=?`).run(listingId);
}
// 参加者を自前で記録（閉鎖DM通知に使う。GuildMembersインテント無しでも確実）
db.exec(`
  CREATE TABLE IF NOT EXISTS room_members (
    listing_id INTEGER NOT NULL,
    user_id    TEXT    NOT NULL,
    PRIMARY KEY (listing_id, user_id)
  );
`);
export function addRoomMember(listingId, userId) {
  if (!userId) return;
  db.prepare(
    `INSERT OR IGNORE INTO room_members (listing_id, user_id) VALUES (?, ?)`,
  ).run(listingId, userId);
}
export function getRoomMembers(listingId) {
  return db
    .prepare(`SELECT user_id FROM room_members WHERE listing_id=?`)
    .all(listingId)
    .map((r) => r.user_id);
}
export function removeRoomMember(listingId, userId) {
  db.prepare(`DELETE FROM room_members WHERE listing_id=? AND user_id=?`).run(
    listingId,
    userId,
  );
}
export function deleteRoom(listingId) {
  db.prepare(`DELETE FROM match_rooms WHERE listing_id=?`).run(listingId);
  db.prepare(`DELETE FROM room_members WHERE listing_id=?`).run(listingId);
}
export function allRooms() {
  return db.prepare(`SELECT * FROM match_rooms`).all();
}
export function markAnnounced(listingId, col) {
  if (col !== 'announced12' && col !== 'announced1') return;
  db.prepare(`UPDATE match_rooms SET ${col}=1 WHERE listing_id=?`).run(listingId);
}
export function getRoomByThread(threadId) {
  return db.prepare(`SELECT * FROM match_rooms WHERE thread_id=?`).get(threadId);
}
export function setRoomControl(listingId, msgId) {
  db.prepare(`UPDATE match_rooms SET control_msg_id=? WHERE listing_id=?`).run(
    msgId,
    listingId,
  );
}
export function setRoomDoneSeller(listingId) {
  db.prepare(`UPDATE match_rooms SET done_seller=1 WHERE listing_id=?`).run(listingId);
}
export function setRoomDoneBuyer(listingId, userId) {
  db.prepare(`UPDATE match_rooms SET done_buyer_id=? WHERE listing_id=?`).run(
    userId,
    listingId,
  );
}

// 古いマッチ記録の掃除（重複ルーム防止用の記録は数日で用済み）
export function pruneMatches(maxAgeMs) {
  const info = db
    .prepare(`DELETE FROM matches WHERE created_at < ?`)
    .run(Date.now() - maxAgeMs);
  return Number(info.changes || 0);
}

// ===== 取引実績（両者✅で成立した取引の記録）=====
// 実績カウント→信頼バッジ・実績ロール・週報の材料。消さずに貯める資産。
db.exec(`
  CREATE TABLE IF NOT EXISTS trades (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id INTEGER,
    seller_id  TEXT    NOT NULL,
    buyer_id   TEXT    NOT NULL,
    give_item  TEXT,
    give_name  TEXT,
    want_item  TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_trades_seller  ON trades(seller_id);
  CREATE INDEX IF NOT EXISTS idx_trades_buyer   ON trades(buyer_id);
  CREATE INDEX IF NOT EXISTS idx_trades_created ON trades(created_at);
`);

export function addTrade({ listingId, sellerId, buyerId, give, giveName, want }) {
  db.prepare(
    `INSERT INTO trades (listing_id, seller_id, buyer_id, give_item, give_name, want_item, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(listingId ?? null, sellerId, buyerId, give || null, giveName || null, want || null, Date.now());
}

// ユーザーの取引実績（出品側・買い手側の両方を合算）
export function tradesOf(userId) {
  return db
    .prepare(`SELECT COUNT(*) AS c FROM trades WHERE seller_id=? OR buyer_id=?`)
    .get(userId, userId).c;
}

// 直近N日の成立取引数（週報用）
export function tradesSince(sinceMs) {
  return db
    .prepare(`SELECT COUNT(*) AS c FROM trades WHERE created_at >= ?`)
    .get(Date.now() - sinceMs).c;
}

// ===== ウォッチリスト（📌 出品されたら通知）=====
db.exec(`
  CREATE TABLE IF NOT EXISTS watches (
    user_id    TEXT    NOT NULL,
    name       TEXT    NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, name)
  );
`);

// 登録。1人あたり maxPerUser 件まで（'ok' / 'limit' を返す）
export function addWatch(userId, name, maxPerUser = 5) {
  const n = (name || '').trim();
  if (!n || !userId) return 'limit';
  const has = db
    .prepare(`SELECT 1 FROM watches WHERE user_id=? AND name=?`)
    .get(userId, n);
  if (!has) {
    const c = db
      .prepare(`SELECT COUNT(*) AS c FROM watches WHERE user_id=?`)
      .get(userId).c;
    if (c >= maxPerUser) return 'limit';
  }
  db.prepare(
    `INSERT OR REPLACE INTO watches (user_id, name, created_at) VALUES (?, ?, ?)`,
  ).run(userId, n, Date.now());
  return 'ok';
}

// あるアイテムのウォッチャー全員を取り出して登録解除（通知は1回きり＝スパム防止）
export function takeWatchers(name) {
  const ids = db
    .prepare(`SELECT user_id FROM watches WHERE name=?`)
    .all(name)
    .map((r) => r.user_id);
  if (ids.length) db.prepare(`DELETE FROM watches WHERE name=?`).run(name);
  return ids;
}

// 古いウォッチの自動解除（放置登録の掃除）
export function pruneWatches(maxAgeMs) {
  const info = db
    .prepare(`DELETE FROM watches WHERE created_at < ?`)
    .run(Date.now() - maxAgeMs);
  return Number(info.changes || 0);
}

// 汎用設定（スティッキーのパネル位置などを保存）
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);
export function getSetting(key) {
  const row = db.prepare(`SELECT value FROM settings WHERE key=?`).get(key);
  return row ? row.value : null;
}
export function setSetting(key, value) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
  ).run(key, value);
}

// 需要ランキング：探すで選ばれた「ユニークユーザー数」で集計（連打水増しを防ぐ）
db.exec(`
  CREATE TABLE IF NOT EXISTS want_hits (
    name    TEXT NOT NULL,
    user_id TEXT NOT NULL,
    ts      INTEGER NOT NULL,
    PRIMARY KEY (name, user_id)
  );
`);
export function recordWant(name, userId) {
  const n = (name || '').trim();
  if (!n || !userId) return;
  db.prepare(
    `INSERT INTO want_hits (name, user_id, ts) VALUES (?, ?, ?)
     ON CONFLICT(name, user_id) DO UPDATE SET ts = excluded.ts`,
  ).run(n, userId, Date.now());
}
// 需要ランキング。sinceMs指定で「直近◯ミリ秒」の窓集計（鮮度重視）、省略で全期間
export function topWants(limit = 10, sinceMs = null) {
  if (sinceMs != null) {
    return db
      .prepare(
        `SELECT name, COUNT(*) AS c FROM want_hits WHERE ts >= ?
         GROUP BY name ORDER BY c DESC, name LIMIT ?`,
      )
      .all(Date.now() - sinceMs, limit);
  }
  return db
    .prepare(
      `SELECT name, COUNT(*) AS c FROM want_hits GROUP BY name ORDER BY c DESC, name LIMIT ?`,
    )
    .all(limit);
}

// あるアイテムの直近需要数（🔥バッジ判定用・ユニークユーザー）
export function demandCount(name, sinceMs) {
  return db
    .prepare(`SELECT COUNT(*) AS c FROM want_hits WHERE name=? AND ts >= ?`)
    .get(name, Date.now() - sinceMs).c;
}

// 古い需要記録の掃除（ランキングの鮮度維持＋肥大化防止）
export function pruneWantHits(maxAgeMs) {
  const info = db
    .prepare(`DELETE FROM want_hits WHERE ts < ?`)
    .run(Date.now() - maxAgeMs);
  return Number(info.changes || 0);
}

// アイテム名 → サーバーカスタム絵文字ID のマッピング（選択メニューに画像を出すため）
db.exec(`
  CREATE TABLE IF NOT EXISTS emojis (
    name     TEXT PRIMARY KEY,
    emoji_id TEXT NOT NULL,
    animated INTEGER NOT NULL DEFAULT 0
  );
`);
export function getEmoji(name) {
  return db.prepare(`SELECT emoji_id, animated FROM emojis WHERE name=?`).get(name);
}
export function setEmoji(name, emojiId, animated = 0) {
  db.prepare(
    `INSERT INTO emojis (name, emoji_id, animated) VALUES (?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET emoji_id=excluded.emoji_id, animated=excluded.animated`,
  ).run(name, emojiId, animated ? 1 : 0);
}
export function allEmojis() {
  return db.prepare(`SELECT name, emoji_id, animated FROM emojis`).all();
}
export function deleteEmoji(name) {
  db.prepare(`DELETE FROM emojis WHERE name=?`).run(name);
}
export function clearEmojis() {
  db.prepare(`DELETE FROM emojis`).run();
}
export function emojiCount() {
  return db.prepare(`SELECT COUNT(*) AS c FROM emojis`).get().c;
}

// 図鑑などの名前を一括で辞書に取り込む（既存はスキップ）
export function importItemNames(names) {
  const stmt = db.prepare(`INSERT OR IGNORE INTO items (name, uses) VALUES (?, 0)`);
  let n = 0;
  for (const name of names) {
    const v = (name || '').trim();
    if (v) {
      stmt.run(v);
      n++;
    }
  }
  return n;
}

export default db;
