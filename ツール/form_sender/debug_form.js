const { chromium } = require('playwright');

const URLS = {
  // ベネッセ：施設HP経由でお問い合わせページを探す
  'アリア恵比寿南HP':    'https://kaigo.benesse-style-care.co.jp/area_tokyo/shibuya/home_a-ebisuminami',
  // ベネッセ：inquiry_all 直接アクセス
  'ベネッセ問い合わせハブ': 'https://www.benesse-style-care.co.jp/inquiry_all/',
};

(async () => {
  const browser = await chromium.launch({ headless: false });

  for (const [name, url] of Object.entries(URLS)) {
    console.log(`\n========== ${name} ==========`);
    console.log(`URL: ${url}`);

    const page = await browser.newPage();
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 20000 });
      await page.waitForTimeout(6000); // JS追加レンダリング待ち（長め）

      // input要素を全列挙
      const inputs = await page.$$eval(
        'input, textarea, select',
        els => els.map(e => ({
          tag:         e.tagName,
          type:        e.type || '',
          name:        e.name || '',
          id:          e.id || '',
          placeholder: e.placeholder || '',
          visible:     e.offsetParent !== null,
        }))
      );
      console.log('【input/textarea/select 一覧】');
      inputs.forEach(i => console.log(' ', JSON.stringify(i)));

      // a/button/div/li のテキスト（クリック可能そうなもの）
      const clickables = await page.$$eval(
        'a, button, [role="button"], [onclick], li > a, .btn, .button',
        els => els
          .map(e => ({ tag: e.tagName, text: e.textContent.trim().slice(0, 40) }))
          .filter(e => e.text.length > 1)
      );
      const unique = [...new Map(clickables.map(e => [e.text, e])).values()];
      console.log('\n【クリック可能要素（a/button/role=button等）】');
      unique.slice(0, 40).forEach(e => console.log(`  [${e.tag}] ${JSON.stringify(e.text)}`));

      // form の有無
      const formCount = await page.$$eval('form', fs => fs.length);
      console.log(`\n【form タグ数】: ${formCount}`);

      // iframe の有無
      const iframes = await page.$$eval('iframe', fs => fs.map(f => f.src));
      if (iframes.length > 0) console.log('【iframe】', iframes);

    } catch (err) {
      console.log('エラー:', err.message.split('\n')[0]);
    } finally {
      await page.close();
    }
  }

  await browser.close();
})();
