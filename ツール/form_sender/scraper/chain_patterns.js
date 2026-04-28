// チェーンパターン定義 — 施設名またはHP_URLにパターンが含まれる場合、対応するフォームURLを割り当てる
// match 配列に新しいパターンを追加するだけで拡張可能

module.exports = [
  {
    match: ['benesse', 'ベネッセ', 'アリア', 'くらら', 'グランダ', 'benesse-style-care'],
    formUrl: null,
    status: '手動対応',
  },
  {
    match: ['gtl-daiwa', 'グッドタイムリビング', 'グッドタイム'],
    formUrl: 'https://www.gtl-daiwa.co.jp/dc/request/index.php',
  },
  {
    match: ['nichiigakkan', 'ニチイホーム', 'ニチイ学館'],
    formUrl: 'https://pages.nichiigakkan.co.jp/palace_inquiryform_new.html',
  },
  {
    match: ['charm-cc', 'charmcc', 'チャームケアコーポレーション', 'チャームプレミア', 'チャーム'],
    formUrl: 'https://www.charm-cc.jp/inquiry/',
  },
  {
    match: ['kinoshita-kaigo', '木下の介護'],
    formUrl: 'https://www.kinoshita-kaigo.co.jp/contact/',
  },
  {
    match: ['tsukui.net', 'ツクイ'],
    formUrl: 'https://www.tsukui.net/contact/',
  },
];
