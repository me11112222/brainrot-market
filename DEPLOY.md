# BrainrotBot マーケット 本番デプロイ手順（GCP e2-micro 相乗り）

INDEX BOT(Python) が動いている既存の GCP 無料VMに、このNodeマーケットbotを**もう1サービス**として相乗りさせる。Railwayは不要。

---

## 0. 前提
- VMに INDEX BOT が systemd `brainrot-bot` で稼働中（= Python）。
- 図鑑 `characters.json` はVM上に存在（INDEX BOTのクローン内 or GitHubから取得）。
- このNodeリポを GitHub に上げてある（手順1）。
- **トークンは絶対にコミットしない**（`.gitignore`で `.env` `*.sqlite` 除外済み）。

## 1. GitHubに上げる（ローカルPCで1回）
```bash
cd C:/Users/reje/brainrot-bot
git init
git add .
git commit -m "Marketplace bot: picker, i18n, ranking, moderation, scale hardening"
# 例: 新規プライベートリポを作成（gh CLI）
gh repo create brainrot-market --private --source=. --push
```
※ `.env` と `data.sqlite` はコミットされない（.gitignore済）。要確認: `git status` に出ないこと。

## 2. VMに Node 22+ を導入（node:sqlite が 22.5+ 必須）
```bash
# NodeSource (Debian/Ubuntu系)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # v22.x 以上を確認
which node # ExecStart に使うパス（通常 /usr/bin/node）
```

## 3. クローン & 依存インストール
```bash
cd ~
git clone https://github.com/me11112222/brainrot-market.git
cd brainrot-market
npm install --omit=dev   # 実行に @napi-rs/canvas は不要だが入っても可
```

## 4. .env を作成（トークンは手で貼る）
```bash
cp .env.example .env
nano .env
```
- `DISCORD_TOKEN=` … BrainrotBotのトークン
- `CLIENT_ID=1520867492925276180`
- `GUILD_ID=1456356183613898803`  ← 本番(ブレインロットファイト)に固定
- `CATALOG_PATH=/home/USER/brainrot-bot/characters.json`  ← INDEX BOTの図鑑を指す（USERは実ユーザー名）

## 5. 単体起動テスト
```bash
node src/index.js
# 「✅ログイン成功」「📚図鑑取込: 244件」「🛒…起動」が出ればOK。Ctrl+Cで止める
```
※図鑑が0件なら CATALOG_PATH を見直す。

## 6. systemd 常駐化
```bash
sudo cp deploy/brainrot-market.service /etc/systemd/system/
sudo nano /etc/systemd/system/brainrot-market.service
#   WorkingDirectory と ExecStart のパスを実環境に合わせる（USER名・nodeパス）
sudo systemctl daemon-reload
sudo systemctl enable --now brainrot-market
systemctl status brainrot-market   # active (running) を確認
journalctl -u brainrot-market -f   # ログ追尾
```
更新時: `cd ~/brainrot-market && git pull && sudo systemctl restart brainrot-market`

## 7. 本番サーバーへ招待（ブラウザでオーナーが承認）
スコープ付き（推奨）:
```
https://discord.com/oauth2/authorize?client_id=1520867492925276180&scope=bot+applications.commands&permissions=9157944306688
```

## 8. 絵文字242体を投入（VM or ローカルから1回）
```bash
DOTENV_CONFIG_PATH=./.env node scripts/upload-emojis.js 1456356183613898803
```
- レート制限でトリクルするが、枠があるので完走する。
- ⚠️ 以前NONEに上げた分のIDがDBに残っている場合は、先に `emojis` テーブルをクリアしてから実行（本番IDで取り直すため）。

## 9. パネル設置 & 運用
- 募集チャンネルで `/パネル設置`（運営のみ可）→ スティッキーで最下部常駐。
- 旧フォーラム（交換募集/ボス戦募集）は段階的に読み取り専用→アーカイブへ。

## メモリ（e2-micro 1GB）
- Python版 + Node版 の2本。Node側はメンバー非キャッシュ＋sweeper済みで軽量。
- 逼迫したら `journalctl` で監視し、必要なら片方をスワップ運用 or インスタンス格上げ。
