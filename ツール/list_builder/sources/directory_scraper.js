/**
 * FilmLink リストビルダー — ディレクトリサイト スクレイパー
 *
 * Playwright (chromium, headless) でディレクトリサイトをスクレイピングして
 * 施設リストを取得する。
 */

'use strict';

const { chromium } = require('playwright');

/**
 * ランダムなwait時間 (1〜3秒)
 */
function randomWait() {
  const ms = 1000 + Math.floor(Math.random() * 2000);
  return new Promise(r => setTimeout(r, ms));
}

/**
 * みんなのウエディング から施設リストを取得する
 */
async function scrapeMinnaWedding({ browser, baseUrl, area, limit }) {
  const results = [];
  const page = await browser.newPage();

  try {
    // エリア絞り込み付きURL
    const searchUrl = `${baseUrl}?pref_name=${encodeURIComponent(area)}`;
    console.log(`[directory] みんなのウエディング: ${searchUrl}`);

    let currentUrl = searchUrl;
    let pageNum = 1;

    while (results.length < limit) {
      try {
        await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await randomWait();

        // 施設カードを取得 (複数のセレクタを試す)
        const facilities = await page.evaluate(() => {
          const items = [];

          // みんなのウエディングの施設リストセレクタを試す
          const selectors = [
            '.p-hall-list__item',
            '.hallList__item',
            '.p-search-result__item',
            '[class*="hall-list"] li',
            '[class*="hallList"] li',
            '.searchResult__item',
          ];

          let cards = [];
          for (const sel of selectors) {
            cards = document.querySelectorAll(sel);
            if (cards.length > 0) break;
          }

          // フォールバック: リンクから施設名を取得
          if (cards.length === 0) {
            const links = document.querySelectorAll('a[href*="/wedding_hall/"]');
            links.forEach(link => {
              const name = link.textContent.trim();
              if (name && name.length > 1 && name.length < 50) {
                items.push({ name, hp_url: link.href });
              }
            });
            return items;
          }

          cards.forEach(card => {
            const nameEl = card.querySelector('h2, h3, .name, [class*="name"], [class*="title"]');
            const linkEl = card.querySelector('a');
            const name = nameEl ? nameEl.textContent.trim() : (linkEl ? linkEl.textContent.trim() : '');
            const hp_url = linkEl ? linkEl.href : '';
            if (name) items.push({ name, hp_url });
          });

          return items;
        });

        if (facilities.length === 0) {
          console.log(`[directory] みんなのウエディング: ページ${pageNum}で施設が見つからないため終了`);
          break;
        }

        for (const f of facilities) {
          if (results.length >= limit) break;
          results.push({
            name: f.name,
            prefecture: area.replace(/[都道府県]$/, '') + (area.match(/[都道府県]$/) ? area.match(/[都道府県]$/)[0] : ''),
            city: '',
            phone: '',
            hp_url: f.hp_url || '',
            form_url: '',
            source: 'directory',
            status: '未処理',
          });
        }

        process.stdout.write(`\r[directory] みんなのウエディング: 取得済み ${results.length}件`);

        // 次のページへ
        const nextLink = await page.$('a[rel="next"], .pagination__next, [class*="next"] a, a:has-text("次へ"), a:has-text("次のページ")');
        if (!nextLink) break;

        const nextHref = await nextLink.getAttribute('href');
        if (!nextHref) break;

        currentUrl = nextHref.startsWith('http') ? nextHref : new URL(nextHref, currentUrl).href;
        pageNum++;

        await randomWait();

      } catch (err) {
        console.error(`\n[directory] みんなのウエディング ページ${pageNum}エラー: ${err.message}`);
        break;
      }
    }

  } finally {
    await page.close().catch(() => {});
  }

  console.log(`\n[directory] みんなのウエディング: ${results.length}件取得`);
  return results;
}

/**
 * みんなの介護 から施設リストを取得する
 */
