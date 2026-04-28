// 公式HP検出モジュール
// 施設名 + 市区町村 を Startpage（Google結果のプロキシ）で検索し、
// アグリゲーター系ドメインを除外した最初のヒットを公式HPとみなす

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

// アグリゲーター・SNS・地図・口コミ・公的機関など
// 「施設の公式HPではない」と判定するドメインの黒リスト
const EXCLUDED_DOMAINS = [
  // 介護系アグリゲーター
  'kaigo.homes.co.jp', 'homes.co.jp', 'lifull.com',
  'minnanokaigo.com', 'kaigonohonne.com', 'kaigodb.com',
  'sagasix.jp', 'oudokaigo.com', 'tabipro.jp', 'minkai.jp',
  'roufukukyo.or.jp', 'mhlw.go.jp', 'kaigokensaku.mhlw.go.jp',
  'wam.go.jp', 'caremanagement.jp',
  // 不動産・地図・口コミ
  'itot.jp', 'mapfan.com', 'navitime.co.jp', 'mapion.co.jp',
  'itp.ne.jp', 'ekiten.jp', 'goo.ne.jp', 'jorudan.co.jp',
  // SNS・動画・百科事典
  'facebook.com', 'twitter.com', 'x.com', 'instagram.com',
  'youtube.com', 'linkedin.com', 'wikipedia.org', 'note.com',
  'ameblo.jp', 'hatenablog.com', 'fc2.com', 'livedoor.jp',
  // 検索エンジン・ニュース
  'google.com', 'bing.com', 'yahoo.co.jp', 'duckduckgo.com',
  'startpage.com', 'prtimes.jp', 'atpress.ne.jp',
  // 求人系
  'indeed.com', 'rikunabi.com', 'mynavi.jp', 'baitoru.com',
  'townwork.net', 'kaigojob.com', 'e-staffing.co.jp',
  // 楽天・Amazon
  'rakuten.co.jp', 'amazon.co.jp',
];

const SEARCH_ENGINES = [
  {
    name: 'Startpage',
    url: q => `https://www.startpage.com/do/search?q=${encodeURIComponent(q)}`,
    selector: 'a.w-gl__result-title, a.result-link',
  },
  {
    name: 'Bing',
    url: q => `https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=ja&cc=jp`,
    selector: 'li.b_algo h2 a',
  },
];

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function isExcluded(url) {
  const domain = getDomain(url);
  if (!domain) return true;
  return EXCLUDED_DOMAINS.some(excluded =>
    domain === excluded || domain.endsWith('.' + excluded)
  );
}

async function searchOnEngine(browser, engine, query) {
  const ctx = await browser.newContext({
    userAgent: UA,
    locale: 'ja-JP',
    viewport: { width: 1280, height: 800 },
  });
  const page = await ctx.newPage();
  try {
    await page.goto(engine.url(query), { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(1500 + Math.random() * 1000);

    const urls = await page.$$eval(engine.selector, anchors =>
      anchors
        .map(a => a.getAttribute('href') || a.href || '')
        .filter(h => h && h.startsWith('http'))
    ).catch(() => []);

    return urls;
  } catch {
    return [];
  } finally {
    await page.close();
    await ctx.close();
  }
}

// 施設名・市区町村から公式HPを検索
// 戻り値: { hpUrl: string|null, candidates: string[] }
async function findOfficialSite(browser, { name, pref, city }) {
  const queries = [
    `${name} ${city || ''} 公式`.replace(/\s+/g, ' ').trim(),
    `${name} ${pref || ''}${city || ''}`.replace(/\s+/g, ' ').trim(),
    `${name} 介護 ${city || ''}`.replace(/\s+/g, ' ').trim(),
  ];

  const seen = new Set();
  const candidates = [];

  for (const engine of SEARCH_ENGINES) {
    for (const q of queries) {
      const urls = await searchOnEngine(browser, engine, q);
      for (const url of urls) {
        if (seen.has(url)) continue;
        seen.add(url);
        if (isExcluded(url)) continue;
        candidates.push(url);
      }
      if (candidates.length > 0) break;
    }
    if (candidates.length > 0) break;
  }

  // ドメイン単位で先頭を採用（公式HPはトップに正規化）
  const hpUrl = candidates.length > 0
    ? `${new URL(candidates[0]).protocol}//${new URL(candidates[0]).hostname}/`
    : null;

  return { hpUrl, candidates };
}

module.exports = {
  findOfficialSite,
  isExcluded,
  getDomain,
  EXCLUDED_DOMAINS,
};
