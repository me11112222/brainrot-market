// 検索用テキスト正規化（catalog / db 共用）。
// 子供の入力ゆらぎを最大限吸収する:
//   ・全角英数字→半角（ＳＵＮＮＹ→sunny）・半角ｶﾅ→全角（NFKC）
//   ・大文字小文字を同一視
//   ・スペース/記号を除去（La Secret → lasecret）
//   ・ひらがな→カタカナ（さにー → サニー）
//   ・長音「ー」を除去（サニー/サニの表記ゆらぎ吸収）
export function norm(s) {
  let t = String(s || '')
    .normalize('NFKC')
    .toLowerCase();
  t = t.replace(/[\s\-_.'’!！?？・、。，,「」『』【】\[\]()（）&＆+＋:：;；~〜]/g, '');
  // ひらがな(ぁ..ゖ) → カタカナ
  t = t.replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));
  t = t.replace(/ー/g, '');
  return t;
}
