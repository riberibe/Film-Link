#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const CSV_PATH = process.argv[2] || path.join(__dirname, 'shodan_test.csv.csv');
const ALIVE_OUT = path.join(__dirname, 'shodan_alive.csv');
const NG_OUT    = path.join(__dirname, 'shodan_ng.csv');
const CONCURRENCY = 20;
const TIMEOUT_MS  = 10000;

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

function readRows(p) {
  const text = fs.readFileSync(p, 'utf8');
  const lines = text.split(/\r?\n/).filter(l => l);
  const header = parseCsvLine(lines[0]);
  const idxName = header.indexOf('会社名');
  const idxUrl  = header.indexOf('お問い合わせフォーム');
  const idxAddr = header.indexOf('本社住所');
  const idxIndustry = header.indexOf('業界');
  return { header, rows: lines.slice(1).map(l => {
    const cols = parseCsvLine(l);
    return {
      name:     cols[idxName]     || '',
      url:      cols[idxUrl]      || '',
      address:  cols[idxAddr]     || '',
      industry: cols[idxIndustry] || '',
      raw:      l,
    };
  })};
}

function classifyUrl(raw) {
  if (!raw) return { ok: false, reason: 'URL欄が空' };
  const t = raw.trim();
  if (/^https?:\/\/\d{2,4}[-–]\d{2,4}[-–]\d{2,4}/.test(t))
    return { ok: false, reason: '電話番号混入' };
  try {
    const u = new URL(t);
    if (!['http:', 'https:'].includes(u.protocol)) return { ok: false, reason: 'プロトコル不正' };
    if (!u.hostname.includes('.'))                  return { ok: false, reason: 'ホスト不正' };
    return { ok: true, url: t };
  } catch {
    return { ok: false, reason: 'URLパース失敗' };
  }
}

async function checkAlive(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FilmLinkBot/1.0)' },
    });
    clearTimeout(timer);
    return { status: res.status, ok: res.ok };
  } catch (e) {
    clearTimeout(timer);
    return { status: null, error: e.code || e.name, ok: false };
  }
}

async function processOne(row) {
  const cls = classifyUrl(row.url);
  if (!cls.ok) return { ...row, verdict: 'NG', detail: cls.reason };
  const r = await checkAlive(cls.url);
  if (r.ok)      return { ...row, verdict: 'OK',  detail: `HTTP ${r.status}` };
  if (r.status)  return { ...row, verdict: 'NG',  detail: `HTTP ${r.status}` };
  return           { ...row, verdict: 'NG',  detail: r.error || 'error' };
}

(async () => {
  const { header, rows } = readRows(CSV_PATH);
  const total = rows.length;
  console.log(`\n対象: ${total}件 | 並列数: ${CONCURRENCY}\n処理中...`);

  const results = new Array(total);
  let cursor = 0;
  let done   = 0;
  const t0 = Date.now();

  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= total) break;
      results[i] = await processOne(rows[i]);
      done++;
      if (done % 100 === 0 || done === total) {
        const pct  = ((done / total) * 100).toFixed(1);
        const sec  = ((Date.now() - t0) / 1000).toFixed(0);
        const eta  = done < total
          ? Math.round((Date.now() - t0) / done * (total - done) / 1000) + 's'
          : '完了';
        process.stderr.write(`\r  ${done}/${total} (${pct}%) 経過:${sec}s 残:${eta}  `);
      }
    }
  }));

  process.stderr.write('\n');

  const alive = results.filter(r => r.verdict === 'OK');
  const ng    = results.filter(r => r.verdict === 'NG');

  // alive CSV: 元ヘッダー行そのまま
  const aliveLines = [header.join(','), ...alive.map(r => r.raw)];
  fs.writeFileSync(ALIVE_OUT, aliveLines.join('\n'), 'utf8');

  // NG CSV: 元ヘッダー + 理由列
  const ngLines = [header.join(',') + ',NG理由', ...ng.map(r => r.raw + `,"${r.detail}"`)];
  fs.writeFileSync(NG_OUT, ngLines.join('\n'), 'utf8');

  // 集計
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const breakdown = {};
  ng.forEach(r => breakdown[r.detail] = (breakdown[r.detail] || 0) + 1);

  console.log(`\n========== 完了 ==========`);
  console.log(`所要時間   : ${elapsed}秒`);
  console.log(`✅ 生存    : ${alive.length} 件 (${(alive.length/total*100).toFixed(1)}%)`);
  console.log(`❌ NG      : ${ng.length}  件`);
  console.log(`\n--- NG内訳 ---`);
  Object.entries(breakdown).sort((a,b) => b[1]-a[1]).forEach(([k,v]) => {
    console.log(`  ${k}: ${v}件`);
  });
  console.log(`\n出力ファイル:`);
  console.log(`  ✅ ${ALIVE_OUT}`);
  console.log(`  ❌ ${NG_OUT}`);
})();
