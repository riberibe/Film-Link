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

// キャンペーンモード引数
const _args = process.argv.slice(2);
const CAMPAIGN = (() => { const i = _args.indexOf('--campaign'); return i !== -1 ? _args[i + 1] : null; })();
const SAMPLE_N = (() => { const i = _args.indexOf('--sample');   return i !== -1 ? parseInt(_args[i + 1]) || 3 : null; })();

// キャンペーンの message.txt があれば件名・本文を上書き
if (CAMPAIGN) {
  const msgPath = path.join(CAMPAIGN, 'message.txt');
  if (fs.existsSync(msgPath)) {
    const lines = fs.readFileSync(msgPath, 'utf8').trim().split('\n');
    const subjLine = lines.find(l => l.startsWith('件名:'));
    if (subjLine) {
      config.message.subject = subjLine.replace(/^件名:\s*/, '').trim();
      const subjIdx = lines.indexOf(subjLine);
      config.message.body = lines.slice(subjIdx + 2).join('\n').trim();
    }
  }
}

// フォームフィールドのキーワードマップ
// 注意: 分割フィールド（last_name/first_name等）を name より先に判定する必要があるため、
// 配列順を維持できるよう Object.entries の順序に依存している。
const FIELD_MAP = {
  last_name_kana:  ['sei_kana', 'last_name_kana', 'lastname_kana', 'sei-kana', 'last-kana', 'セイ', 'せい'],
  first_name_kana: ['mei_kana', 'first_name_kana', 'firstname_kana', 'mei-kana', 'first-kana', 'メイ', 'めい'],
  last_name:       ['last_name', 'lastname', 'last-name', 'family_name', 'familyname', 'sei', '姓', '苗字', 'みょうじ'],
  first_name:      ['first_name', 'firstname', 'first-name', 'given_name', 'givenname', 'mei', '名前', '下の名前'],
  name:            ['your-name', 'お名前', '氏名', 'fullname', 'full_name', 'full-name', 'contact_name', 'shimei', 'onamae', 'name'],
  email:           ['email', 'mail', 'your-email', 'メール', 'email_address', 'e-mail'],
  phone:           ['tel', 'phone', 'telephone', '電話', '電話番号', 'denwabangou', 'phonenumber'],
  fax:             ['fax', 'ファックス', 'facsimile', 'fax_number', 'faxbangou'],
  subject:         ['subject', '件名', 'title', 'お問い合わせ件名', 'kenmei'],
  body:            ['message', 'body', '本文', 'content', 'inquiry', 'お問い合わせ内容', 'text', 'naiyou', 'memo',
                     'description', 'details', 'comment', 'ご要望', 'toiawase', 'otoiawase', 'your-message'],
  company:         ['company', '会社名', 'organization', 'kaishame', '組織名', 'corp', 'houjin'],
  postal_code:     ['postal', 'zip', '郵便番号', 'yuubin', 'postcode', 'post_code'],
  address:         ['address', '住所', 'juusho', 'addr'],
};

function matchField(attrs) {
  const key = [attrs.name, attrs.id, attrs.placeholder].join(' ').toLowerCase();
  for (const [type, keywords] of Object.entries(FIELD_MAP)) {
    if (keywords.some(k => key.includes(k.toLowerCase()))) return type;
  }
  return null;
}

function buildValueMap(config) {
  return {
    name:            config.sender.name,
    last_name:       config.sender.last_name       || (config.sender.name || '').split(/[\s　]+/)[0] || '',
    first_name:      config.sender.first_name      || (config.sender.name || '').split(/[\s　]+/)[1] || '',
    last_name_kana:  config.sender.last_name_kana  || '',
    first_name_kana: config.sender.first_name_kana || '',
    email:           config.sender.email,
    phone:           config.sender.phone,
    fax:             config.sender.fax,
    subject:         config.message.subject,
    body:            config.message.body,
    company:         config.sender.company,
    postal_code:     config.sender.postal_code || '',
    address:         config.sender.address     || '',
  };
}

