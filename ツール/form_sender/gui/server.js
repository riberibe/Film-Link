const express = require('express');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');
const { spawn } = require('child_process');
const { execSync } = require('child_process');

const app = express();
const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config.json');

app.use(express.json());
app.use(express.static(__dirname));

// ─── Config ─────────────────────────────────────────
app.get('/api/config', (req, res) => {
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  res.json(cfg);
});

app.post('/api/config', (req, res) => {
  const current = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const updated = { ...current, ...req.body };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2), 'utf8');
  res.json({ ok: true });
});

// ─── Campaigns ──────────────────────────────────────
app.get('/api/campaigns', (req, res) => {
  const dir = path.join(ROOT, 'campaigns');
  if (!fs.existsSync(dir)) return res.json([]);
  const campaigns = fs.readdirSync(dir)
    .filter(d => fs.statSync(path.join(dir, d)).isDirectory())
    .map(d => {
      const msgPath = path.join(dir, d, 'message.txt');
      const csvPath = getCsvPath(d);
      let stats = { total: 0, pending: 0, sent: 0 };
      if (csvPath && fs.existsSync(csvPath)) {
        try {
          const rows = parse(fs.readFileSync(csvPath, 'utf8'), { columns: true, skip_empty_lines: true, relax_quotes: true, relax_column_count: true });
          const isShodan = rows[0] && rows[0]['お問い合わせフォーム'] !== undefined;
          if (isShodan) {
            // SHODANフォーマット: フォームURLがあるものをカウント
            const withForm = rows.filter(r => r['お問い合わせフォーム'] && r['お問い合わせフォーム'].trim());
            stats.total = rows.length;
            stats.pending = withForm.length;
            stats.sent = 0;
          } else {
            stats.total = rows.length;
            stats.pending = rows.filter(r => !r['ステータス'] || r['ステータス'] === '未処理').length;
            stats.sent = rows.filter(r => r['ステータス'] === '送信済').length;
          }
        } catch (_) {}
      }
      return { id: d, name: d.replace(/^\d+_/, ''), hasMessage: fs.existsSync(msgPath), csvPath, stats };
    });
  res.json(campaigns);
});

app.get('/api/campaigns/:id/message', (req, res) => {
  const msgPath = path.join(ROOT, 'campaigns', req.params.id, 'message.txt');
  if (!fs.existsSync(msgPath)) return res.json({ subject: '', body: '' });
  const lines = fs.readFileSync(msgPath, 'utf8').trim().split('\n');
  const subjLine = lines.find(l => l.startsWith('件名:'));
  const subjIdx = subjLine ? lines.indexOf(subjLine) : -1;
  const subject = subjLine ? subjLine.replace(/^件名:\s*/, '').trim() : '';
  const body = subjIdx >= 0 ? lines.slice(subjIdx + 2).join('\n').trim() : lines.join('\n');
  res.json({ subject, body });
});

app.post('/api/campaigns/:id/message', (req, res) => {
  const { subject, body } = req.body;
  const msgPath = path.join(ROOT, 'campaigns', req.params.id, 'message.txt');
  const content = `件名: ${subject}\n\n${body}`;
  fs.writeFileSync(msgPath, content, 'utf8');
  res.json({ ok: true });
});

// ─── Facilities ──────────────────────────────────────
app.get('/api/campaigns/:id/facilities', (req, res) => {
  const csvPath = getCsvPath(req.params.id);
  if (!csvPath || !fs.existsSync(csvPath)) return res.json({ rows: [], csvPath: null });
  try {
    const rows = parse(fs.readFileSync(csvPath, 'utf8'), { columns: true, skip_empty_lines: true, relax_quotes: true, relax_column_count: true });
    res.json({ rows: rows.slice(0, 200), csvPath, total: rows.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Results ──────────────────────────────────────────
app.get('/api/results', (req, res) => {
  const campaign = req.query.campaign;
  let resultsPath;
  if (campaign) {
    resultsPath = path.join(ROOT, 'campaigns', campaign, 'results.csv');
    if (!fs.existsSync(resultsPath)) resultsPath = path.join(ROOT, 'results.csv');
  } else {
    resultsPath = path.join(ROOT, 'results.csv');
  }
  if (!fs.existsSync(resultsPath)) return res.json([]);
  try {
    const rows = parse(fs.readFileSync(resultsPath, 'utf8'), { columns: true, skip_empty_lines: true });
    res.json(rows.slice(0, 500));
  } catch (_) { res.json([]); }
});

// ─── Send (SSE) ───────────────────────────────────────
let sendProcess = null;

app.post('/api/send', (req, res) => {
  const { campaign, mode, sample } = req.body; // mode: 'dry' | 'live'
  if (sendProcess) return res.status(409).json({ error: '既に実行中です' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  const args = ['send_forms.js'];
  if (mode === 'dry') args.push('--dry');
  if (campaign) { args.push('--campaign'); args.push(`campaigns/${campaign}`); }
  if (sample) { args.push('--sample'); args.push(String(sample)); }

  sendProcess = spawn('node', args, { cwd: ROOT });

  // ブラウザへの書き込みが可能かどうかフラグで管理
  let resAlive = true;
  const send = (type, data) => {
    if (!resAlive) return;
    try { res.write(`data: ${JSON.stringify({ type, data })}\n\n`); } catch (_) {}
  };

  sendProcess.stdout.on('data', d => send('log', d.toString()));
  sendProcess.stderr.on('data', d => send('err', d.toString()));
  sendProcess.on('close', code => {
    send('done', `プロセス終了 (code: ${code})`);
    if (resAlive) { try { res.end(); } catch (_) {} }
    resAlive = false;
    sendProcess = null;
  });

  // ブラウザ接続が切れてもプロセスは止めない（結果はCSVに保存される）
  req.on('close', () => { resAlive = false; });
});

app.post('/api/send/stop', (req, res) => {
  if (sendProcess) { sendProcess.kill(); sendProcess = null; }
  res.json({ ok: true });
});

app.get('/api/send/status', (req, res) => {
  res.json({ running: !!sendProcess });
});

// ─── Helpers ──────────────────────────────────────────
function getCsvPath(campaignId) {
  const inCampaign = path.join(ROOT, 'campaigns', campaignId, 'alive.csv');
  if (fs.existsSync(inCampaign)) return inCampaign;
  const slug = campaignId.replace(/^\d+_/, '');
  const bySlug = path.join(ROOT, `facilities_${slug}.csv`);
  if (fs.existsSync(bySlug)) return bySlug;
  const csvFiles = fs.readdirSync(ROOT).filter(f => f.endsWith('.csv') && f.startsWith('facilities_'));
  return csvFiles.length ? path.join(ROOT, csvFiles[0]) : null;
}

// ─── Start ────────────────────────────────────────────
const PORT = 3737;
app.listen(PORT, () => {
  console.log(`\n✦ FilmLink 管理ツール起動中`);
  console.log(`  → http://localhost:${PORT} をブラウザで開いてください\n`);
  try { execSync(`open http://localhost:${PORT}`); } catch (_) {}
});
