// 荒らし・スパム・詐欺対策のユーティリティ。
// ・cleanText: メンション(@everyone等)を無効化
// ・contentIssue: リンク/URL・NGワードの検出
// ・rateOk: ユーザー単位の連投レート制限（メモリ内・直近1分窓）

// メンションを打ち消す（@everyone / @here / <@123> / <@&role> を無害化）
export function cleanText(s) {
  if (!s) return '';
  let t = String(s).trim();
  t = t.replace(/@(everyone|here)/gi, '@​$1'); // ゼロ幅スペースで分断
  t = t.replace(/<@&?\d+>/g, '[mention]');
  t = t.replace(/<#\d+>/g, '[channel]');
  return t;
}

// 最低限のNGワード（拡張可能）。誤検知を避けるため強い語のみ。
const NG_WORDS = [
  'fuck', 'shit', 'bitch', 'nigger', 'faggot', 'cunt',
  '死ね', 'しね', 'ころす', '殺す', 'きもい', 'うざい',
];

// 内容上の問題を返す。問題なければ null。
export function contentIssue(s) {
  if (!s) return null;
  const t = String(s);
  // Discord招待 or 一般URL（詐欺・外部誘導の防止）
  if (/discord(?:\.gg|app\.com\/invite|\.com\/invite)\//i.test(t)) return 'url';
  if (/https?:\/\//i.test(t)) return 'url';
  if (/\b[\w.-]+\.(?:com|net|org|gg|io|xyz|jp|co)\b/i.test(t)) return 'url';
  const low = t.toLowerCase();
  if (NG_WORDS.some((w) => low.includes(w.toLowerCase()))) return 'word';
  return null;
}

// ユーザー単位の連投制限。直近 windowMs に max 回まで許可。
const buckets = new Map(); // key: `${kind}:${userId}` -> number[] (timestamps)
export function rateOk(kind, userId, max, windowMs = 60000) {
  const key = `${kind}:${userId}`;
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter((ts) => now - ts < windowMs);
  if (arr.length >= max) {
    buckets.set(key, arr);
    return false;
  }
  arr.push(now);
  buckets.set(key, arr);
  return true;
}

// 古いレート記録を掃除（メモリリーク防止）。定期的に呼ぶ。
export function cleanupBuckets(windowMs = 60000) {
  const now = Date.now();
  for (const [k, arr] of buckets) {
    const f = arr.filter((ts) => now - ts < windowMs);
    if (f.length) buckets.set(k, f);
    else buckets.delete(k);
  }
}