// 中間ページ（カテゴリ選択ページ等）を突破してフォームページへ進む
// ボタンをクリックしてもフォーム入力欄がなければ元のURLに戻って次を試す
async function tryClickThroughIntermediatePage(page) {
  const currentUrl = page.url();
  // JSレンダリング待ち（React/Vue系のページ対応）
  await page.waitForTimeout(2500);
  const priorities = [
    /お問い合わせフォーム|問合せフォーム|問合フォーム|メールフォーム|フォームはこちら|フォームへ/i,
    /法人|事業者|企業|ビジネス/i,
    /一般/i,
    /その他|other/i,
  ];
  const elements = await page.$$('a, button').catch(() => []);
  for (const pattern of priorities) {
    for (const el of elements) {
      const text = await el.evaluate(e => e.textContent.trim()).catch(() => '');
      if (pattern.test(text)) {
        try {
          await el.click();
          await page.waitForLoadState('networkidle', { timeout: 15000 });
          const hasVisibleInputs = await page.$$eval(
            'input[type="text"], input[type="email"], input[type="tel"], textarea',
            els => els.some(el => el.offsetParent !== null)
          ).catch(() => false);
          if (hasVisibleInputs) return true;
          await page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
        } catch (_) {}
      }
    }
  }
  return false;
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

async function fillAndSubmit(page) {
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

    if (['hidden', 'submit', 'button'].includes(attrs.type)) continue;

    // プライバシーポリシー・利用規約への同意チェックボックスを自動チェック
    if (attrs.type === 'checkbox') {
      const context = await input.evaluate(el => {
        const label = [...(el.labels || [])].map(l => l.textContent).join('');
        const wrap  = el.closest('label')?.textContent || '';
        return (label + wrap + el.name + el.id).toLowerCase();
      }).catch(() => '');
      if (/プライバシー|個人情報|利用規約|同意|承諾|承認|了承|privacy|agree|terms|accept|consent/i.test(context)) {
        await input.check().catch(() => {});
      }
      continue;
    }

    // ドロップダウン（問い合わせ種別など）は「その他」を優先選択
    if (attrs.tag === 'select') {
      if (filled['_select']) continue;
      const options = await input.$$eval('option', opts =>
        opts.map(o => ({ value: o.value, text: o.textContent.trim() })).filter(o => o.value)
      );
      const other = options.find(o => /その他|other|ご相談|問い合わせ|inquiry/i.test(o.text));
      const target = other || options[options.length - 1];
      if (target) {
        await input.selectOption(target.value).catch(() => {});
        filled['_select'] = true;
      }
      continue;
    }

    const fieldType = matchField(attrs);
    if (!fieldType || filled[fieldType]) continue;

    // 分割フィールドが存在する場合は統合 name フィールドへの入力をスキップ
    // （姓/名が別欄なのに「田中　惇谷」が入って氏名欄に重複表示されるのを防ぐ）
    if (fieldType === 'name' && (filled['last_name'] || filled['first_name'])) continue;

    const value = buildValueMap(config)[fieldType];

    if (value !== undefined) {
      await input.fill(value).catch(() => {});
      if (value) filled[fieldType] = true;
    }
  }

  // 多段式フォーム対応: セレクト選択後に入力欄が動的に出現するタイプ（ツクイ等）
  if (filled['_select'] && !filled['name'] && !filled['email']) {
    await page.waitForTimeout(2000);
    const newInputs = await page.$$('input, textarea');
    for (const input of newInputs) {
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
      if (fieldType === 'name' && (filled['last_name'] || filled['first_name'])) continue;
      const value = buildValueMap(config)[fieldType];
      if (value !== undefined) {
        await input.fill(value).catch(() => {});
        if (value) filled[fieldType] = true;
      }
    }
  }

  if (DRY_RUN) {
    return { result: 'ドライラン（送信なし）', filled };
  }

  // 送信ボタンを探してクリック（1段目: 確認ボタン含む）
  const submitSelector =
    'input[type="submit"], button[type="submit"], ' +
    'button:has-text("送信"), button:has-text("確認"), button:has-text("送る"), ' +
    'button:has-text("Submit"), button:has-text("確定"), button:has-text("問い合わせる"), ' +
    'input[value*="送信"], input[value*="確認"], input[value*="Submit"]';

  const submitBtn = await page.$(submitSelector);
  if (!submitBtn) return { result: '送信ボタン未発見', filled };

  await submitBtn.click();
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

  // 2段階フォーム対応: 確認画面に遷移した場合、最終送信ボタンを探してクリック
  // ※「確認」は含めない（無限ループ防止）
  const finalSelector =
    'button[type="submit"], button:has-text("送信"), button:has-text("送る"), ' +
    'button:has-text("Submit"), button:has-text("確定"), button:has-text("完了"), ' +
    'input[type="submit"]:not([value*="戻"]), input[value*="送信"], input[value*="Submit"]';

  const finalBtn = await page.$(finalSelector).catch(() => null);
  if (finalBtn) {
    await finalBtn.click();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  }

  return { result: '送信完了', filled };
}

