// data.sqlite の安全なバックアップ（稼働中でもOK）
// VACUUM INTO を使う＝WALモードのままbot稼働中に実行しても整合性の取れたコピーが作れる。
// 出力は曜日名で上書き（data-Mon.sqlite 等）＝自動で7世代ローテ。
//
// 使い方: node scripts/backup-db.js [DBパス] [出力ディレクトリ]
//   省略時: DB=リポジトリ直下の data.sqlite / 出力=~/backups
// systemd timer からの想定実行: deploy/brainrot-backup.{service,timer} 参照
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, unlinkSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = resolve(process.argv[2] || join(__dirname, '..', 'data.sqlite'));
const outDir = resolve(process.argv[3] || join(homedir(), 'backups'));

if (!existsSync(src)) {
  console.error(`❌ DBが見つからない: ${src}`);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date().getDay()];
const out = join(outDir, `data-${day}.sqlite`);
if (existsSync(out)) unlinkSync(out); // VACUUM INTO は既存ファイルに書けないので先に消す

const db = new DatabaseSync(src);
try {
  db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
} finally {
  db.close();
}
const kb = Math.round(statSync(out).size / 1024);
console.log(`✅ バックアップ完了: ${out} (${kb} KB)`);
