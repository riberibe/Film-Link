/**
 * FilmLink — 施設お問い合わせフォーム全自動送信ツール v2
 *
 * 使い方:
 *   node send_forms.js                                      ← 全自動で送信
 *   node send_forms.js --dry                                ← ドライラン（入力まで・送信しない）
 *   node send_forms.js --campaign campaigns/01_kaigo        ← キャンペーンモード
 *   node send_forms.js --campaign campaigns/01_kaigo --sample 3 --dry
 */

'use strict';

const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');
const { parse }     = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');

// ─────────────────────────────────────────────
// 起動引数解析
// ─────────────────────────────────────────────
const _args   = process.argv.slice(2);
const DRY_RUN = _args.includes('--dry');
const CAMPAIGN = (() => { const i = _args.indexOf('--campaign'); return i !== -1 ? _args[i + 1] : null; })();
const SAMPLE_N = (() => { const i = _args.indexOf('--sample');   return i !== -1 ? parseInt(_args[i + 1]) || 3 : null; })();

// ─────────────────────────────────────────────
// config.json 読み込み
// ─────────────────────────────────────────────
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));

// キャンペーン message.txt があれば件名・本文を上書き
if (CAMPAIGN) {
  const msgPath = path.join(CAMPAIGN, 'message.txt');
  if (fs.existsSync(msgPath)) {
    const lines    = fs.readFileSync(msgPath, 'utf8').trim().split('\n');
    const subjLine = lines.find(l => l.startsWith('件名:'));
    if (subjLine) {
      config.message.subject = subjLine.replace(/^件名:\s*/, '').trim();
      const subjIdx = lines.indexOf(subjLine);
      config.message.body = lines.slice(subjIdx + 2).join('\n').trim();
    }
  }
}

// ─────────────────────────────────────────────
// SHODAN CSV 正規化
// ─────────────────────────────────────────────
function normalizeFacility(row, index) {
  if (row['フォームURL'] !== undefined) return row; // 既に内部形式
  return {
    'No.':       String(index + 1).padStart(4, '0'),
    '施設名':    row['会社名']                  || '',
    '業種':      row['業界']                   || '',
    '都道府県':  '',
    '市区町村':  row['本社住所']                || '',
    '月額費用':  '',
    'HP_URL':    '',
    'フォームURL': row['お問い合わせフォーム'] || '',
    'ステータス': '',
  };
}

// ─────────────────────────────────────────────
// 住所パーサ（シンプル版）
// ─────────────────────────────────────────────
function parseJapaneseAddress(addr) {
  const prefMatch = addr.match(/^(.{2,3}[都道府県])/);
  const pref = prefMatch ? prefMatch[1] : '';
  const rest = addr.slice(pref.length);
  const cityMatch = rest.match(/^(.+?[市区町村])/);
  const city = cityMatch ? cityMatch[1] : '';
  const block = rest.slice(city.length);
  return { pref, city, block };
}

// ─────────────────────────────────────────────
// 値マップ構築
// ─────────────────────────────────────────────
function buildValueMap(cfg) {
  const addr = cfg.sender.address || '';
  const { pref, city, block } = parseJapaneseAddress(addr);
  const postalRaw = cfg.sender.postal_code || '';
  const postalParts = postalRaw.replace(/-/g, '').match(/^(\d{3})(\d{4})$/);
  const phoneRaw = cfg.sender.phone || '';
  const phoneParts = phoneRaw.split('-');
  const faxRaw = cfg.sender.fax || '';
  const faxParts = faxRaw.split('-');

  return {
    name:            cfg.sender.name,
    last_name:       cfg.sender.last_name       || (cfg.sender.name || '').split(/[\s　]+/)[0] || '',
    first_name:      cfg.sender.first_name      || (cfg.sender.name || '').split(/[\s　]+/)[1] || '',
    last_name_kana:  cfg.sender.last_name_kana  || '',
    first_name_kana: cfg.sender.first_name_kana || '',
    email:           cfg.sender.email,
    phone:           phoneRaw,
    phone_first:     phoneParts[0] || '',
    phone_middle:    phoneParts[1] || '',
    phone_last:      phoneParts[2] || '',
    fax:             faxRaw,
    fax_first:       faxParts[0] || '',
    fax_middle:      faxParts[1] || '',
    fax_last:        faxParts[2] || '',
    subject:         cfg.message.subject,
    body:            cfg.message.body,
    company:         cfg.sender.company,
    postal_code:     postalRaw,
    postal_code_first3: postalParts ? postalParts[1] : postalRaw.slice(0, 3),
    postal_code_last4:  postalParts ? postalParts[2] : postalRaw.slice(-4),
    address:         addr,
    address_pref:    pref,
    address_city:    city,
    address_block:   block,
    address_building: '',
    position:        cfg.sender.position    || '担当者',
    department:      cfg.sender.department  || '',
    age:             cfg.sender.age         || '',
    gender:          cfg.sender.gender      || '',
    website:         cfg.sender.website     || 'https://film-links.com',
    contact_method:  cfg.sender.contact_method || 'メール',
  };
}