// SHODAN Pro形式 → 内部形式に正規化
function normalizeFacility(row, index) {
  if (row['フォームURL'] !== undefined) return row; // 既に内部形式
  return {
    'No.':      String(index + 1).padStart(4, '0'),
    '施設名':   row['会社名']              || '',
    '業種':     row['業界']               || '',
    '都道府県': '',
    '市区町村': row['本社住所']            || '',
    '月額費用': '',
    'HP_URL':   '',
    'フォームURL': row['お問い合わせフォーム'] || '',
    'ステータス': '',
  };
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

    // 可視のフォーム入力欄チェック（JS描画待ちのため最大2回試行）
    const checkInputs = () => page.$$eval(
      'input[type="text"], input[type="email"], input[type="tel"], textarea',
      els => els.some(el => el.offsetParent !== null)
    ).catch(() => false);

    let hasVisibleInputs = await checkInputs();
    if (!hasVisibleInputs) {
      await page.waitForTimeout(3000);
      hasVisibleInputs = await checkInputs();
    }

    // 可視入力欄がなければ: ①中間ページ突破 → ②トップからコンタクトURL探索
    if (!hasVisibleInputs) {
      const clicked = await tryClickThroughIntermediatePage(page);
      if (!clicked && facility['HP_URL']) {
        const contactUrl = await findContactUrl(page, facility['HP_URL']);
        if (contactUrl) {
          await page.goto(contactUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        }
      }
    }

    const { result, filled } = await fillAndSubmit(page);

    row['送信結果'] = result;
    console.log(`  → ${result}（入力: ${Object.keys(filled).join(', ')}）`);

  } catch (err) {
    const msg = err.message.split('\n')[0];
    row['送信結果'] = 'エラー';
    row['エラー詳細'] = msg;
    // エラー時のみスクリーンショット保存
    if ((config.settings.screenshot_mode || 'errors_only') !== 'none') {
      const dir = config.settings.screenshot_dir;
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const fname = path.join(dir, `ERR_${facility['No.'].padStart(3,'0')}_${facility['施設名'].replace(/[\s/]/g,'_')}.png`);
      await page.screenshot({ path: fname }).catch(() => {});
    }
    console.log(`  → エラー: ${msg}`);
  } finally {
    await page.close();
  }

  return row;
}

