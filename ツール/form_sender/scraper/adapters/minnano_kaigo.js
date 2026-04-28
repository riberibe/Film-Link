// みんなの介護スクレイパー
// 正しいURL構造:
//   都道府県: https://www.minnanokaigo.com/search/tokyo/
//   市区町村: https://www.minnanokaigo.com/search/tokyo/shinjuku-ku/
//   ページネーション: https://www.minnanokaigo.com/search/tokyo/shinjuku-ku/page2/
//
// 動作:
//   1. 都道府県ページから市区町村リンクを動的に取得
//   2. 各市区町村ページを巡回して施設リンクを収集
//   3. 施設詳細ページから公式HP_URLを取得

const BASE_URL = 'https://www.minnanokaigo.com';

// みんなの介護の都道府県URLスラッグ
const PREF_SLUGS = {
  '北海道': 'hokkaido',   '青森県': 'aomori',    '岩手県': 'iwate',
  '宮城県': 'miyagi',     '秋田県': 'akita',      '山形県': 'yamagata',
  '福島県': 'fukushima',  '茨城県': 'ibaraki',    '栃木県': 'tochigi',
  '群馬県': 'gunma',      '埼玉県': 'saitama',    '千葉県': 'chiba',
  '東京都': 'tokyo',      '神奈川県': 'kanagawa', '新潟県': 'niigata',
  '富山県': 'toyama',     '石川県': 'ishikawa',   '福井県': 'fukui',
  '山梨県': 'yamanashi',  '長野県': 'nagano',     '岐阜県': 'gifu',
  '静岡県': 'shizuoka',   '愛知県': 'aichi',      '三重県': 'mie',
  '滋賀県': 'shiga',      '京都府': 'kyoto',      '大阪府': 'osaka',
  '兵庫県': 'hyogo',      '奈良県': 'nara',       '和歌山県': 'wakayama',
  '鳥取県': 'tottori',    '島根県': 'shimane',    '岡山県': 'okayama',
  '広島県': 'hiroshima',  '山口県': 'yamaguchi',  '徳島県': 'tokushima',
  '香川県': 'kagawa',     '愛媛県': 'ehime',      '高知県': 'kochi',
  '福岡県': 'fukuoka',    '佐賀県': 'saga',       '長崎県': 'nagasaki',
  '熊本県': 'kumamoto',   '大分県': 'oita',       '宮崎県': 'miyazaki',
  '鹿児島県': 'kagoshima','沖縄県': 'okinawa',
};

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

class MinnanoKaigoAdapter {
  constructor(browser) {
    this.browser = browser;
  }

  async fetchList({ pref, limit }) {
    const prefEntries = pref
      ? [[pref, PREF_SLUGS[pref]]].filter(([, slug]) => slug)
      : Object.entries(PREF_SLUGS);

    if (pref && !PREF_SLUGS[pref]) {
      throw new Error(`都道府県 "${pref}" はPREF_SLUGSに見つかりません`);
    }

    const facilities = [];
    for (const [prefName, prefSlug] of prefEntries) {
      if (facilities.length >= limit) break;
      const items = await this._scrapePrefecture(prefName, prefSlug, limit - facilities.length);
      facilities.push(...items);
    }
    return facilities.slice(0, limit);
  }

  // 都道府県ページから市区町村リンクを取得し、各市区町村を巡回する
  async _scrapePrefecture(prefName, prefSlug, remaining) {
    const page = await this.browser.newPage();
    const facilities = [];

    try {
      const prefUrl = `${BASE_URL}/search/${prefSlug}/`;
      await page.goto(prefUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await sleep(2000);

      // 市区町村リンクを取得
      const cityLinks = await page.$$eval('a[href]', (links, base, slug) =>
        links
          .filter(a => {
            const href = a.href || '';
            return href.includes(`/search/${slug}/`) &&
                   href !== `${base}/search/${slug}/` &&
                   !href.includes('/page') &&
                   !href.includes('/kaigotsuki') &&
                   !href.includes('/jyuutaku');
          })
          .map(a => a.href)
          .filter((v, i, arr) => arr.indexOf(v) === i), // 重複除去
        BASE_URL, prefSlug
      ).catch(() => []);

      if (cityLinks.length === 0) {
        console.error(`\n  みんなの介護: ${prefName} の市区町村リンクが取得できませんでした。`);
        return [];
      }

      // 各市区町村ページを巡回
      for (const cityUrl of cityLinks) {
        if (facilities.length >= remaining) break;
        const cityItems = await this._scrapeCity(page, prefName, cityUrl, remaining - facilities.length);
        facilities.push(...cityItems);
      }

    } catch (err) {
      console.error(`\n  みんなの介護 ${prefName} 取得エラー: ${err.message.split('\n')[0]}`);
    } finally {
      await page.close();
    }

    return facilities;
  }

  async _scrapeCity(page, prefName, cityBaseUrl, remaining) {
    const items = [];
    let pageNum = 1;

    while (items.length < remaining) {
      // ページネーション: /page2/ 形式
      const url = pageNum === 1 ? cityBaseUrl : `${cityBaseUrl}page${pageNum}/`;

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await sleep(4000); // JS描画待ち（React/Vueによる動的ロード）

        const facilities = await page.$$eval(
          'li.pa-search-top-map__shisetsu-list__item',
          (els, base) => els.map(el => {
            const nameEl = el.querySelector('a[href*="facility"]');
            if (!nameEl) return null;
            return {
              name: nameEl.textContent.trim(),
              detailUrl: nameEl.href,
            };
          }).filter(Boolean),
          BASE_URL
        ).catch(() => []);

        if (facilities.length === 0) break;

        for (const f of facilities) {
          items.push({ ...f, pref: prefName, city: '', cost: '' });
          if (items.length >= remaining) break;
        }

        // 次ページ確認
        const hasNext = await page.$('a[rel="next"], a:text("次へ")').catch(() => null);
        if (!hasNext || items.length >= remaining) break;

        pageNum++;
        await sleep(2000);

      } catch (err) {
        break;
      }
    }

    return items;
  }

  // 詳細ページから公式HP URLを取得する
  async fetchDetail(facility) {
    const page = await this.browser.newPage();
    try {
      await page.goto(facility.detailUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await sleep(2000);

      const hpUrl = await page.$$eval('a[href]', links => {
        const hit = links.find(a => {
          const text = (a.textContent || '').trim();
          const href = a.href || '';
          return (
            /公式サイト|ホームページ|公式HP|施設HP|オフィシャル/.test(text) &&
            href.startsWith('http') &&
            !href.includes('minnanokaigo.com')
          );
        });
        return hit ? hit.href : '';
      }).catch(() => '');

      // 住所から市区町村を補完
      const address = await page.$eval(
        '[class*="address"], [class*="addr"], .p-detail-basic__address',
        el => el.textContent.trim().replace(/\s+/g, ' ')
      ).catch(() => '');

      const prefMatch = address.match(/(東京都|大阪府|京都府|北海道|.{2,3}[都道府県])/);
      const cityMatch = address.match(/[都道府県](.+?[区市町村])/);

      return {
        name: facility.name,
        pref: prefMatch ? prefMatch[0] : (facility.pref || ''),
        city: cityMatch ? cityMatch[1] : (facility.city || ''),
        cost: facility.cost || '',
        hpUrl: hpUrl || facility.detailUrl,
      };
    } catch {
      return {
        name: facility.name,
        pref: facility.pref || '',
        city: facility.city || '',
        cost: '',
        hpUrl: facility.detailUrl,
      };
    } finally {
      await page.close();
    }
  }
}

module.exports = MinnanoKaigoAdapter;