async function scrapeMinnanoKaigo({ browser, baseUrl, area, limit }) {
  const results = [];
  const page = await browser.newPage();

  try {
    const searchUrl = `${baseUrl}?area=${encodeURIComponent(area)}`;
    console.log(`[directory] みんなの介護: ${searchUrl}`);

    let currentUrl = searchUrl;
    let pageNum = 1;

    while (results.length < limit) {
      try {
        await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await randomWait();

        const facilities = await page.evaluate(() => {
          const items = [];

          const selectors = [
            '.p-facility-list__item',
            '.facilityList__item',
            '.p-search-result__item',
            '[class*="facility-list"] li',
            '[class*="facilityList"] li',
          ];

          let cards = [];
          for (const sel of selectors) {
            cards = document.querySelectorAll(sel);
            if (cards.length > 0) break;
          }

          if (cards.length === 0) {
            const links = document.querySelectorAll('a[href*="/facility/"]');
            links.forEach(link => {
              const name = link.textContent.trim();
              if (name && name.length > 1 && name.length < 60) {
                items.push({ name, hp_url: link.href });
              }
            });
            return items;
          }

          cards.forEach(card => {
            const nameEl = card.querySelector('h2, h3, .name, [class*="name"], [class*="title"]');
            const linkEl = card.querySelector('a');
            const name = nameEl ? nameEl.textContent.trim() : (linkEl ? linkEl.textContent.trim() : '');
            const hp_url = linkEl ? linkEl.href : '';
            if (name) items.push({ name, hp_url });
          });

          return items;
        });

        if (facilities.length === 0) {
          console.log(`[directory] みんなの介護: ページ${pageNum}で施設が見つからないため終了`);
          break;
        }

        for (const f of facilities) {
          if (results.length >= limit) break;
          results.push({
            name: f.name,
            prefecture: area,
            city: '',
            phone: '',
            hp_url: f.hp_url || '',
            form_url: '',
            source: 'directory',
            status: '未処理',
          });
        }

        process.stdout.write(`\r[directory] みんなの介護: 取得済み ${results.length}件`);

        const nextLink = await page.$('a[rel="next"], .pagination__next, [class*="next"] a, a:has-text("次へ"), a:has-text("次のページ")');
        if (!nextLink) break;

        const nextHref = await nextLink.getAttribute('href');
        if (!nextHref) break;

        currentUrl = nextHref.startsWith('http') ? nextHref : new URL(nextHref, currentUrl).href;
        pageNum++;

        await randomWait();

      } catch (err) {
        console.error(`\n[directory] みんなの介護 ページ${pageNum}エラー: ${err.message}`);
        break;
      }
    }

  } finally {
    await page.close().catch(() => {});
  }

  console.log(`\n[directory] みんなの介護: ${results.length}件取得`);
  return results;
}

/**
 * ディレクトリサイトから施設リストを取得する
 *
 * @param {object} options
 * @param {string} options.industry       - 業種名
 * @param {string} options.area           - エリア
 * @param {number} options.limit          - 最大取得件数
 * @param {Array}  options.directorySites - config/industries.json の directory_sites
 * @returns {Promise<Array>}
 */
async function fetchFromDirectory({ industry, area, limit, directorySites }) {
  if (!directorySites || directorySites.length === 0) {
    console.log(`[directory] ${industry}: ディレクトリサイト設定なし。スキップします。`);
    return [];
  }

  const allResults = [];
  let browser = null;

  try {
    browser = await chromium.launch({ headless: true });

    for (const site of directorySites) {
      if (allResults.length >= limit) break;

      const remaining = limit - allResults.length;

      try {
        let siteResults = [];

        if (site.name === 'みんなのウエディング') {
          siteResults = await scrapeMinnaWedding({
            browser,
            baseUrl: site.base_url,
            area,
            limit: remaining,
          });
        } else if (site.name === 'みんなの介護') {
          siteResults = await scrapeMinnanoKaigo({
            browser,
            baseUrl: site.base_url,
            area,
            limit: remaining,
          });
        } else {
          console.log(`[directory] ${site.name}: 対応するスクレイパーがありません。スキップします。`);
        }

        allResults.push(...siteResults);

      } catch (err) {
        console.error(`[directory] ${site.name} でエラーが発生しました: ${err.message}`);
      }
    }

  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  return allResults;
}

module.exports = { fetchFromDirectory };
