/**
 * FilmLink — 施設お問い合わせフォーム全自動送信ツール
 *
 * 使い方:
 *   node send_forms.js          ← 全自動で送信（facilities.csv の全件処理）
 *   node send_forms.js --dry    ← ドライラン（入力まで・送信しない・確認用）
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');

const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
const DRY_RUN = process.argv.includes('--dry');

// フォームフィールドのキーワードマップ
const FIELD_MAP = {
  name:    ['name', 'your-name', 'お名前', '氏名', 'fullname', 'full_name', 'contact_name', 'shimei'],
  email:   ['email', 'mail', 'your-email', 'メール', 'email_address'],
  phone:   ['tel', 'phone', 'telephone', '電話', '電話番号', 'denwabangou'],
  subject: ['subject', '件名', 'title', 'お問い合わせ件名', 'kenmei'],
  body:    ['message', 'body', '本文', 'content', 'inquiry', 'お問い合わせ内容', 'text', 'naiyou', 'memo'],
  company: ['company', '会社名', '施設名', 'organization', 'kaishame'],
};

function matchField(attrs) {
  const key = [attrs.name, attrs.id, attrs.placeholder].join(' ').toLowerCase();
  for (const [type, keywords] of Object.entries(FIELD_MAP)) {
    if (keywords.some(k => key.includes(k))) return type;
  }
  return null;
}

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

async function fillAndSubmit(page, facility) {
  const inputs = await page.$$('input, textarea, select');
  const filled = {};

  for (const input of inputs) {
    const attrs = await input.evaluate(el => ({
      name:        (el.name || '').toLowerCase(),
      id:          (el.id || '').toLowerCase(),
      type:        (el.type || '').toLowerCase(),
      tag:         el.tagName.toLowerCase(),
      placeholder: (el.placeholder || '').toLowerCase(),
    }));

    if (['hidden', 'submit', 'button', 'checkbox', 'radio'].includes(attrs.type)) continue;

    const fieldType = matchField(attrs);
    if (!fieldType || filled[fieldType]) continue;

    const value = {
      name:    config.sender.name,
      email:   config.sender.email,
      phone:   config.sender.phone,
      subject: config.message.subject,
      body:    config.message.body,
      company: '個人',
    }[fieldType];

    if (value) {
      await input.fill(value).catch(() => {});
      filled[fieldType] = true;
    }
  }

  // スクリーンショット保存（送信前の状態を記録）
  const dir = config.settings.screenshot_dir;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filename = path.join(dir, `${facility['No.'].padStart(3,'0')}_${facility['施設名'].replace(/[\s/]/g,'_')}.png`);
  await page.screenshot({ path: filename, fullPage: true });

  if (DRY_RUN) {
    return { result: 'ドライラン（送信なし）', screenshot: filename, filled };
  }

  // 送信ボタンを探してクリック
  const submitBtn = await page.$(
    'input[type="submit"], button[type="submit"], ' +
    'button:has-text("送信"), button:has-text("確認"), ' +
    'button:has-text("Submit"), button:has-text("送る")'
  );

  if (!submitBtn) return { result: '送信ボタン未発見', screenshot: filename, filled };

  await submitBtn.click();
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

  return { result: '送信完了', screenshot: filename, filled };
}

async function processFacility(browser, facility, index, total) {
  const row = { ...facility, 送信結果: '', エラー詳細: '' };

  if (!facility['フォームURL'] || facility['フォームURL'].includes('要確認')) {
    row['送信結果'] = 'URLなし・スキップ';
    console.log(`[${index+1}/${total}] ${facility['施設名']} → スキップ（URL未設定）`);
    return row;
  }

  const page = await browser.newPage();
  try {
    console.log(`[${index+1}/${total}] ${facility['施設名']}`);
    await page.goto(facility['フォームURL'], { waitUntil: 'domcontentloaded', timeout: 15000 });

    // フォームが見つからない場合はトップページからコンタクトページを探す
    const hasForm = await page.$('form');
    if (!hasForm && facility['HP_URL']) {
      const contactUrl = await findContactUrl(page, facility['HP_URL']);
      if (contactUrl) {
        await page.goto(contactUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      }
    }

    const { result, screenshot, filled } = await fillAndSubmit(page, facility);

    row['送信結果'] = result;
    row['フォームURL'] = facility['フォームURL'];
    console.log(`  → ${result}（入力: ${Object.keys(filled).join(', ')}）`);

  } catch (err) {
    const msg = err.message.split('\n')[0];
    row['送信結果'] = 'エラー';
    row['エラー詳細'] = msg;
    console.log(`  → エラー: ${msg}`);
  } finally {
    await page.close();
  }

  return row;
}

(async () => {
  const raw = fs.readFileSync('./facilities.csv', 'utf8');
  const facilities = parse(raw, { columns: true, skip_empty_lines: true });

  // 未処理の施設だけを対象にする（送信済みは自動スキップ）
  const pending = facilities.filter(f => !f['ステータス'] || f['ステータス'] === '未処理');
  const dailyLimit = config.settings.daily_limit ?? 999999;

  console.log(`\n${'='.repeat(50)}`);
  console.log(`FilmLink フォーム送信ツール`);
  console.log(`モード: ${DRY_RUN ? 'ドライラン（送信なし）' : '全自動送信'}`);
  console.log(`未処理件数: ${pending.length}件 / 本日の上限: ${dailyLimit}件`);
  console.log(`${'='.repeat(50)}\n`);

  const browser = await chromium.launch({ headless: false });
  const results = [];
  let sentCount = 0;

  try {
    for (let i = 0; i < pending.length; i++) {
      // 1日の上限に達したら停止
      if (!DRY_RUN && sentCount >= dailyLimit) {
        console.log(`\n本日の送信上限（${dailyLimit}件）に達しました。残り${pending.length - i}件は明日以降に送信されます。`);
        break;
      }

      const result = await processFacility(browser, pending[i], i, pending.length);
      results.push(result);

      // 送信成功したらfacilities.csvのステータスを「送信済み」に更新
      if (result['送信結果'] === '送信完了') {
        const idx = facilities.findIndex(f => f['No.'] === pending[i]['No.']);
        if (idx !== -1) facilities[idx]['ステータス'] = '送信済み';
        sentCount++;
        // 更新したfacilities.csvを即保存（途中で止まっても記録が残る）
        fs.writeFileSync('./facilities.csv', stringify(facilities, { header: true }));
      }

      // 送信ログを随時保存
      fs.writeFileSync(
        config.settings.log_file,
        stringify(results, { header: true })
      );

      // 施設間のウェイト（上限未達かつ最後でない場合のみ）
      if (!DRY_RUN && i < pending.length - 1 && sentCount < dailyLimit) {
        await new Promise(r => setTimeout(r, config.settings.delay_between_sites_ms));
      }
    }
  } finally {
    await browser.close();
  }

  // サマリー表示
  const ok  = results.filter(r => r['送信結果'] === '送信完了').length;
  const dry = results.filter(r => r['送信結果'].includes('ドライラン')).length;
  const ng  = results.filter(r => ['エラー','送信ボタン未発見'].includes(r['送信結果'])).length;
  const skipped = results.filter(r => r['送信結果'].includes('スキップ')).length;
  const remaining = pending.length - results.length;

  console.log(`\n${'='.repeat(50)}`);
  console.log(`完了サマリー`);
  if (DRY_RUN) {
    console.log(`  ドライラン完了: ${dry}件`);
  } else {
    console.log(`  送信完了: ${ok}件`);
    console.log(`  エラー:   ${ng}件`);
  }
  console.log(`  スキップ: ${skipped}件（URL未設定）`);
  if (remaining > 0) console.log(`  未送信（明日以降）: ${remaining}件`);
  console.log(`  結果ファイル: ${config.settings.log_file}`);
  console.log(`${'='.repeat(50)}\n`);
})();