// ─────────────────────────────────────────────
// FieldMatcher — 7シグナル加重スコアリング
// ─────────────────────────────────────────────

// フィールドタイプ別キーワード定義
const FIELD_KEYWORDS = {
  last_name_kana:  ['sei_kana','last_name_kana','lastname_kana','sei-kana','last-kana','セイ','せい','姓（カナ）','性かな','お名前（セイ）','名前（セイ）','name_kana','shimei_kana'],
  first_name_kana: ['mei_kana','first_name_kana','firstname_kana','mei-kana','first-kana','メイ','めい','名（カナ）','名かな','お名前（メイ）','名前（メイ）'],
  last_name:       ['last_name','lastname','last-name','family_name','familyname','sei','姓','苗字','みょうじ','お名前（姓）','名前（姓）','氏（姓）','name_kanji','shimei_kanji','[last]'],
  first_name:      ['first_name','firstname','first-name','given_name','givenname','mei','下の名前','お名前（名）','名前（名）','氏（名）','[first]'],
  name:            ['your-name','お名前','氏名','fullname','full_name','full-name','contact_name','shimei','onamae',
                    'ご担当者名','担当者名','担当者','代表者名','ご氏名','お客様名','担当者様','名前'],
  email:           ['email','mail','your-email','メール','email_address','e-mail','メールアドレス',
                    'ご連絡先メール','連絡先メール','返信用メール'],
  phone_first:     ['tel1','phone1','tel_1','phone_1','tel-1','電話番号1','市外局番'],
  phone_middle:    ['tel2','phone2','tel_2','phone_2','tel-2','市内局番'],
  phone_last:      ['tel3','phone3','tel_3','phone_3','tel-3','加入者番号'],
  phone:           ['tel','phone','telephone','電話','電話番号','denwabangou','phonenumber',
                    'ご連絡先電話番号','連絡先電話番号','お電話番号'],
  fax:             ['fax','ファックス','facsimile','fax_number','ファクス'],
  fax_first:       ['fax1','fax_1','fax-1','fax[0]','ファックス1','ファクス1'],
  fax_middle:      ['fax2','fax_2','fax-2','fax[1]','ファックス2','ファクス2'],
  fax_last:        ['fax3','fax_3','fax-3','fax[2]','ファックス3','ファクス3'],
  subject:         ['subject','件名','title','お問い合わせ件名','kenmei','ご件名','件名・タイトル',
                    'お問合わせ件名','ご相談内容タイトル'],
  body:            ['message','body','本文','content','inquiry','お問い合わせ内容','text','naiyou','memo',
                    'description','details','comment','ご要望','toiawase','otoiawase','your-message',
                    'ご質問','ご相談内容','お問合せ内容','お問合わせ内容','メッセージ内容','ご連絡内容'],
  // 介護・福祉フォーム特化: 法人名/団体名/施設名/所属などを会社名として入力
  company:         ['company','会社名','organization','kaishame','組織名','corp','houjin',
                    '法人名','団体名','事業者名','施設名','ご所属','所属','所属機関',
                    '法人・団体名','御社名','貴社名','貴団体名','会社・団体名','組織・団体名',
                    'company_name','org_name','institution'],
  postal_code_first3: ['postal1','zip1','yuubin1','post1','郵便番号上','zip_1','postal_1'],
  postal_code_last4:  ['postal2','zip2','yuubin2','post2','郵便番号下','zip_2','postal_2'],
  postal_code:     ['postal','zip','郵便番号','yuubin','postcode','post_code'],
  address_pref:    ['都道府県','pref','prefecture','region'],
  address_city:    ['市区町村','city','municipality','addr2','address2'],
  address_block:   ['番地','丁目','block','addr3','address3','street'],
  address_building:['建物','マンション','building','apt','apartment','addr4'],
  address:         ['address','住所','juusho','addr','ご住所'],
  position:        ['position','役職','yakushoku'],
  department:      ['department','部署','部門','busho','section'],
  age:             ['age','年齢','nenrei'],
  gender:          ['gender','sex','性別','seibetsu'],
  website:         ['url','website','ホームページ','hp','site','homepage'],
  contact_method:  ['contact_method','連絡方法','ご連絡方法','contact-method'],
  inquiry_type:    ['inquiry_type','問い合わせ種別','お問い合わせ種別','category','種別','カテゴリ'],
  interest:        ['interest','興味','関心','hope'],
};

// 7シグナルの重みテーブル
const SIGNAL_WEIGHTS = {
  name:        30,
  id:          25,
  label:       25,
  placeholder: 20,
  ariaLabel:   15,
  surroundText:10,
  inputType:   5,
};

/**
 * 7シグナルからフィールドタイプを判定する
 */