(async () => {
  // パス解決
  const csvPath     = CAMPAIGN ? path.join(CAMPAIGN, 'alive.csv')   : './facilities.csv';
  const resultsPath = CAMPAIGN ? path.join(CAMPAIGN, 'results.csv') : config.settings.log_file;

  const raw = fs.readFileSync(csvPath, 'utf8');
  const rawRows = parse(raw, { columns: true, skip_empty_lines: true, relax_quotes: true, relax_column_count: true });
  const facilities = rawRows.map((r, i) => normalizeFacility(r, i));

  // 未処理だけ対象（送信済みは自動スキップ）
  // キャンペーンモードでは results.csv の送信済みURLを除外
  let sentUrls = new Set();
  if (CAMPAIGN && fs.existsSync(resultsPath)) {
    const prevResults = parse(fs.readFileSync(resultsPath, 'utf8'), { columns: true, skip_empty_lines: true });
    prevResults.filter(r => r['送信結果'] === '送信完了').forEach(r => sentUrls.add(r['フォームURL']));
  }

  const pending = facilities.filter(f =>
    (!f['ステータス'] || f['ステータス'] === '未処理') &&
    !sentUrls.has(f['フォームURL'])
  );

  const dailyLimit      = config.settings.daily_limit       ?? 999999;
  const parallelWorkers = config.settings.parallel_contexts  ?? 1;
  const delayMs         = config.settings.delay_between_sites_ms ?? 3000;
  const sendWindow      = config.settings.send_window || null;
  const target = SAMPLE_N ? pending.slice(0, SAMPLE_N) : pending.slice(0, dailyLimit);

  // 送信時間帯チェック（時間外なら時間内になるまで待機）
  async function waitForSendWindow() {
    if (!sendWindow || DRY_RUN) return;
    while (true) {
      const now = new Date();
      const hhmm = now.getHours() * 60 + now.getMinutes();
      const [sh, sm] = sendWindow.start.split(':').map(Number);
      const [eh, em] = sendWindow.end.split(':').map(Number);
      const startMin = sh * 60 + sm;
      const endMin   = eh * 60 + em;
      if (hhmm >= startMin && hhmm < endMin) return;
      const nextStart = new Date(now);
      if (hhmm >= endMin) nextStart.setDate(nextStart.getDate() + 1);
      nextStart.setHours(sh, sm, 0, 0);
      const waitSec = Math.ceil((nextStart - now) / 1000);
      console.log(`⏸  送信時間外（${sendWindow.start}〜${sendWindow.end}）。${sendWindow.start} まで待機中... (残り約${Math.ceil(waitSec/60)}分)`);
      await new Promise(r => setTimeout(r, Math.min(waitSec * 1000, 60000)));
    }
  }

  const modeLabel = DRY_RUN ? 'ドライラン（送信なし）'
                 : SAMPLE_N ? `サンプル送信 ${SAMPLE_N}件`
                 :            '全件送信';

  console.log(`\n${'='.repeat(50)}`);
  console.log(`FilmLink フォーム送信ツール`);
  console.log(`モード      : ${modeLabel}`);
  console.log(`キャンペーン: ${CAMPAIGN || '旧来モード（facilities.csv）'}`);
  console.log(`送信時間帯  : ${sendWindow ? `${sendWindow.start}〜${sendWindow.end}` : '制限なし'}`);
  console.log(`対象件数    : ${target.length}件 / 上限: ${dailyLimit}件 / 並列: ${parallelWorkers}`);
  console.log(`${'='.repeat(50)}\n`);

  const browser = await chromium.launch({ headless: false });
  const results = [];
  const resultsLock = { busy: false };

  // スレッドセーフな結果書き込み
  async function saveResult(row) {
    while (resultsLock.busy) await new Promise(r => setTimeout(r, 50));
    resultsLock.busy = true;
    try {
      const existing = fs.existsSync(resultsPath)
        ? parse(fs.readFileSync(resultsPath, 'utf8'), { columns: true, skip_empty_lines: true })
        : [];
      fs.writeFileSync(resultsPath, stringify([...existing, row], { header: true }));
    } finally {
      resultsLock.busy = false;
    }
  }

  // 並列ワーカーで処理（concurrent pool）
  try {
    const queue = [...target];
    let globalIndex = 0;

    async function worker() {
      while (true) {
        const facility = queue.shift();
        if (!facility) break;
        await waitForSendWindow();
        const idx = globalIndex++;
        const result = await processFacility(browser, facility, idx, target.length);
        results.push(result);
        await saveResult(result);
        if (!DRY_RUN && queue.length > 0) {
          await new Promise(r => setTimeout(r, delayMs));
        }
      }
    }

    await Promise.all(Array.from({ length: parallelWorkers }, worker));
  } finally {
    await browser.close();
  }

  const ok      = results.filter(r => r['送信結果'] === '送信完了').length;
  const dry     = results.filter(r => r['送信結果'].includes('ドライラン')).length;
  const ng      = results.filter(r => ['エラー','送信ボタン未発見'].includes(r['送信結果'])).length;
  const skipped = results.filter(r => r['送信結果'].includes('スキップ')).length;

  console.log(`\n${'='.repeat(50)}`);
  console.log(`完了サマリー`);
  if (DRY_RUN) {
    console.log(`  ドライラン完了: ${dry}件`);
  } else {
    console.log(`  送信完了: ${ok}件`);
    console.log(`  エラー:   ${ng}件`);
  }
  console.log(`  スキップ: ${skipped}件（URL未設定）`);
  console.log(`  結果ファイル: ${resultsPath}`);
  console.log(`${'='.repeat(50)}\n`);
})();
