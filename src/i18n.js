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
  // ===== 抽選（プレゼント企画）=====
  gw_created: {
    ja: '✅ 抽選 #{id} を作ったよ！締切になったら自動で抽選＆発表するね。',
    en: '✅ Giveaway #{id} created! It will draw and announce automatically at the deadline.',
  },
  gw_bad_input: {
    ja: '⚠️ 当選人数は1〜20、締切は1〜336時間の**数字**で入れてね。',
    en: '⚠️ Winners must be 1–20 and the deadline 1–336 hours (numbers only).',
  },
  gw_post_fail: {
    ja: '❌ カードを投稿できなかった（このチャンネルでの送信権限を確認してね）。',
    en: '❌ Couldn’t post the card (check my permissions in this channel).',
  },
  gw_not_found: { ja: '⚠️ その抽選が見つからないよ。', en: '⚠️ Giveaway not found.' },
  gw_closed: {
    ja: '⌛ この抽選はもう締め切られてるよ。',
    en: '⌛ This giveaway is already closed.',
  },
  gw_rate: { ja: '⏳ 押すのが早すぎ！少し待ってね。', en: '⏳ Too fast — wait a moment.' },
  gw_too_new: {
    ja: '🔒 この抽選はアカウント作成から**{n}日以上**の人が対象だよ。',
    en: '🔒 This giveaway requires an account at least **{n} days** old.',
  },
  gw_already: {
    ja: '✅ もう参加してるよ！結果発表を待ってね。',
    en: '✅ You’re already entered! Wait for the results.',
  },
  gw_entered: {
    ja: '🎟️ エントリー完了！（現在 {n}人）結果発表を待ってね🍀',
    en: '🎟️ You’re in! ({n} entries) Good luck 🍀',
  },
  gw_no_winner: {
    ja: '⚠️ その抽選にはまだ当選者がいないよ（未抽選か、参加者0人だった）。',
    en: '⚠️ That giveaway has no winner yet (not drawn, or nobody entered).',
  },
  gw_reannounced: {
    ja: '📣 抽選 #{id} の結果をもう一度発表したよ。',
    en: '📣 Re-announced the result of giveaway #{id}.',
  },
  gw_ended: {
    ja: '🎬 抽選 #{id} を締め切ったよ！いま抽選して発表するね。',
    en: '🎬 Giveaway #{id} closed — drawing and announcing now.',
  },
  gw_cancelled: { ja: '🛑 抽選 #{id} を中止したよ（当選者なし）。', en: '🛑 Giveaway #{id} cancelled (no winner).' },

  // 出品者が退出＝取引ナシ。部屋は解散するが出品はリストに残る
  seller_left_room: {
    ja: '🚪 抜けたよ。この部屋は閉じるね（出品はリストに残ってるから、また誰か来たら取引できるよ）。',
    en: '🚪 You left — closing this room. Your listing stays in the feed for other buyers.',
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
  want_search: { ja: '相手のほしい物で探す', en: 'Search by what sellers want' },
  want_modal_title: { ja: '相手のほしい物で探す', en: 'Search by sellers’ wants' },
  want_modal_label: {
    ja: '相手が求めてるもの（自分が出せる物）',
    en: 'What the seller wants (what you can offer)',
  },
  want_results: { ja: '💱「{kw}」を求めてる出品 {n}件:', en: '💱 {n} listing(s) wanting “{kw}”:' },
  want_no_match: {
    ja: '💱「{kw}」を求めてる出品は今ないみたい。別のワードでも試してね。',
    en: '💱 No listings want “{kw}” right now. Try another keyword.',
  },

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

  // 出品カード送信失敗（孤児出品防止）
  post_fail: {
    ja: '❌ 出品カードの投稿に失敗したよ（権限/チャンネル設定を確認）。出品は登録されてないから、もう一度試してね。',
    en: '❌ Failed to post the listing card (check permissions/channel). Nothing was listed — please try again.',
  },

  // ウォッチリスト（📌 出品されたら通知）
  watch_button: { ja: '出品されたら通知', en: 'Notify me when listed' },
  watch_saved: {
    ja: '📌「{item}」をウォッチ登録したよ！出品されたら📋出品リストでお知らせするね（登録は最大{n}件・14日で自動解除）。',
    en: '📌 Watching “{item}”! You’ll be pinged in the feed when it’s listed (max {n} watches, auto-expires in 14 days).',
  },
  watch_limit: {
    ja: '⚠️ ウォッチは最大{n}件までだよ。通知が届くか、14日経つと枠が空くよ。',
    en: '⚠️ You can watch up to {n} items. A slot frees up when you get notified or after 14 days.',
  },

  // 両者✅（取引完了の相互確認）
  done_wait_partner: {
    ja: '✅ OK！**相手も✅を押すと成立**（実績カウント）だよ。30分間、毎分リマインドするね。押されなければ閉じるよ。',
    en: '✅ Got it! It completes & counts **when your partner also presses ✅** — I’ll remind them every minute for 30 min, then the room closes.',
  },
  done_already: {
    ja: '⏳ もう✅済みだよ。相手の✅待ち！',
    en: '⏳ You already pressed ✅ — waiting for your partner!',
  },

  // パーティ募集（⚔️ボス戦 / 🔮儀式）
  pty_panel_set: {
    ja: '✅ このチャンネルにパーティ募集パネルを設置したよ（募集カードと部屋もここにできる）。',
    en: '✅ Party Finder panel placed here (recruit cards & rooms will appear in this channel).',
  },
  pty_new_boss_title: { ja: '⚔️ ボス戦募集（8人パーティ）', en: '⚔️ Boss party (8 players)' },
  pty_new_ritual_title: { ja: '🔮 儀式募集', en: '🔮 Ritual party' },
  pty_m_fnid: { ja: 'フォートナイトID（部屋にだけ表示）', en: 'Fortnite ID (shown only in the room)' },
  pty_m_power: { ja: 'あなたの戦闘力', en: 'Your battle power' },
  pty_m_minpower: { ja: '参加条件の戦闘力（任意）', en: 'Min power to join (optional)' },
  pty_m_size: { ja: '募集人数（任意）', en: 'Party size (optional)' },
  pty_m_note: { ja: 'メモ（任意）', en: 'Note (optional)' },
  pty_ph_fnid: { ja: '例: brainrot_taro', en: 'e.g. brainrot_taro' },
  pty_ph_power: { ja: '例: 12000（全角・1.2万・12k もOK）', en: 'e.g. 12000 (12k also OK)' },
  pty_ph_minpower: { ja: '例: 8000（空欄＝誰でもOK）', en: 'e.g. 8000 (blank = anyone)' },
  pty_ph_size: { ja: '2〜8（空欄で4）', en: '2-8 (blank = 4)' },
  pty_ph_note: { ja: '例: 21時から！', en: 'e.g. from 9pm!' },
  pty_join_title: { ja: '🙋 パーティ #{id} に参加', en: '🙋 Join party #{id}' },
  pty_bad_power: {
    ja: '⚠️ 戦闘力が読み取れなかった…数字で入れてね（12000 / １２０００ / 1.2万 / 12k どれでもOK）。',
    en: '⚠️ Couldn’t read your battle power — try a number like 12000 or 12k.',
  },
  pty_exists: {
    ja: '⚠️ すでに募集中のパーティがあるよ。「📋マイ募集」から解散してから新しく募集してね。',
    en: '⚠️ You already have an open recruit. Disband it from 📋 Mine first.',
  },
  pty_created: {
    ja: '✅ 募集を出したよ！**参加者が来たら部屋ができて通知が飛ぶ**よ。取り下げは「📋マイ募集」からいつでも。',
    en: '✅ Recruit posted! **A room opens and pings you when someone joins.** Disband anytime from 📋 Mine.',
  },
  pty_create_fail: {
    ja: '❌ 募集の作成に失敗（権限を確認してね）。',
    en: '❌ Failed to create the recruit (check permissions).',
  },
  pty_room_fail: {
    ja: '❌ 部屋が作れなかった…（サーバーのスレッド枠が満杯かも）。少し待ってもう一度「🙋参加」してみてね。',
    en: '❌ Couldn’t open the room (server thread limit may be full). Please try joining again in a bit.',
  },
  pty_notfound: { ja: '⚠️ この募集は見つからなかった。', en: '⚠️ Recruit not found.' },
  pty_ended: { ja: '⚠️ この募集はもう終了してるよ。', en: '⚠️ This recruit has ended.' },
  pty_own: {
    ja: '⚠️ 自分の募集だよ！部屋で待ってれば参加者が来るよ。',
    en: '⚠️ This is your own recruit — wait in your room for joiners!',
  },
  pty_already: { ja: '✅ もう参加してるよ！部屋はこちら → {thread}', en: '✅ Already in! Room → {thread}' },
  pty_full_ep: {
    ja: '😢 満員だったよ…また次の募集でね！',
    en: '😢 That party just filled up… catch the next one!',
  },
  pty_minpower: {
    ja: '⚠️ この募集は ⚔️{min} 以上が条件だよ（あなた: {p}）。',
    en: '⚠️ This party requires ⚔️{min}+ (you: {p}).',
  },
  pty_joined: {
    ja: '🙋 参加したよ！部屋でフレンドID交換してね → {thread}',
    en: '🙋 Joined! Swap Fortnite IDs in the room → {thread}',
  },
  pty_host_only: { ja: '⚠️ ホストだけが押せるよ。', en: '⚠️ Only the host can do that.' },
  pty_done: { ja: '🎉 マッチ完了！おつかれ！', en: '🎉 Matched! Have fun!' },
  pty_left: { ja: '👋 抜けたよ。', en: '👋 You left the party.' },
  pty_host_cant_leave: {
    ja: '⚠️ ホストは退出できないよ。解散するなら「✅マッチ完了」を押してね。',
    en: '⚠️ The host can’t leave — tap ✅ Done to disband.',
  },
  pty_mine_none: { ja: '募集中のパーティはないよ。', en: 'You have no open recruits.' },
  pty_mine_count: { ja: 'あなたの募集 {n}件:（⬆️で最下部に上げ直し＝埋もれ対策）', en: 'Your recruits ({n}): (⬆️ bumps the card to the bottom)' },
  pty_disband: { ja: '#{id} を解散', en: 'Disband #{id}' },
  pty_bump: { ja: '#{id} を上へ', en: 'Bump #{id}' },
  pty_bumped: {
    ja: '⬆️ カードを最新の位置に上げ直したよ！',
    en: '⬆️ Your recruit card was bumped to the bottom!',
  },
  pty_bump_rate: {
    ja: '⚠️ 上げ直しは10分に1回までだよ。',
    en: '⚠️ You can bump once every 10 minutes.',
  },
  pty_find_none: {
    ja: '🔍 いま参加できる募集はないよ。「⚔️/🔮」ボタンで最初のホストになろう！',
    en: '🔍 No open recruits right now — be the first host with ⚔️/🔮!',
  },
  pty_find_header_p: {
    ja: '🔍 参加できる募集 {n}件（あなたの⚔️{p}に近い順・埋まりかけ優先）:',
    en: '🔍 {n} open recruit(s), sorted by closeness to your ⚔️{p}:',
  },
  pty_find_header: {
    ja: '🔍 参加できる募集 {n}件（埋まりかけ優先）:',
    en: '🔍 {n} open recruit(s):',
  },
  pty_pick_join: { ja: '参加する募集を選ぶ', en: 'Pick a recruit to join' },
  pty_pick_ritual: { ja: '召喚したいキャラを選ぶ', en: 'Pick a character to summon' },
  pty_ritual_intro: {
    ja: '🔮 どのキャラの儀式？（持ち寄りで召喚するキャラを選んでね）',
    en: '🔮 Which ritual? Pick the character to summon together.',
  },
  pty_no_ritual: {
    ja: '⚠️ 儀式キャラのリストが読み込めなかった（図鑑を確認してね）。',
    en: '⚠️ Couldn’t load the ritual character list (check the catalog).',
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
