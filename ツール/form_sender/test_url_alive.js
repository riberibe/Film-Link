#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const CSV_PATH = path.join(__dirname, 'shodan_test.csv.csv');
const LIMIT = 100;
const TIMEOUT_MS = 10000;
const CONCURRENCY = 10;

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) {
      out.push(cur); cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function readRows(p, limit) {
  const text = fs.readFileSync(p, 'utf8');
  const lines = text.split(/\r?\n/);
  const header = parseCsvLine(lines[0]);
  const idxName = header.indexOf('会社名');
  const idxUrl = header.indexOf('お問い合わせフォーム');
  const rows = [];
  for (let i = 1; i < lines.length && rows.length < limit; i++) {
    if (!lines[i]) continue;
    const cols = parseCsvLine(lines[i]);
    rows.push({ name: cols[idxName] || '', url: cols[idxUrl] || '' });
  }
  return rows;
}

function classifyUrl(raw) {
  if (!raw) return { ok: false, reason: 'URL欄が空' };
  const trimmed = raw.trim();
  if (/^https?:\/\/\d{2,4}-\d{2,4}-\d{2,4}/.test(trimmed)) {
    return { ok: false, reason: '電話番号がURL欄に混入' };
  }
  try {
    const u = new URL(trimmed);
    if (!['http:', 'https:'].includes(u.protocol)) return { ok: false, reason: 'プロトコル不正' };
    if (!u.hostname.includes('.')) return { ok: false, reason: 'ホスト名不正' };
    return { ok: true, url: trimmed };
  } catch {
    return { ok: false, reason: 'URLパース失敗' };
  }
}

async function checkAlive(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    let res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FilmLinkBot/1.0)' },
    });
    clearTimeout(timer);
    return { status: res.status, finalUrl: res.url, ok: res.ok };
  } catch (e) {
    clearTimeout(timer);
    return { status: null, error: e.code || e.name || e.message, ok: false };
  }
}

async function processOne(row, idx) {
  const cls = classifyUrl(row.url);
  if (!cls.ok) {
    return { no: idx + 1, name: row.name, url: row.url, verdict: 'NG', detail: cls.reason, category: cls.reason };
  }
  const r = await checkAlive(cls.url);
  if (r.ok) return { no: idx + 1, name: row.name, url: row.url, verdict: 'OK', detail: `HTTP ${r.status}`, category: 'OK' };
  if (r.status) return { no: idx + 1, name: row.name, url: row.url, verdict: 'NG', detail: `HTTP ${r.status}`, category: `HTTP ${r.status}` };
  return { no: idx + 1, name: row.name, url: row.url, verdict: 'NG', detail: r.error, category: r.error };
}

async function runWithConcurrency(rows, conc) {
  const results = new Array(rows.length);
  let cursor = 0;
  const workers = Array.from({ length: conc }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= rows.length) break;
      results[i] = await processOne(rows[i], i);
      if ((i + 1) % 10 === 0) process.stderr.write(`  進捗: ${i + 1}/${rows.length}\n`);
    }
  });
  await Promise.all(workers);
  return results;
}

(async () => {
  const rows = readRows(CSV_PATH, LIMIT);
  console.log(`\n=== 先頭${rows.length}件のURL生存チェック（並列${CONCURRENCY}）===\n`);
  const t0 = Date.now();
  const results = await runWithConcurrency(rows, CONCURRENCY);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  for (const r of results) {
    const mark = r.verdict === 'OK' ? '✅' : '❌';
    console.log(`${mark} #${String(r.no).padStart(3)} [${r.detail}] ${r.name}  ${r.url}`);
  }

  const okCount = results.filter(r => r.verdict === 'OK').length;
  const ngCount = results.length - okCount;
  const breakdown = {};
  for (const r of results) breakdown[r.category] = (breakdown[r.category] || 0) + 1;

  console.log(`\n========== 集計 ==========`);
  console.log(`所要時間: ${elapsed}秒`);
  console.log(`✅ 生存: ${okCount} / ${results.length} 件 (${(okCount / results.length * 100).toFixed(1)}%)`);
  console.log(`❌ NG  : ${ngCount} 件`);
  console.log(`\n--- 内訳 ---`);
  Object.entries(breakdown).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
    console.log(`  ${k}: ${v}件`);
  });
})();
