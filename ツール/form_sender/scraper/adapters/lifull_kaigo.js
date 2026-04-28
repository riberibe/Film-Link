// LIFULL介護スクレイパー
// 正しいURL: https://kaigo.homes.co.jp/s/list/ad11={pref_code}/
// ページネーション: /s/list/ad11=13/page=2/ の形式

const BASE_URL = 'https://kaigo.homes.co.jp';

// JIS都道府県コード（数値のみ・ゼロパディングなし）
const PREF_CODES = {
  '北海道': '1',  '青森県': '2',  '岩手県': '3',  '宮城県': '4',
  '秋田県': '5',  '山形県': '6',  '福島県': '7',  '茨城県': '8',
  '栃木県': '9',  '群馬県': '10', '埼玉県': '11', '千葉県': '12',
  '東京都': '13', '神奈川県': '14','新潟県': '15', '富山県': '16',
  '石川県': '17', '福井県': '18', '山梨県': '19', '長野県': '20',
  '岐阜県': '21', '静岡県': '22', '愛知県': '23', '三重県': '24',
  '滋賀県': '25', '京都府': '26', '大阪府': '27', '兵庫県': '28',
  '奈良県': '29', '和歌山県': '30','鳥取県': '31', '島根県': '32',
  '岡山県': '33', '広島県': '34', '山口県': '35', '徳島県': '36',
  '香川県': '37', '愛媛県': '38', '高知県': '39', '福岡県': '40',
  '佐賀県': '41', '長崎県': '42', '熊本県': '43', '大分県': '44',
  '宮崎県': '45', '鹿児島県': '46','沖縄県': '47',
};

// 名前テキストから施設名・都道府県・市区町村を分離する
// 例: "東急ウェリナケア旗の台 東京都大田区介護付き有料老人ホーム"
//      → name="東急ウェリナケア旗の台", pref="東京都", city="大田区"
function parseFacilityName(rawText) {
  const text = rawText.replace(/\s+/g, ' ').trim();
  const prefMatch = text.match(/(東京都|大阪府|京都府|北海道|.{2,3}[都道府県])/);
  if (!prefMatch) return { name: text, pref: '', city: '' };

  const prefIndex = text.indexOf(prefMatch[0]);
  const name = text.slice(0, prefIndex).trim();
  const rest = text.slice(prefIndex + prefMatch[0].length);
  const cityMatch = rest.match(/^(.+?[区市町村])/);
  const city = cityMatch ? cityMatch[1] : '';

  return { name, pref: prefMatch[0], city };
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

class LifullKaigoAdapter {
  constructor(browser) {
    this.browser = browser;
  }

  async fetchList({ pref, limit }) {
    const prefEntries = pref
      ? [[pref, PREF_CODES[pref]]].filter(([, code]) => code)
      : Object.entries(PREF_CODES);

    if (pref && !PREF_CODES[pref]) {
      throw new Error(`都道府県 "${pref}" はPREF_CODESに見つかりません`);
    }

    const facilities = [];
    for (const [prefName, prefCode] of prefEntries) {
      if (facilities.length >= limit) break;
      const items = await this._scrapePrefecture(prefName, prefCode, limit - facilities.length);
      facilities.push(...items);
    }
    return facilities.slice(0, limit);
  }

  async _scrapePrefecture(prefName, prefCode, remaining) {
    const page = await this.browser.newPage();
    const facilities = [];

    try {
      let pageNum = 1;

      while (facilities.length < remaining) {
        // 1ページ目: /s/list/ad11=13/
        // 2ページ目以降: /s/list/ad11=13/page=2/
        const url = pageNum === 1
          ? `${BASE_URL}/s/list/ad11=${prefCode}/`
          : `${BASE_URL}/s/list/ad11=${prefCode}/page=${pageNum}/`;

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await sleep(1500);

        // 施設カード（Promotionカードは除く）
        const items = await page.$$eval(
          'div.mod-facilityCassette',
          (els, base) => els
            .filter(el => !el.className.includes('Promotion'))
            .map(el => {
              const nameEl = el.querySelector('.fnameWrap a, [class*="fname"] a');
              if (!nameEl) return null;
              const rawText = nameEl.textContent.trim();
              const href = nameEl.getAttribute('href') || '';
              return {
                rawText,
                detailUrl: href.startsWith('http') ? href : base + href,
              };
            }).filter(Boolean),
          BASE_URL
        ).catch(() => []);

        if (items.length === 0) {
          await page.screenshot({ path: `./scraper_debug_pref${prefCode}_p${pageNum}.png` }).catch(() => {});
          console.error(`\n  警告: LIFULL ${url} で施設が0件でした。`);
          break;
        }

        for (const item of items) {
          const { name, pref, city } = parseFacilityName(item.rawText);
          if (!name) continue;
          facilities.push({
            name,
            pref: pref || prefName,
            city,
            cost: '',
            detailUrl: item.detailUrl,
          });
          if (facilities.length >= remaining) break;
        }

        // 次ページの確認
        const hasNext = await page.$('a:text("次へ"), [rel="next"]').catch(() => null);
        if (!hasNext || facilities.length >= remaining) break;

        pageNum++;
        await sleep(1500);
      }
    } catch (err) {
      console.error(`\n  LIFULL ${prefName} リスト取得エラー: ${err.message.split('\n')[0]}`);
    } finally {
      await page.close();
    }

    return facilities;
  }

  // LIFULL詳細ページには公式HP URLが掲載されないため、
  // detailUrl（LIFULLページ）をhpUrlとして使用する
  async fetchDetail(facility) {
    return {
      name: facility.name,
      pref: facility.pref,
      city: facility.city,
      cost: facility.cost || '',
      hpUrl: facility.detailUrl,
    };
  }
}

module.exports = LifullKaigoAdapter;
