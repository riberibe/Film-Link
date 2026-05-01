// ─── State ───────────────────────────────────────────
let campaigns = [];
let currentFilter = 'all';
let allResults = [];
let running = false;

// ─── Init ────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  loadConfig();
  loadCampaigns();
  pollStatus();
});

// ─── Tabs ────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    });
  });
}

// ─── Config ──────────────────────────────────────────
async function loadConfig() {
  const cfg = await fetch('/api/config').then(r => r.json());
  const s = cfg.sender || {};
  const set = cfg.settings || {};
  setVal('cfg-name', s.name);
  setVal('cfg-company', s.company);
  setVal('cfg-last_name', s.last_name);
  setVal('cfg-first_name', s.first_name);
  setVal('cfg-last_name_kana', s.last_name_kana);
  setVal('cfg-first_name_kana', s.first_name_kana);
  setVal('cfg-email', s.email);
  setVal('cfg-phone', s.phone);
  setVal('cfg-fax', s.fax);
  setVal('cfg-postal_code', s.postal_code);
  setVal('cfg-address', s.address);
  setVal('cfg-daily_limit', set.daily_limit);
  setVal('cfg-parallel_contexts', set.parallel_contexts);
  setVal('cfg-delay_ms', set.delay_between_sites_ms);
  setVal('cfg-send_start', (set.send_window || {}).start || '09:00');
  setVal('cfg-send_end',   (set.send_window || {}).end   || '18:00');
}

async function saveConfig() {
  const cfg = await fetch('/api/config').then(r => r.json());
  cfg.sender = {
    ...cfg.sender,
    name:            getVal('cfg-name'),
    company:         getVal('cfg-company'),
    last_name:       getVal('cfg-last_name'),
    first_name:      getVal('cfg-first_name'),
    last_name_kana:  getVal('cfg-last_name_kana'),
    first_name_kana: getVal('cfg-first_name_kana'),
    email:           getVal('cfg-email'),
    phone:           getVal('cfg-phone'),
    fax:             getVal('cfg-fax'),
    postal_code:     getVal('cfg-postal_code'),
    address:         getVal('cfg-address'),
  };
  cfg.settings = {
    ...cfg.settings,
    daily_limit:            parseInt(getVal('cfg-daily_limit'))        || 1000,
    parallel_contexts:      parseInt(getVal('cfg-parallel_contexts'))  || 4,
    delay_between_sites_ms: parseInt(getVal('cfg-delay_ms'))           || 3000,
    send_window: {
      start: getVal('cfg-send_start') || '09:00',
      end:   getVal('cfg-send_end')   || '18:00',
    },
  };
  await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg) });
  showToast('設定を保存しました', 'success');
  document.getElementById('cfgSaveMsg').textContent = '保存済 ' + now();
}

// ─── Campaigns ───────────────────────────────────────
async function loadCampaigns() {
  campaigns = await fetch('/api/campaigns').then(r => r.json());
  const selects = ['msgCampaignSelect', 'sendCampaignSelect', 'resultsCampaignSelect'];
  selects.forEach(id => {
    const el = document.getElementById(id);
    const prev = el.value;
    el.innerHTML = '<option value="">── キャンペーンを選択 ──</option>';
    campaigns.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = `${c.id} （${c.stats.total}件）`;
      el.appendChild(opt);
    });
    if (prev) el.value = prev;
  });
}

// ─── Message ─────────────────────────────────────────
async function loadMessage() {
  const id = document.getElementById('msgCampaignSelect').value;
  if (!id) {
    document.getElementById('msgEditor').style.display = 'none';
    document.getElementById('msgPlaceholder').style.display = '';
    updateBadge(null);
    return;
  }
  updateBadge(id);
  const msg = await fetch(`/api/campaigns/${id}/message`).then(r => r.json());
  setVal('msgSubject', msg.subject);
  setVal('msgBody', msg.body);
  updateCharCount(document.getElementById('msgBody'), 'msgBodyCount');
  document.getElementById('msgEditor').style.display = 'block';
  document.getElementById('msgPlaceholder').style.display = 'none';
}

