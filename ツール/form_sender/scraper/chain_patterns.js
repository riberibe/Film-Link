// チェーンパターン定義 — 施設名またはHP_URLにパターンが含まれる場合、対応するフォームURL/HP URLを割り当てる
// match 配列に新しいパターンを追加するだけで拡張可能
// hpUrl があれば HP_URL カラムにも反映される（チェーン本部のサイト）

module.exports = [
  {
    match: ['benesse', 'ベネッセ', 'アリア', 'くらら', 'グランダ', 'まどか', 'リハビリホーム', 'メディカルホーム', 'benesse-style-care'],
    hpUrl: 'https://kaigo.benesse-style-care.co.jp/',
    formUrl: null,
    status: '手動対応',
  },
  {
    match: ['gtl-daiwa', 'グッドタイムリビング', 'グッドタイム'],
    hpUrl: 'https://www.gtl-daiwa.co.jp/',
    formUrl: 'https://www.gtl-daiwa.co.jp/dc/request/index.php',
  },
  {
    match: ['nichiigakkan', 'ニチイホーム', 'ニチイ学館'],
    hpUrl: 'https://www.nichiigakkan.co.jp/',
    formUrl: 'https://pages.nichiigakkan.co.jp/palace_inquiryform_new.html',
  },
  {
    match: ['charm-cc', 'charmcc', 'チャームケアコーポレーション', 'チャームプレミア', 'チャーム'],
    hpUrl: 'https://www.charm-cc.jp/',
    formUrl: 'https://www.charm-cc.jp/inquiry/',
  },
  {
    match: ['kinoshita-kaigo', '木下の介護'],
    hpUrl: 'https://www.kinoshita-kaigo.co.jp/',
    formUrl: 'https://www.kinoshita-kaigo.co.jp/contact/',
  },
  {
    match: ['tsukui.net', 'ツクイ'],
    hpUrl: 'https://www.tsukui.net/',
    formUrl: 'https://www.tsukui.net/contact/',
  },
  {
    match: ['bestlife', 'ベストライフ'],
    hpUrl: 'https://www.bestlife.ne.jp/',
    formUrl: 'https://www.bestlife.ne.jp/contact/',
  },
  {
    match: ['supercourt', 'スーパー・コート', 'スーパーコート'],
    hpUrl: 'https://www.supercourt.jp/',
    formUrl: 'https://www.supercourt.jp/contact/',
  },
  {
    match: ['welfare', 'うぇるふぇあ', 'ウェルフェア'],
    hpUrl: 'https://www.wel-fare.jp/',
    formUrl: 'https://www.wel-fare.jp/contact/',
  },
  {
    match: ['リアンレーヴ', 'rian-reve', 'medical-care-service', 'mcsg'],
    hpUrl: 'https://www.mcsg.co.jp/',
    formUrl: 'https://www.mcsg.co.jp/contact/',
  },
  {
    match: ['エイジフリー', 'agefree', 'panasonic.co.jp/ew/agefree', 'パナソニック エイジフリー'],
    hpUrl: 'https://sumai.panasonic.jp/agefree/',
    formUrl: 'https://sumai.panasonic.jp/agefree/contact/',
  },
  {
    match: ['さくらの杜', 'sakuranomori'],
    formUrl: null,
    status: '手動対応',
  },
];