function matchField(attrs) {
  const signals = {
    name:         (attrs.name        || '').toLowerCase(),
    id:           (attrs.id          || '').toLowerCase(),
    label:        (attrs.label       || '').toLowerCase(),
    placeholder:  (attrs.placeholder || '').toLowerCase(),
    ariaLabel:    (attrs.ariaLabel   || '').toLowerCase(),
    surroundText: (attrs.surroundText|| '').toLowerCase(),
    inputType:    (attrs.inputType   || '').toLowerCase(),
  };

  const scores = {};

  for (const [fieldType, keywords] of Object.entries(FIELD_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      const kwLower = kw.toLowerCase();
      for (const [sigName, weight] of Object.entries(SIGNAL_WEIGHTS)) {
        if (signals[sigName] && signals[sigName].includes(kwLower)) {
          score += weight;
        }
      }
    }
    if (score > 0) scores[fieldType] = (scores[fieldType] || 0) + score;
  }

  if (Object.keys(scores).length === 0) return null;

  return Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
}

// ─────────────────────────────────────────────
// FieldMatcher — Playwright要素からシグナル取得
// ─────────────────────────────────────────────
async function getFieldAttrs(inputEl) {
  return await inputEl.evaluate((el) => {
    // labelテキスト取得（for属性 or 親label要素）
    let labelText = '';
    if (el.id) {
      const lbl = document.querySelector(`label[for="${el.id}"]`);
      if (lbl) labelText = lbl.textContent.trim();
    }
    if (!labelText) {
      const parentLabel = el.closest('label');
      if (parentLabel) labelText = parentLabel.textContent.trim();
    }
    if (!labelText) {
      let sib = el.previousElementSibling;
      while (sib && !labelText) {
        if (sib.tagName === 'LABEL' || sib.tagName === 'SPAN' || sib.tagName === 'DT') {
          labelText = sib.textContent.trim();
        }
        sib = sib.previousElementSibling;
      }
    }

    // aria-label / aria-labelledby
    let ariaLabel = el.getAttribute('aria-label') || '';
    if (!ariaLabel && el.getAttribute('aria-labelledby')) {
      const lblById = document.getElementById(el.getAttribute('aria-labelledby'));
      if (lblById) ariaLabel = lblById.textContent.trim();
    }

    // 周辺テキスト（親要素のテキスト）
    let surroundText = '';
    const parent = el.parentElement;
    if (parent) {
      const txt = parent.textContent.trim().replace(/\s+/g, ' ');
      surroundText = txt.slice(0, 100);
    }

    return {
      name:         (el.name        || '').toLowerCase(),
      id:           (el.id          || '').toLowerCase(),
      placeholder:  (el.placeholder || '').toLowerCase(),
      label:        labelText.toLowerCase(),
      ariaLabel:    ariaLabel.toLowerCase(),
      surroundText: surroundText.toLowerCase(),
      inputType:    (el.type        || '').toLowerCase(),
      tag:          el.tagName.toLowerCase(),
      maxlength:    el.maxLength || -1,
      disabled:     el.disabled,
    };
  }).catch(() => ({
    name:'', id:'', placeholder:'', label:'', ariaLabel:'',
    surroundText:'', inputType:'', tag:'input', maxlength:-1, disabled:false,
  }));
}

// ─────────────────────────────────────────────
// ConsentHandler — 規約同意チェックボックス
// ─────────────────────────────────────────────
async function handleConsentCheckbox(inputEl) {
  const isDisabled = await inputEl.evaluate(el => el.disabled).catch(() => false);
  if (isDisabled) {
    try {
      await inputEl.evaluate(el => {
        const scrollArea = el.closest('[class*=terms], [class*=agree], [class*=privacy], [class*=scroll]');
        if (scrollArea) scrollArea.scrollTop = scrollArea.scrollHeight;
      });
      await new Promise(r => setTimeout(r, 500));
    } catch (_) {}
  }
  await inputEl.check({ force: true }).catch(async () => {
    await inputEl.evaluate(el => {
      el.checked = true;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }).catch(() => {});
  });
}

// ─────────────────────────────────────────────
// RadioHandler — ラジオボタン自動選択
// ─────────────────────────────────────────────
async function handleRadioButtons(page, filled) {
  if (filled['_radio']) return;
  try {
    const radios = await page.$$('input[type=radio]');
    if (radios.length === 0) return;

    // name 属性でグループ分け
    const groups = {};
    for (const radio of radios) {
      const name = await radio.evaluate(el => el.name).catch(() => '');
      if (!groups[name]) groups[name] = [];
      groups[name].push(radio);
    }

    for (const groupRadios of Object.values(groups)) {
      const anyChecked = await Promise.all(groupRadios.map(r => r.evaluate(el => el.checked))).then(arr => arr.some(Boolean));
      if (anyChecked) continue;

      const candidates = [];
      for (const radio of groupRadios) {
        const label = await radio.evaluate(el => {
          let txt = '';
          if (el.id) {
            const lbl = document.querySelector(`label[for="${el.id}"]`);
            if (lbl) txt = lbl.textContent.trim();
          }
          if (!txt) {
            const parent = el.closest('label');
            if (parent) txt = parent.textContent.trim();
          }
          return txt;
        }).catch(() => '');
        candidates.push({ radio, label });
      }

      // 優先順: その他 > ご相談 > 法人 > お問い合わせ > 最後の選択肢
      const priorities = [/その他|other/i, /ご相談|相談/i, /法人|企業|ビジネス/i, /お問い合わせ|inquiry/i];
      let chosen = null;
      for (const pat of priorities) {
        const match = candidates.find(c => pat.test(c.label));
        if (match) { chosen = match.radio; break; }
      }
      if (!chosen && candidates.length > 0) {
        chosen = candidates[candidates.length - 1].radio;
      }
      if (chosen) {
        await chosen.check({ force: true }).catch(() => {});
        filled['_radio'] = true;
      }
    }
  } catch (_) {}
}

