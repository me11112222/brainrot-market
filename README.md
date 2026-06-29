# BrainrotBot 🤖

ブレインロットファイト【Fight the BRAINROT】用の自作Discord Bot。

## 目的（ロードマップ）
- **Phase 0**: 基盤（起動・スラッシュコマンド）← 今ここ
- **Phase 1**: マッチング型マーケットプレイス（出品/探す/マッチ）→ スレッド1000上限の根本解決
- **Phase 2**: レベル/ランク（`/rank` `/leaderboard`）
- later: 進捗バー / 35k達成演出 / 招待ランキング

## 技術
Node.js + discord.js v14 / 本番ホスティング: Railway

## セットアップ（ローカルテスト）
1. `.env.example` をコピーして `.env` を作成し、値を埋める
   - `DISCORD_TOKEN`: Developer Portal の Bot トークン（秘密）
   - `CLIENT_ID`: アプリID（設定済み）
   - `GUILD_ID`: テストサーバー(NONE)のID
2. 依存をインストール: `npm install`
3. 起動: `npm start`
4. Discordで `/ping` → `pong` が返ればOK

## デプロイ（本番 / Railway）
1. このリポジトリをGitHubにpush
2. Railway → Deploy from GitHub
3. 環境変数（DISCORD_TOKEN等）をRailwayに設定
4. デプロイ → 24時間稼働
