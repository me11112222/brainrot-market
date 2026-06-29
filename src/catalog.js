// 図鑑カタログ（名前・レア度・画像）を読み込み、画像ピッカー用に提供する
import { readFileSync } from 'node:fs';

const CDN = 'https://cdn.jsdelivr.net/gh/me11112222/brainrot-images@main/';
// 本番(Linux VM)では CATALOG_PATH env で図鑑の場所を指定。未設定時はローカル開発用パス。
const PATH =
  process.env.CATALOG_PATH || 'C:/AI/projects/event-tool/discord-bot/characters.json';

let chars = [];
try {
  chars = JSON.parse(readFileSync(PATH, 'utf8'));
} catch (e) {
  console.warn('📚 catalog読込失敗:', e.message);
}

// レア度をユーザー指定どおりに統合
const GROUPS = [
  { label: 'Common〜Mythic', rarities: ['Common', 'Rare', 'Epic', 'Legendary', 'Mythic'] },
  { label: 'BrainrotGod', rarities: ['BrainrotGod'] },
  { label: 'Secret', rarities: ['Secret'] },
  { label: 'BOSS', rarities: ['Boss', 'Ultimate Boss', 'YokaiBoss'] },
  { label: 'UNKNOWN', rarities: ['Unknown'] },
];

const byCategory = new Map();
const imageByName = new Map();
const skinsByName = new Map();
const attackByName = new Map();
const metaByName = new Map();
const allNames = [];
for (const c of chars) {
  if (!c?.name) continue;
  if (c.rarity === 'Missing') continue; // Missingはトレード不可＝非表示
  const g = GROUPS.find((x) => x.rarities.includes(c.rarity));
  if (!g) continue; // どのカテゴリにも属さないものは出さない
  allNames.push(c.name);
  if (c.image) imageByName.set(c.name, c.image);
  if (c.skins) skinsByName.set(c.name, c.skins);
  const atk = Number(c.attack);
  if (Number.isFinite(atk)) attackByName.set(c.name, atk);
  metaByName.set(c.name, {
    attack: Number.isFinite(atk) ? atk : null,
    rarity: c.rarity || null,
    price: c.price || null,
    production: c.production || null,
  });
  if (!byCategory.has(g.label)) byCategory.set(g.label, []);
  byCategory.get(g.label).push(c.name);
}

export function loaded() {
  return chars.length;
}
export function categories() {
  // 中身があるグループだけ、定義順で返す
  return GROUPS.map((g) => g.label).filter((l) => byCategory.has(l));
}
export function itemsByCategory(label) {
  return byCategory.get(label) || [];
}
export function allItemNames() {
  return allNames.slice();
}
export function searchNames(query, limit = 25) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return [];
  return allNames.filter((n) => n.toLowerCase().includes(q)).slice(0, limit);
}
// あいまい検索：まず部分一致、足りなければ似ているもの（バイグラムDice係数）で埋める。
// → 「一致なし」で行き止まりにせず、近いものを必ず提案する。
function bigrams(s) {
  const t = s.toLowerCase();
  const b = [];
  for (let i = 0; i < t.length - 1; i++) b.push(t.slice(i, i + 2));
  return b;
}
function dice(a, b) {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.length || !B.length) return 0;
  const m = new Map();
  for (const x of A) m.set(x, (m.get(x) || 0) + 1);
  let inter = 0;
  for (const y of B) {
    const c = m.get(y) || 0;
    if (c > 0) {
      inter++;
      m.set(y, c - 1);
    }
  }
  return (2 * inter) / (A.length + B.length);
}
export function suggestNames(query, limit = 25) {
  const q = (query || '').trim();
  if (!q) return [];
  const lower = q.toLowerCase();
  const subs = allNames.filter((n) => n.toLowerCase().includes(lower));
  if (subs.length >= limit) return subs.slice(0, limit);
  const seen = new Set(subs);
  const fuzzy = allNames
    .filter((n) => !seen.has(n))
    .map((n) => [n, dice(lower, n)])
    .filter((x) => x[1] >= 0.2)
    .sort((a, b) => b[1] - a[1])
    .map((x) => x[0]);
  return [...subs, ...fuzzy].slice(0, limit);
}
export function categoryOf(name) {
  for (const [label, arr] of byCategory) if (arr.includes(name)) return label;
  return null;
}
// 戦闘力（attack）。不明なら null。
export function attackOf(name) {
  return attackByName.has(name) ? attackByName.get(name) : null;
}
// 戦闘力・レア度・価格などのメタ情報。不明なら null。
export function metaOf(name) {
  return metaByName.get(name) || null;
}
export function imageUrl(name) {
  const img = imageByName.get(name);
  return img ? CDN + img : null;
}
export function skinKeys(name) {
  const s = skinsByName.get(name);
  return s ? Object.keys(s) : [];
}
export function skinImage(name, key) {
  const s = skinsByName.get(name);
  if (s && s[key]) return CDN + s[key];
  return imageUrl(name);
}
