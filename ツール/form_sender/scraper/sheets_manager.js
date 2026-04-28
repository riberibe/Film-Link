const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { execSync } = require('child_process');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const REAUTH_SCRIPT = '/Users/ribetyan/Desktop/リベ恋愛/scripts/get_google_token.js';

const SHEET_HEADERS = ['No.', '施設名', '業種', '都道府県', '市区町村', '月額費用', 'HP_URL', 'フォームURL', 'ステータス', '取得日時'];

// invalid_grant等の認証致命エラーかどうか判定
function isAuthFatal(err) {
  const msg = (err && err.message) || '';
  const code = err && (err.code || (err.response && err.response.data && err.response.data.error));
  return /invalid_grant|invalid_token|unauthorized|Token has been expired or revoked/i.test(msg)
      || code === 'invalid_grant';
}

class SheetsManager {
  constructor(industry) {
    this.industry = industry;
    this._initialized = false;
    this._disabled = false;
    this._loadAuth();
  }

  _loadAuth() {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    this.config = config;
    this.spreadsheetId = config.google.spreadsheet_id;

    const creds = JSON.parse(fs.readFileSync(config.google.credentials_path, 'utf8'));
    const token = JSON.parse(fs.readFileSync(config.google.token_path, 'utf8'));

    const auth = new google.auth.OAuth2(
      creds.installed.client_id,
      creds.installed.client_secret,
      'http://localhost:9999'
    );
    auth.setCredentials(token);

    // トークンが自動リフレッシュされたら保存する
    auth.on('tokens', (newTokens) => {
      try {
        const current = JSON.parse(fs.readFileSync(config.google.token_path, 'utf8'));
        fs.writeFileSync(config.google.token_path, JSON.stringify({ ...current, ...newTokens }, null, 2));
      } catch (_) {}
    });

    this.sheets = google.sheets({ version: 'v4', auth });
  }

  // 認証致命エラー時に再認証スクリプトを起動して復旧する
  // ブラウザ操作が必須のためユーザー操作待ちになるが、その後は完全自動で復旧
  async _recoverAuth() {
    console.error('\n  [Sheets] 認証エラー検知 → 再認証フローを起動します...');
    console.error(`  [Sheets] ブラウザが開きます。Google認証を完了してください。`);
    try {
      execSync(`node "${REAUTH_SCRIPT}"`, { stdio: 'inherit' });
      this._loadAuth();
      this._initialized = false;
      console.error('  [Sheets] 再認証完了 → 書き込み再開');
      return true;
    } catch (e) {
      console.error(`  [Sheets] 再認証失敗: ${e.message.split('\n')[0]}`);
      console.error(`  [Sheets] CSVには記録済み。Sheets書き込みは今回スキップします。`);
      this._disabled = true;
      return false;
    }
  }

  async init() {
    if (this._initialized) return;

    const meta = await this.sheets.spreadsheets.get({ spreadsheetId: this.spreadsheetId });
    const exists = meta.data.sheets.some(s => s.properties.title === this.industry);

    if (!exists) {
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: this.industry } } }],
        },
      });
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `'${this.industry}'!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [SHEET_HEADERS] },
      });
    }

    this._initialized = true;
  }

  // 認証エラー時は1回だけ再認証→リトライ。それでも失敗ならCSVのみで継続
  async _withAuthRetry(fn) {
    try {
      return await fn();
    } catch (err) {
      if (!isAuthFatal(err) || this._disabled) throw err;
      const ok = await this._recoverAuth();
      if (!ok) throw err;
      return await fn();
    }
  }

  async append(record) {
    if (this._disabled) return;
    await this._withAuthRetry(() => this.init());
    const row = [
      record['No.'] ?? '',
      record['施設名'] ?? '',
      record['業種'] ?? '',
      record['都道府県'] ?? '',
      record['市区町村'] ?? '',
      record['月額費用'] ?? '',
      record['HP_URL'] ?? '',
      record['フォームURL'] ?? '',
      record['ステータス'] ?? '未処理',
      new Date().toLocaleString('ja-JP'),
    ];
    await this._withAuthRetry(() => this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: `'${this.industry}'!A1`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    }));
  }
}

module.exports = { SheetsManager };
