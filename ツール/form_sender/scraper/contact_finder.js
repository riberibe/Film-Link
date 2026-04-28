// お問い合わせフォーム検出モジュール
// 公式HPにアクセスして「お問い合わせ / contact / inquiry」リンクをたどり、
// フォームが存在するページのURLを返す

const CONTACT_TEXT_PATTERN = /お問い合わせ|お問合せ|問合せ|資料請求|相談|contact|inquiry|toiawase|otoiawase/i;
const CONTACT_PATH_CANDIDATES = [
  '/contact', '/contact/', '/contact.html', '/contact.php',
  '/inquiry', '/inquiry/', '/inquiry.html', '/inquiry.php',
  '/toiawase', '/toiawase/', '/otoiawase/', '/o-toiawase/',
  '/form', '/form/', '/mail', '/mail/',
  '/support', '/support/',
];

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ページ内に可視のフォーム入力欄があるかチェック
async function hasVisibleForm(page) {
  return await page.$$eval(
    'input[type="text"], input[type="email"], input[type="tel"], textarea',
    els => els.some(el => el.offsetParent !== null)
  ).catch(() => false);
}

// HP URL から お問い合わせフォームのURLを検出
// 戻り値: { formUrl: string|null, status: '未処理'|'フォーム未検出'|'HP到達不可' }
async function findContactUrl(browser, hpUrl) {
  if (!hpUrl) return { formUrl: null, status: 'HP未指定' };

  const page = await browser.newPage();
  try {
    // Step 1: HPトップにアクセス
    let response;
    try {
      response = await page.goto(hpUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    } catch {
      return { formUrl: null, status: 'HP到達不可' };
    }
    if (!response || response.status() >= 400) {
      return { formUrl: null, status: 'HP到達不可' };
    }
    await sleep(1500);

    // Step 2: ページ内のリンクから「お問い合わせ」系を探す
    const links = await page.$$eval('a[href]', as =>
      as.map(a => ({
        href: a.href,
        text: (a.textContent || '').trim(),
        title: a.getAttribute('title') || '',
      }))
    ).catch(() => []);

    const hpDomain = new URL(hpUrl).hostname.replace(/^www\./, '');

    const contactLinks = links.filter(l => {
      if (!l.href || !l.href.startsWith('http')) return false;
      const linkDomain = (() => {
        try { return new URL(l.href).hostname.replace(/^www\./, ''); }
        catch { return ''; }
      })();
      // 同一ドメイン or サブドメインのみ許可
      if (!linkDomain || (linkDomain !== hpDomain && !linkDomain.endsWith('.' + hpDomain))) return false;
      return CONTACT_TEXT_PATTERN.test(l.text + ' ' + l.href + ' ' + l.title);
    });

    // Step 3: 候補リンクを順に開いてフォーム有無確認
    for (const link of contactLinks) {
      try {
        await page.goto(link.href, { waitUntil: 'domcontentloaded', timeout: 12000 });
        await sleep(1500);
        if (await hasVisibleForm(page)) {
          return { formUrl: link.href, status: '未処理' };
        }
      } catch (_) {
        // この候補は失敗 → 次へ
      }
    }

    // Step 4: 標準的なパスを総当たり
    for (const candidatePath of CONTACT_PATH_CANDIDATES) {
      try {
        const url = new URL(candidatePath, hpUrl).href;
        const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 8000 });
        if (res?.status() === 200 && await hasVisibleForm(page)) {
          return { formUrl: url, status: '未処理' };
        }
      } catch (_) {}
    }

    return { formUrl: null, status: 'フォーム未検出' };
  } finally {
    await page.close();
  }
}

module.exports = { findContactUrl };