async function saveMessage() {
  const id = document.getElementById('msgCampaignSelect').value;
  if (!id) return;
  await fetch(`/api/campaigns/${id}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subject: getVal('msgSubject'), body: getVal('msgBody') }),
  });
  showToast('文面を保存しました', 'success');
  document.getElementById('msgSaveMsg').textContent = '保存済 ' + now();
}

// ─── Send ─────────────────────────────────────────────
async function onSendCampaignChange() {
  const id = document.getElementById('sendCampaignSelect').value;
  updateBadge(id || null);
  if (!id) { document.getElementById('sendStats').style.display = 'none'; return; }
  const c = campaigns.find(c => c.id === id);
  if (!c) return;
  document.getElementById('statTotal').textContent = c.stats.total;
  document.getElementById('statPending').textContent = c.stats.pending;
  document.getElementById('statSent').textContent = c.stats.sent;
  document.getElementById('sendStats').style.display = 'flex';
}

let evtSource = null;

function startSend() {
  const campaign = document.getElementById('sendCampaignSelect').value;
  const mode = document.getElementById('sendMode').value;
  const sample = document.getElementById('sendSample').value.trim();

  if (mode === 'live' && !campaign) {
    showToast('キャンペーンを選択してください', 'error');
    return;
  }
  if (mode === 'live' && !confirm('本番送信します。よろしいですか？')) return;

  const term = document.getElementById('logTerminal');
  term.innerHTML = '';
  setRunning(true);

  fetch('/api/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ campaign: campaign || null, mode, sample: sample ? parseInt(sample) : null }),
  }).then(async res => {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop();
      for (const part of parts) {
        if (!part.startsWith('data:')) continue;
        try {
          const { type, data } = JSON.parse(part.slice(5).trim());
          appendLog(term, type, data);
          if (type === 'done') {
            setRunning(false);
            loadCampaigns();
          }
        } catch (_) {}
      }
    }
    setRunning(false);
  }).catch(e => {
    appendLog(term, 'err', e.message);
    setRunning(false);
  });
}

function stopSend() {
  fetch('/api/send/stop', { method: 'POST' });
  appendLog(document.getElementById('logTerminal'), 'info', '停止リクエスト送信中...');
}

function appendLog(term, type, data) {
  const line = document.createElement('span');
  const cls = type === 'done' ? 'log-done' : type === 'err' ? 'log-err' : type === 'info' ? 'log-info' : 'log-normal';
  line.className = cls;
  line.textContent = data;
  term.appendChild(line);
  term.scrollTop = term.scrollHeight;
}

function setRunning(val) {
  running = val;
  document.getElementById('btnStart').disabled = val;
  document.getElementById('btnStop').disabled = !val;
  document.getElementById('statusDot').className = 'status-dot' + (val ? ' running' : '');
}

async function pollStatus() {
  try {
    const { running: r } = await fetch('/api/send/status').then(res => res.json());
    if (r !== running) setRunning(r);
  } catch (_) {}
  setTimeout(pollStatus, 3000);
}

// ─── Results ──────────────────────────────────────────
async function loadResults() {
  const id = document.getElementById('resultsCampaignSelect').value;
  const url = id ? `/api/results?campaign=${id}` : '/api/results';
  allResults = await fetch(url).then(r => r.json());
  renderResults();
}

function setFilter(f, btn) {
  currentFilter = f;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderResults();
}

function renderResults() {
  const container = document.getElementById('resultsContainer');
  const filtered = currentFilter === 'all'
    ? allResults
    : allResults.filter(r => (r['送信結果'] || '').includes(currentFilter));

  if (!filtered.length) {
    container.innerHTML = '<div class="empty-state">該当データがありません</div>';
    return;
  }

  const badge = r => {
    const v = r['送信結果'] || '';
    if (v.includes('送信完了')) return `<span class="badge ok">送信完了</span>`;
    if (v.includes('ドライラン')) return `<span class="badge dry">ドライラン</span>`;
    if (v.includes('エラー')) return `<span class="badge err">エラー</span>`;
    return `<span class="badge skip">${v || 'スキップ'}</span>`;
  };

  container.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>No.</th>
            <th>施設名</th>
            <th>フォームURL</th>
            <th>結果</th>
            <th>エラー詳細</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(r => `
            <tr>
              <td>${r['No.'] || ''}</td>
              <td>${esc(r['施設名'] || '')}</td>
              <td class="url-cell"><a href="${esc(r['フォームURL'] || '')}" target="_blank">${esc(r['フォームURL'] || '')}</a></td>
              <td>${badge(r)}</td>
              <td style="font-size:11px; color:var(--muted);">${esc(r['エラー詳細'] || '')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ─── Helpers ──────────────────────────────────────────
function updateBadge(id) {
  const el = document.getElementById('campaignBadge');
  if (!id) { el.textContent = 'キャンペーン未選択'; el.className = 'campaign-badge none'; return; }
  const c = campaigns.find(c => c.id === id);
  el.textContent = c ? c.name : id;
  el.className = 'campaign-badge';
}

function updateCharCount(el, countId) {
  document.getElementById(countId).textContent = el.value.length + ' 文字';
}

let toastTimer;
function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  const icon = type === 'success' ? '✓' : '✕';
  document.getElementById('toastMsg').textContent = msg;
  document.getElementById('toastIcon').textContent = icon;
  t.className = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

function getVal(id) { return (document.getElementById(id) || {}).value || ''; }
function setVal(id, v) { const el = document.getElementById(id); if (el && v != null) el.value = v; }
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function now() { return new Date().toLocaleTimeString('ja-JP', { hour:'2-digit', minute:'2-digit' }); }