// ─────────────────────────────────────────────
// SplitFieldHandler — 分割フィールドの値を返す
// ─────────────────────────────────────────────
function getSplitFieldValue(fieldType, valueMap) {
  const map = {
    postal_code_first3:  valueMap.postal_code_first3,
    postal_code_last4:   valueMap.postal_code_last4,
    address_pref:        valueMap.address_pref,
    address_city:        valueMap.address_city,
    address_block:       valueMap.address_block,
    address_building:    valueMap.address_building,
    phone_first:         valueMap.phone_first,
    phone_middle:        valueMap.phone_middle,
    phone_last:          valueMap.phone_last,
    fax_first:           valueMap.fax_first,
    fax_middle:          valueMap.fax_middle,
    fax_last:            valueMap.fax_last,
  };
  return fieldType in map ? map[fieldType] : null;
}

// ─────────────────────────────────────────────
// Verifier — 5層成否検証エンジン
// ─────────────────────────────────────────────
async function verify(page, urlBefore) {
  const signals = {};

  try {
    // Layer 1: URL変化
    const urlAfter = page.url();
    signals.urlChanged = urlAfter !== urlBefore;
    signals.urlIsThanksPage = /thanks?|thank[_.-]you|complete|done|sent|finish|success/i.test(urlAfter);

    // Layer 2: 成功テキスト（body全体）
    const bodyText = await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
    signals.successMessage = /ありがとうございました|ありがとうございます|送信が完了|送信しました|お問い合わせを受け付けました|受け付けいたしました|thank\s*you|successfully\s*submitted|successfully\s*sent/i.test(bodyText);

    // Layer 3: エラーテキスト（エラー要素配下のみ、誤検知回避）
    const errorText = await page.evaluate(() => {
      const sel = '.error, .errors, .alert-danger, [class*=error], [role=alert], .wpcf7-not-valid-tip, .invalid-feedback';
      return [...document.querySelectorAll(sel)].map(el => el.textContent).join(' ');
    }).catch(() => '');
    signals.errorMessage = /必須項目|入力が誤り|形式が正しくない|required|invalid|必ずご入力|入力してください|正しい.*入力/i.test(errorText);

    // Layer 4: フォーム消失（入力欄が見えなくなった）
    const visibleInputs = await page.$$eval(
      'input[type="text"], input[type="email"], input[type="tel"], textarea',
      els => els.filter(el => el.offsetParent !== null).length
    ).catch(() => 0);
    signals.formElementGone = visibleInputs === 0;

    // Layer 5: CF7専用（WordPress Contact Form 7）
    const cf7Status = await page.evaluate(() => {
      const form = document.querySelector('form.wpcf7-form, form[data-status]');
      return form ? form.getAttribute('data-status') : null;
    }).catch(() => null);
    signals.cf7Status = cf7Status;

  } catch (err) {
    signals.error = err.message;
  }

  return { signals, result: decideResult(signals) };
}

function decideResult(signals) {
  // Layer 5: CF7 最優先
  if (signals.cf7Status === 'sent')    return { ok: true,  confidence: 'high',   reason: 'cf7_sent' };
  if (signals.cf7Status === 'invalid') return { ok: false, confidence: 'high',   reason: 'cf7_invalid' };

  // Layer 3: エラー検知 → 高確度失敗
  if (signals.errorMessage)            return { ok: false, confidence: 'high',   reason: 'validation_error' };

  // Layer 1+2: 強い成功（thanks URL + 成功メッセージ）
  if (signals.urlIsThanksPage && signals.successMessage)
                                       return { ok: true,  confidence: 'high',   reason: 'thanks_url_and_message' };

  // 中程度の成功
  if (signals.successMessage && signals.formElementGone)
                                       return { ok: true,  confidence: 'medium', reason: 'message_and_form_gone' };
  if (signals.urlIsThanksPage && signals.formElementGone)
                                       return { ok: true,  confidence: 'medium', reason: 'thanks_url_and_form_gone' };

  // 弱い成功
  if (signals.urlChanged && signals.formElementGone)
                                       return { ok: true,  confidence: 'low',    reason: 'url_changed_form_gone' };

  // 成功メッセージのみ（インラインCF7等 — フォームが消えずにメッセージ表示）
  if (signals.successMessage)          return { ok: true,  confidence: 'low',    reason: 'message_only' };

  // 判定不能
  return { ok: false, confidence: 'low', reason: 'unverified' };
}

