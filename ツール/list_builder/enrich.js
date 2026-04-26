/**
 * FilmLink リストビルダー — フォームURL補完 (enrich)
 *
 * HP_URLが設定されていてform_urlが空の施設を対象に
 * Playwright でフォームURLを自動発見して補完する。
 */

'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// 途中保存ファイル
const TEMP_FILE = path.join(__dirname, '.enrich_progress.json');

/**
 * トップページからお問い合わせフォームURLを発見する
 * (send_forms.js の findContactUrl と同じロジック)
 */
async function findContactUrl(page, baseUrl) {
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    const links = await page.$$eval('a', as =>
      as.map(a => ({ href: a.href, text: a.textContent.trim() }))
    );
    const hit = links.find(l => /お問い合わせ|contact|inquiry|toiawase/i.test(l.text + l.href));
    if (hit) return hit.href;
  } catch (_) {}

  for (const p of ['/contact', '/inquiry', '/toiawase', '/contact.html', '/contact/']) {
    try {
      const url = new URL(p, baseUrl).href;
      const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 8000 });
      if (res?.status() === 200 && await page.$('form')) return url;
    } catch (_) {}
  }
  return null;
}

/**
 * 施設リストのフォームURLを補完する
 *
 * @param {Array} items - 施設リスト
 * @returns {Promise<Array>} - form_url が補完された施設リスト
 */
async function enrichList(items) {
  // HP_URLがあってform_urlが空のものだけ対象
  const targets = items.map((item, idx) => ({ item, idx }))
    .filter(({ item }) => item.hp_url && !item.form_url);

  if (targets.length === 0) {
    console.log('[enrich] フォームURL補完の対象がありません。');
    return items;
  }

  console.log(`[enrich] フォームURL補完を開始します (対象: ${targets.length}件)`);

  // 途中保存データを読み込む
  let progressMap = {};
  if (fs.existsSync(TEMP_FILE)) {
    try {
      progressMap = JSON.parse(fs.readFileSync(TEMP_FILE, 'utf8'));
      const savedCount = Object.keys(progressMap).length;
      if (savedCount > 0) {
        console.log(`[enrich] 前回の途中保存データを発見: ${savedCount}件。続きから再開します。`);
      }
    } catch (_) {
      progressMap = {};
    }
  }

  // 結果をコピーして補完していく
  const result = items.map(item => ({ ...item }));

  let browser = null;
  let processed = 0;

  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    // タイムアウトを短めに設定
    page.setDefaultNavigationTimeout(20000);

    for (const { item, idx } of targets) {
      processed++;

      // キャッシュがあればスキップ
      if (progressMap[item.hp_url] !== undefined) {
        result[idx].form_url = progressMap[item.hp_url];
        const status = progressMap[item.hp_url] ? '発見' : '未発見';
        console.log(`[enrich] [${processed}/${targets.length}] ${item.name} → ${status} (キャッシュ)`);
        continue;
      }

      let foundUrl = null;

      try {
        foundUrl = await findContactUrl(page, item.hp_url);
      } catch (err) {
        // エラーが発生しても次へ
      }

      result[idx].form_url = foundUrl || '';
      progressMap[item.hp_url] = foundUrl || '';

      const status = foundUrl ? `発見: ${foundUrl}` : '未発見';
      console.log(`[enrich] [${processed}/${targets.length}] ${item.name} → ${status}`);

      // 途中保存
      try {
        fs.writeFileSync(TEMP_FILE, JSON.stringify(progressMap, null, 2), 'utf8');
      } catch (_) {}

      // 次のリクエストまで少し待つ
      await new Promise(r => setTimeout(r, 500));
    }

    await page.close().catch(() => {});

  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  // 完了したら途中保存ファイルを削除
  try {
    if (fs.existsSync(TEMP_FILE)) fs.unlinkSync(TEMP_FILE);
  } catch (_) {}

  const found = result.filter(item => item.form_url).length;
  console.log(`[enrich] 完了: フォームURL発見 ${found}件 / 全体 ${result.length}件`);

  return result;
}

module.exports = { enrichList, findContactUrl };
