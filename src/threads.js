// スレッド（取引ルーム・パーティ部屋）の後始末。
//
// ギルド全体で同時に開けるスレッドは1000本まで＝マーケットとパーティが共有する固定資源。
// 部屋を閉じる時はDBの行を先に消すので、スレッドの削除に失敗すると誰も再試行せず、
// スレッドだけが枠に残り続ける。閉じる直前にお知らせを投稿している関係で
// 「最後の発言が新しい」状態になり、Discordの自動アーカイブにも当たらない。
// 2026-08-06 にボス戦の部屋が586本まで積み上がったのはこれが原因。
export function closeThreadSoon(thread, delayMs = 5000) {
  if (!thread) return;
  setTimeout(async () => {
    try {
      await thread.delete();
    } catch (e) {
      // 消せない時（レート制限・権限など）でも、アーカイブすれば枠は返る
      console.error(
        'スレッド削除に失敗→アーカイブで枠を返す:',
        e?.rawError?.message || e?.message || e,
      );
      await thread.setArchived(true).catch(() => {});
    }
  }, delayMs);
}