function verifyResultToRecord(verifyResult) {
  const { ok, confidence, reason } = verifyResult;
  if (ok && confidence === 'high')   return { 送信結果: '送信完了',          信頼度: 'high' };
  if (ok && confidence === 'medium') return { 送信結果: '送信完了（要確認）', 信頼度: 'medium' };
  if (ok && confidence === 'low')    return { 送信結果: '送信失敗（判定不能）', 信頼度: 'low' };
  return { 送信結果: `送信失敗: ${reason}`, 信頼度: confidence };
}

// ─────────────────────────────────────────────
// 中間ページ突破
// ─────────────────────────────────────────────
async function tryClickThroughIntermediatePage(page) {
  const currentUrl = page.url();
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

// ─────────────────────────────────────────────
// フォームURL自動探索
// ─────────────────────────────────────────────
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
      if (res && res.status() === 200 && await page.$('form')) return url;
    } catch (_) {}
  }
  return null;
}

// ─────────────────────────────────────────────
// フォーム入力・送信 コア
// ─────────────────────────────────────────────
async function fillAndSubmit(page) {
  const valueMap      = buildValueMap(config);
  const filled        = {};
  const splitDetected = {};

  async function fillInputs(inputs) {
    for (const input of inputs) {
      const attrs = await getFieldAttrs(input);

      if (['hidden', 'submit', 'button', 'image', 'reset', 'file'].includes(attrs.inputType)) continue;

      // ────── チェックボックス ──────
      if (attrs.inputType === 'checkbox') {
        const context = await input.evaluate(el => {
          const label = [...(el.labels || [])].map(l => l.textContent).join('');
          const wrap  = el.closest('label') ? el.closest('label').textContent : '';
          return (label + wrap + el.name + el.id).toLowerCase();
        }).catch(() => '');
        if (/プライバシー|個人情報|利用規約|同意|承諾|承認|了承|privacy|agree|terms|accept|consent/i.test(context)) {
          await handleConsentCheckbox(input);
        }
        continue;
      }

      // ────── セレクト ──────
      if (attrs.tag === 'select') {
        const selKey = `_select_${attrs.name || attrs.id || '_'}`;
        if (filled[selKey]) continue;
        const options = await input.$$eval('option', opts =>
          opts.map(o => ({ value: o.value, text: o.textContent.trim() })).filter(o => o.value)
        );
        const target =
          options.find(o => /その他|other/i.test(o.text)) ||
          options.find(o => /ご相談|相談/i.test(o.text)) ||
          options.find(o => /法人|企業/i.test(o.text)) ||
          options.find(o => /お問い合わせ|inquiry/i.test(o.text)) ||
          options[options.length - 1];
        if (target) {
          await input.selectOption(target.value).catch(() => {});
          filled[selKey] = true;
          filled['_select'] = true;
        }
        continue;
      }

      // ────── テキスト系フィールド ──────
      let fieldType = matchField(attrs);
      if (!fieldType) continue;

      // ── maxlength ヒューリスティック: 短い入力欄 → 分割フィールドに自動昇格 ──
      const ml = attrs.maxlength;
      const isShortInput = ml > 0 && ml <= 6;

      if (fieldType === 'phone' && isShortInput) {
        if (!filled['phone_first'])       { fieldType = 'phone_first';  splitDetected['phone'] = true; }
        else if (!filled['phone_middle']) { fieldType = 'phone_middle'; splitDetected['phone'] = true; }
        else if (!filled['phone_last'])   { fieldType = 'phone_last';   splitDetected['phone'] = true; }
        else continue;
      } else if (fieldType === 'fax' && isShortInput) {
        if (!filled['fax_first'])         { fieldType = 'fax_first';    splitDetected['fax'] = true; }
        else if (!filled['fax_middle'])   { fieldType = 'fax_middle';   splitDetected['fax'] = true; }
        else if (!filled['fax_last'])     { fieldType = 'fax_last';     splitDetected['fax'] = true; }
        else continue;
      } else if (fieldType === 'postal_code' && isShortInput) {
        if (ml === 3 || !filled['postal_code_first3']) {
          fieldType = 'postal_code_first3'; splitDetected['postal'] = true;
        } else if (!filled['postal_code_last4']) {
          fieldType = 'postal_code_last4';  splitDetected['postal'] = true;
        } else continue;
      }

      // 分割系フィールド検出フラグ
      const SPLIT_GROUPS = {
        postal_code_first3: 'postal', postal_code_last4: 'postal',
        address_pref: 'address_pref', address_city: 'address_city',
        address_block: 'address_block', address_building: 'address_building',
        phone_first: 'phone', phone_middle: 'phone', phone_last: 'phone',
        fax_first: 'fax', fax_middle: 'fax', fax_last: 'fax',
      };
      if (SPLIT_GROUPS[fieldType]) {
        splitDetected[SPLIT_GROUPS[fieldType]] = true;
      }

      // 統合欄スキップ（分割検出済みの場合）
      if (fieldType === 'postal_code' && splitDetected['postal']) continue;
      if (fieldType === 'address' && (splitDetected['address_pref'] || splitDetected['address_city'])) continue;
      if (fieldType === 'phone' && splitDetected['phone']) continue;
      if (fieldType === 'fax'   && splitDetected['fax'])   continue;
      if (fieldType === 'name' && (filled['last_name'] || filled['first_name'])) continue;

      if (filled[fieldType]) continue;

      const splitValue = getSplitFieldValue(fieldType, valueMap);
      const value = splitValue !== null ? splitValue : valueMap[fieldType];
      if (value === undefined) continue;

      await input.fill(value).catch(() => {});
      if (value) filled[fieldType] = true;
    }
  }

  // 1パス目
  const inputs = await page.$$('input, textarea, select');
  await fillInputs(inputs);

  // RadioHandler
  await handleRadioButtons(page, filled);

  // DynamicFieldWatcher: セレクト/ラジオ操作後に2秒待って再スキャン
  if (filled['_select'] || filled['_radio']) {
    await page.waitForTimeout(2000);
    const newInputs = await page.$$('input, textarea, select');
    await fillInputs(newInputs);
    await handleRadioButtons(page, filled);
  }

  // ── ドライランはここで終了 ──
  if (DRY_RUN) {
    return { result: 'ドライラン（送信なし）', filled, finalUrl: page.url() };
  }

  // ── 送信ボタン（1段目: 確認ボタン含む） ──
  const urlBefore = page.url();
  const submitSelector =
    'input[type="submit"], button[type="submit"], ' +
    'button:has-text("送信"), button:has-text("確認"), button:has-text("送る"), ' +
    'button:has-text("Submit"), button:has-text("確定"), button:has-text("問い合わせる"), ' +
    'button:has-text("Next"), button:has-text("次へ"), ' +
    'input[value*="送信"], input[value*="確認"], input[value*="Submit"]';

  const submitBtn = await page.$(submitSelector);
  if (!submitBtn) {
    return {
      result: '送信失敗: no_submit_button',
      filled,
      finalUrl: page.url(),
      failStage: 'submit',
      failDetail: '送信ボタン未発見',
    };
  }

  await submitBtn.click();
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

  // ── 2段階フォーム対応（確認画面 → 最終送信） ──
  // 先に成功・エラーを確認し、完了済みなら二度押しを避ける
  const midCheck = await verify(page, urlBefore);
  const isAlreadyDone =
    midCheck.result.confidence === 'high' ||
    (midCheck.result.confidence === 'medium' && midCheck.result.ok);

  if (!isAlreadyDone) {
    // 確認ページらしいか（「確認」「ご確認」「入力内容」などのテキストがある）を判定してから2回目クリック
    const midBodyText = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
    const looksLikeConfirm = /ご確認|入力内容.*確認|確認画面|confirm|以下の内容で/i.test(midBodyText);
    const finalSelector =
      'button[type="submit"], button:has-text("送信"), button:has-text("送る"), ' +
      'button:has-text("Submit"), button:has-text("確定"), button:has-text("完了"), ' +
      'input[type="submit"]:not([value*="戻"]), input[value*="送信"], input[value*="Submit"]';
    const finalBtn = looksLikeConfirm ? await page.$(finalSelector).catch(() => null) : null;
    if (finalBtn) {
      await finalBtn.click();
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    }
  }

  // ── Verifier ──
  const { signals, result: verifyResult } = await verify(page, urlBefore);
  const { 送信結果, 信頼度 } = verifyResultToRecord(verifyResult);

  return {
    result:     送信結果,
    confidence: 信頼度,
    reason:     verifyResult.reason,
    filled,
    finalUrl:   page.url(),
    signals,
  };
}

