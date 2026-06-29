// 多言語化（ローカライズ）。
// ・本人だけに見えるエフェメラル応答 → interaction.locale で日/英を出し分け
// ・全員が見る共有メッセージ → 別途「日英併記」の定数を使う（混在環境なので片方に寄せない）
export function L(locale) {
  return (locale || '').toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

const D = {
  // ピッカー入口
  pick_category: {
    ja: '🟢 出すもの：カテゴリを選ぶ／または「名前で検索」',
    en: '🟢 Offering: pick a category / or “Search by name”',
  },
  cat_placeholder: { ja: 'カテゴリを選ぶ', en: 'Pick a category' },
  catalog_empty: { ja: '（図鑑未読込）', en: '(catalog not loaded)' },
  search_by_name: { ja: '名前で検索', en: 'Search by name' },
  back_category: { ja: '🔙カテゴリ', en: '🔙 Categories' },

  // 名前検索
  name_modal_title: { ja: '名前で検索', en: 'Search by name' },
  name_modal_label: { ja: 'アイテム名（一部でOK）', en: 'Item name (partial OK)' },
  no_match: {
    ja: '🔍 一致なし。別のワードで「名前で検索」してね。',
    en: '🔍 No match. Try another keyword with “Search by name”.',
  },
  pick_from_results: { ja: '検索結果から選ぶ', en: 'Pick from results' },
  results_count: { ja: '🔍 検索結果 {n}件', en: '🔍 {n} result(s)' },

  // アイテム一覧
  item_placeholder: { ja: 'アイテムを選ぶ', en: 'Pick an item' },
  search_fast: { ja: '名前で探す（早い！）', en: 'Search by name (fast!)' },
  more_next: { ja: '　▶ボタンで次の{n}体', en: '　▶ for next {n}' },
  item_list_content: {
    ja: '**{rarity}**：全{total}体（{p}/{pages}ページ）{more}\n名前が分かるなら🔍が一番早いよ！',
    en: '**{rarity}**: {total} total ({p}/{pages}){more}\nIf you know the name, 🔍 is fastest!',
  },

  // アイテム確認ウィンドウ
  item_window_desc: {
    ja: '変異・★・特性は任意（選ばずに出品OK／特性の詳細は取引ルームで）',
    en: 'Mutation / ★ / traits are optional (you can post without them; trait details in the trade room)',
  },
  field_want: { ja: '⬇️ ほしいもの', en: '⬇️ Want' },
  field_note: { ja: '📝 メモ', en: '📝 Note' },
  skin_optional: { ja: '変異（任意）', en: 'Mutation (optional)' },
  skin_chosen: { ja: '変異: {x}', en: 'Mutation: {x}' },
  star_optional: { ja: '★ 濃縮（任意）', en: '★ Stars (optional)' },
  star_chosen: { ja: '★{n}', en: '★{n}' },
  star_none: { ja: '★なし', en: 'No ★' },
  star_max: { ja: '★5（最大）', en: '★5 (max)' },
  trait_optional: {
    ja: '特性の数（任意・詳細は部屋で）',
    en: 'Number of traits (optional; details in room)',
  },
  trait_chosen: { ja: '特性{n}個', en: '{n} trait(s)' },
  trait_none: { ja: '特性なし', en: 'No traits' },
  trait_n: { ja: '{n}個', en: '{n}' },
  btn_post: { ja: '出品する', en: 'Post' },
  btn_wantmemo: { ja: 'ほしいもの/メモ', en: 'Want / Note' },
  btn_reselect: { ja: '🔙選び直す', en: '🔙 Reselect' },

  // ほしいもの・メモ モーダル
  wantmemo_title: { ja: 'ほしいもの・メモ', en: 'Want / Note' },
  want_label: { ja: 'ほしいもの・取引条件（任意）', en: 'What you want / terms (optional)' },
  note_label: { ja: 'メモ（任意）', en: 'Note (optional)' },

  // セッション・出品
  expired: {
    ja: '⌛ セッション切れ。もう一度「🟢出品する」を押してね。',
    en: '⌛ Session expired. Press “🟢 Post” again.',
  },
  need_give: { ja: '⚠️ 出すものを選んでね。', en: '⚠️ Please pick what you’re offering.' },
  posted: { ja: '✅ 出品 #{id} を登録したよ！', en: '✅ Listing #{id} posted!' },

  // さがす
  search_modal_title: { ja: 'ほしいモノを探す', en: 'Find what you want' },
  search_modal_label: { ja: 'ほしいアイテム名', en: 'Item name you want' },
  search_none: { ja: '🔍「{kw}」の出品は今ないみたい。', en: '🔍 No listings for “{kw}” right now.' },
  search_hits: { ja: '🔍「{kw}」の出品 {n}件:', en: '🔍 {n} listing(s) for “{kw}”:' },
  use_button_to_trade: { ja: '（下のボタンで取引）', en: '(use the button below to trade)' },

  // マイ出品
  mine_none: { ja: '今アクティブな出品はないよ。', en: 'You have no active listings.' },
  mine_count: { ja: 'あなたの出品 {n}件:', en: 'Your listings ({n}):' },
  withdraw: { ja: '#{id} を取り下げ', en: 'Withdraw #{id}' },

  // 取引（エフェメラル）
  listing_ended: { ja: '⚠️ この出品はもう終了してるみたい。', en: '⚠️ This listing has ended.' },
  room_here: { ja: '🤝 取引ルームはこちら → {thread}', en: '🤝 Trade room → {thread}' },
  own_listing: {
    ja: '⚠️ 自分の出品だよ。買い手が押すとルームができるよ。',
    en: '⚠️ This is your own listing. A buyer presses it to open a room.',
  },
  cant_make_room: {
    ja: '⚠️ ここでは取引ルームを作れない（通常テキストで押してね）。',
    en: '⚠️ Can’t create a room here (press it in a normal text channel).',
  },
  room_created: { ja: '🤝 取引ルーム作成！ {thread}', en: '🤝 Trade room created! {thread}' },
  room_fail: {
    ja: '❌ 取引ルームの作成に失敗（権限を確認してね）。',
    en: '❌ Failed to create the trade room (check permissions).',
  },
  room_busy: {
    ja: '⏳ いま誰かが取引ルームを作成中…数秒待ってもう一度押してね。',
    en: '⏳ A room is being created right now… wait a few seconds and press again.',
  },
  left_room: { ja: '👋 退出したよ。', en: '👋 You left the room.' },
  seller_cant_leave: {
    ja: '⚠️ 出品者は退出できないよ。終わったら「✅取引完了」を押してね。',
    en: '⚠️ The seller can’t leave. Press “✅ Done” when finished.',
  },
  relisted: {
    ja: '🔁 同じ条件で再出品したよ！（#{id}）出品リストの最新に出たよ。',
    en: '🔁 Re-listed with the same details! (#{id}) It’s now at the top of the feed.',
  },
  relist_not_yours: {
    ja: '⚠️ これはあなたの出品じゃないよ。',
    en: '⚠️ This listing isn’t yours.',
  },
  relist_fail: {
    ja: '⚠️ 再出品できなかった（元の出品が見つからない／フィード未設定）。',
    en: '⚠️ Couldn’t re-list (original not found / feed not set).',
  },
  listing_not_found: { ja: '⚠️ この出品は見つからなかった。', en: '⚠️ Listing not found.' },
  only_own: { ja: '⚠️ 自分の出品だけ操作できるよ。', en: '⚠️ You can only manage your own listing.' },
  deal_done: {
    ja: '✅ 取引完了！おつかれ🎉 この部屋は閉じるね。',
    en: '✅ Trade complete! Nice 🎉 Closing this room.',
  },
  withdrawn: { ja: '🗑️ 出品 #{id} を取り下げたよ。', en: '🗑️ Listing #{id} withdrawn.' },

  // 探す（ピッカー型）
  search_pick_category: {
    ja: '🔍 ほしいモノ：カテゴリを選ぶ／または「名前で検索」',
    en: '🔍 What you want: pick a category / or “Search by name”',
  },
  search_results_for: { ja: '🔍 {item} の出品 {n}件:', en: '🔍 {n} listing(s) for {item}:' },
  search_similar: {
    ja: '🔍 {item} のぴったりは無いけど、近い出品だよ:',
    en: '🔍 No exact match for {item} — similar listings:',
  },
  search_empty: {
    ja: '😢 {item} はまだ出品がないみたい。「🟢出品する」で最初の出品者になろう！（この需要は記録したよ）',
    en: '😢 No listings for {item} yet. Be the first with “🟢 Post”! (your demand was recorded)',
  },
  pick_deal: { ja: '取引する出品を選ぶ', en: 'Pick a listing to trade' },
  power_label: { ja: '⚔️ 戦闘力', en: '⚔️ Power' },

  // ランキング
  btn_ranking: { ja: 'ランキング / Ranking', en: 'ランキング / Ranking' },
  ranking_title: { ja: '📊 取引人気ランキング / Trade Ranking', en: '📊 Trade Ranking / 取引人気ランキング' },
  rank_supply: { ja: '⬆️ よく出品されてる / Most listed', en: '⬆️ Most listed / よく出品' },
  rank_demand: { ja: '⬇️ よく求められてる / Most wanted', en: '⬇️ Most wanted / よく求められてる' },
  rank_empty: { ja: '（まだデータなし）', en: '(no data yet)' },
  rank_hint: {
    ja: '※「ほしいモノを探す」で選ぶと需要に反映されるよ',
    en: '※ Picking items in “Find” feeds the demand ranking',
  },

  // 荒らし対策
  rl_listing: {
    ja: '⚠️ 出品が早すぎ！ちょっと待ってからにしてね。',
    en: '⚠️ Posting too fast! Please wait a moment.',
  },
  rl_room: {
    ja: '⚠️ 取引ルームを開きすぎ！ちょっと待ってね。',
    en: '⚠️ Opening rooms too fast! Please wait a moment.',
  },
  cap_listing: {
    ja: '📦 出品数が多すぎます！（最大{n}件）\n下の出品を🗑️で取り下げてから、もう一度出品してね👇',
    en: '📦 Too many listings! (max {n})\nWithdraw one below with 🗑️, then post again 👇',
  },
  bad_url: {
    ja: '⚠️ リンクやURLは貼れないよ（詐欺防止）。詳しい話は取引ルームでね。',
    en: '⚠️ Links/URLs aren’t allowed (anti-scam). Discuss details in the trade room.',
  },
  bad_word: {
    ja: '⚠️ その言葉は使えないみたい。別の書き方にしてね。',
    en: '⚠️ That wording isn’t allowed. Please rephrase.',
  },

  // 運営
  panel_set: {
    ja: '✅ このチャンネルに操作パネルを設置したよ（出品はフィードへ流れる）。',
    en: '✅ Control panel placed here (listings go to the feed channel).',
  },
  feed_set: {
    ja: '✅ このチャンネルを「出品フィード」に設定したよ。今後の出品カードはここに流れる。',
    en: '✅ This channel is now the listings feed. New listing cards will be posted here.',
  },
};

export function t(locale, key, vars) {
  const lang = L(locale);
  let s = (D[key] && (D[key][lang] ?? D[key].ja)) ?? key;
  if (vars) for (const k in vars) s = s.split(`{${k}}`).join(String(vars[k]));
  return s;
}