// ─────────────────────────────────────────────
// 施設1件処理
// ─────────────────────────────────────────────
async function processFacility(browser, facility, index, total) {
  const row = {
    ...facility,
    '送信日時':    new Date().toLocaleString('ja-JP', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }),
    '送信結果':    '',
    '信頼度':      '-',
    '失敗ステージ': '-',
    '失敗詳細':    '',
    '入力済み欄':  '',
    '最終URL':    '',
    'エラー詳細':  '',
  };

  const url = facility['フォームURL'];
  if (!url || url.includes('要確認') || url.trim() === '') {
    row['送信結果'] = 'スキップ';
    console.log(`[${index+1}/${total}] ${facility['施設名']} → スキップ（URL未設定）`);
    return row;
  }

  const page = await browser.newPage();
  try {
    console.log(`[${index+1}/${total}] ${facility['施設名']}`);

    // ── ナビゲーション ──
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    } catch (navErr) {
      navErr.stage = 'nav';
      throw navErr;
    }

    // 可視入力欄チェック（JSレンダリング待ち）
    const checkInputs = () => page.$$eval(
      'input[type="text"], input[type="email"], input[type="tel"], textarea',
      els => els.some(el => el.offsetParent !== null)
    ).catch(() => false);

    let hasVisibleInputs = await checkInputs();
    if (!hasVisibleInputs) {
      await page.waitForTimeout(3000);
      hasVisibleInputs = await checkInputs();
    }

    // 中間ページ突破 → フォームURL探索
    if (!hasVisibleInputs) {
      const clicked = await tryClickThroughIntermediatePage(page);
      if (!clicked && facility['HP_URL']) {
        const contactUrl = await findContactUrl(page, facility['HP_URL']);
        if (contactUrl) {
          await page.goto(contactUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        }
      }
    }

    // ── 入力・送信 ──
    let fillResult;
    try {
      fillResult = await fillAndSubmit(page);
    } catch (fillErr) {
      fillErr.stage = fillErr.stage || 'fill';
      throw fillErr;
    }

    const { result, confidence, reason, filled, finalUrl } = fillResult;

    row['送信結果']   = result;
    row['信頼度']     = confidence || '-';
    row['入力済み欄'] = Object.keys(filled).filter(k => !k.startsWith('_')).join(', ');
    row['最終URL']   = finalUrl || '';

    // ── ドライランのスクリーンショット（全件保存） ──
    if (DRY_RUN) {
      const dir = config.settings.screenshot_dir || './screenshots';
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const safeName = (facility['施設名'] || '').replace(/[\s/\\:*?"<>|]/g, '_');
      const noStr    = String(facility['No.'] || index).padStart(4, '0');
      const fname    = path.join(dir, `DRY_${noStr}_${safeName}.png`);
      await page.screenshot({ path: fname, fullPage: true }).catch(() => {});
      console.log(`  📸 ${fname}`);
    }

    console.log(`  → ${result}（信頼度: ${confidence || '-'}）（入力: ${row['入力済み欄']}）`);

  } catch (err) {
    const stage = err.stage || 'unknown';
    const msg   = (err.message || '').split('\n')[0];
    row['送信結果']    = `送信失敗: ${stage}_error`;
    row['信頼度']      = 'low';
    row['失敗ステージ'] = stage;
    row['失敗詳細']    = msg.slice(0, 200);
    row['エラー詳細']  = msg.slice(0, 500);
    row['最終URL']    = page.url();

    // エラー時スクリーンショット保存
    const screenshotMode = config.settings.screenshot_mode || 'errors_only';
    if (screenshotMode !== 'none') {
      const dir = config.settings.screenshot_dir || './screenshots';
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const safeName = (facility['施設名'] || '').replace(/[\s/\\:*?"<>|]/g, '_');
      const noStr    = String(facility['No.'] || index).padStart(4, '0');
      const fname    = path.join(dir, `ERR_${noStr}_${safeName}.png`);
      await page.screenshot({ path: fname, fullPage: false }).catch(() => {});
    }

    console.log(`  → エラー[${stage}]: ${msg.slice(0, 100)}`);
  } finally {
    await page.close();
  }

  return row;
}

// ─────────────────────────────────────────────
// results.csv 書き出し（スレッドセーフ）
// ─────────────────────────────────────────────
const RESULT_COLUMNS = [
  'No.', '施設名', '業種', '都道府県', '市区町村', '月額費用', 'HP_URL', 'フォームURL', 'ステータス',
  '送信日時', '送信結果', '信頼度', '失敗ステージ', '失敗詳細', '入力済み欄', '最終URL', 'エラー詳細',
];

function makeResultRow(row) {
  const out = {};
  for (const col of RESULT_COLUMNS) {
    out[col] = row[col] !== undefined ? row[col] : '';
  }
  return out;
}

async function saveResult(row, resultsPath, resultsLock) {
  while (resultsLock.busy) await new Promise(r => setTimeout(r, 50));
  resultsLock.busy = true;
  try {
    const existing = fs.existsSync(resultsPath)
      ? parse(fs.readFileSync(resultsPath, 'utf8'), { columns: true, skip_empty_lines: true })
      : [];
    fs.writeFileSync(resultsPath, stringify([...existing, makeResultRow(row)], { header: true, columns: RESULT_COLUMNS }));
  } finally {
    resultsLock.busy = false;
  }
}

// ─────────────────────────────────────────────
// 送信時間帯チェック
// ─────────────────────────────────────────────
async function waitForSendWindow(sendWindow) {
  if (!sendWindow || DRY_RUN) return;
  while (true) {
    const now  = new Date();
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
    console.log(`[待機] 送信時間外 (${sendWindow.start}〜${sendWindow.end})。残り約${Math.ceil(waitSec / 60)}分`);
    await new Promise(r => setTimeout(r, Math.min(waitSec * 1000, 60000)));
  }
}

// ─────────────────────────────────────────────
// メイン
// ─────────────────────────────────────────────
(async () => {
  // パス解決
  const csvPath     = CAMPAIGN ? path.join(CAMPAIGN, 'alive.csv')   : './facilities.csv';
  const resultsPath = CAMPAIGN ? path.join(CAMPAIGN, 'results.csv') : (config.settings.log_file || './results.csv');

  // CSV読み込み・正規化
  const raw        = fs.readFileSync(csvPath, 'utf8');
  const rawRows    = parse(raw, { columns: true, skip_empty_lines: true, relax_quotes: true, relax_column_count: true });
  const facilities = rawRows.map((r, i) => normalizeFacility(r, i));

  // 送信済みスキップ（「送信完了」と「送信完了（要確認）」の両方をスキップ対象にする）
  const sentUrls = new Set();
  if (fs.existsSync(resultsPath)) {
    try {
      const prevResults = parse(fs.readFileSync(resultsPath, 'utf8'), { columns: true, skip_empty_lines: true });
      prevResults
        .filter(r => r['送信結果'] === '送信完了' || r['送信結果'] === '送信完了（要確認）')
        .forEach(r => sentUrls.add(r['フォームURL']));
    } catch (_) {}
  }

  const pending = facilities.filter(f =>
    (!f['ステータス'] || f['ステータス'] === '未処理') &&
    !sentUrls.has(f['フォームURL'])
  );

  const dailyLimit      = config.settings.daily_limit          != null ? config.settings.daily_limit : 999999;
  const parallelWorkers = config.settings.parallel_contexts     != null ? config.settings.parallel_contexts : 1;
  const delayMs         = config.settings.delay_between_sites_ms != null ? config.settings.delay_between_sites_ms : 3000;
  const sendWindow      = config.settings.send_window           || null;
  const target = SAMPLE_N ? pending.slice(0, SAMPLE_N) : pending.slice(0, dailyLimit);

  // ── ヘッダー表示 ──
  const modeLabel = DRY_RUN ? 'ドライラン（送信なし）'
                 : SAMPLE_N ? `サンプル送信 ${SAMPLE_N}件`
                 :            '全件送信';

  console.log(`\n${'='.repeat(55)}`);
  console.log(` FilmLink フォーム送信ツール v2`);
  console.log(`${'='.repeat(55)}`);
  console.log(` モード      : ${modeLabel}`);
  console.log(` キャンペーン: ${CAMPAIGN || '旧来モード（facilities.csv）'}`);
  console.log(` 送信時間帯  : ${sendWindow ? `${sendWindow.start}〜${sendWindow.end}` : '制限なし'}`);
  console.log(` 対象件数    : ${target.length}件 / 上限: ${dailyLimit}件 / 並列: ${parallelWorkers}`);
  console.log(`${'='.repeat(55)}\n`);

  if (target.length === 0) {
    console.log('処理対象がありません。終了します。');
    return;
  }

  const browser     = await chromium.launch({ headless: false });
  const results     = [];
  const resultsLock = { busy: false };

  try {
    const queue       = [...target];
    let   globalIndex = 0;

    async function worker() {
      while (true) {
        const facility = queue.shift();
        if (!facility) break;
        await waitForSendWindow(sendWindow);
        const idx    = globalIndex++;
        const result = await processFacility(browser, facility, idx, target.length);
        results.push(result);
        await saveResult(result, resultsPath, resultsLock);
        if (!DRY_RUN && queue.length > 0) {
          await new Promise(r => setTimeout(r, delayMs));
        }
      }
    }

    await Promise.all(Array.from({ length: parallelWorkers }, worker));
  } finally {
    await browser.close();
  }

  // ── サマリー ──
  const ok       = results.filter(r => r['送信結果'] === '送信完了').length;
  const okMedium = results.filter(r => r['送信結果'] === '送信完了（要確認）').length;
  const dry      = results.filter(r => r['送信結果'] === 'ドライラン（送信なし）').length;
  const ng       = results.filter(r => r['送信結果'].startsWith('送信失敗')).length;
  const skipped  = results.filter(r => r['送信結果'] === 'スキップ').length;

  console.log(`\n${'='.repeat(55)}`);
  console.log(` 完了サマリー`);
  console.log(`${'='.repeat(55)}`);
  if (DRY_RUN) {
    console.log(` ドライラン完了   : ${dry}件`);
  } else {
    console.log(` 送信完了(high)   : ${ok}件`);
    console.log(` 送信完了(medium) : ${okMedium}件`);
    console.log(` 送信失敗         : ${ng}件`);
  }
  console.log(` スキップ         : ${skipped}件`);
  console.log(` 結果ファイル     : ${resultsPath}`);
  console.log(`${'='.repeat(55)}\n`);
})();
