const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');

const HEADERS = ['No.', '施設名', '業種', '都道府県', '市区町村', '月額費用', 'HP_URL', 'フォームURL', 'ステータス'];

const INDUSTRY_SLUG = {
  '老人ホーム': 'kaigo',
  '有料老人ホーム': 'kaigo',
  '介護施設': 'kaigo',
  '結婚式場': 'wedding',
  'ブライダル': 'wedding',
  '工務店': 'koumuten',
  'ハウスメーカー': 'koumuten',
  '工務店・ハウスメーカー': 'koumuten',
  'パーソナルジム': 'gym',
  'ペットサロン': 'pet',
  '葬儀社': 'sougi',
};

class CsvManager {
  constructor(industry) {
    const slug = INDUSTRY_SLUG[industry] || industry.replace(/[^\w]/g, '_');
    this.filePath = path.join(__dirname, '..', `facilities_${slug}.csv`);
    this.records = [];
    this.existingNames = new Set();
    this.existingUrls = new Set();
    this.maxNo = 0;
    this._load();
  }

  _load() {
    if (!fs.existsSync(this.filePath)) return;
    const raw = fs.readFileSync(this.filePath, 'utf8');
    this.records = parse(raw, { columns: true, skip_empty_lines: true });
    for (const r of this.records) {
      if (r['施設名']) this.existingNames.add(r['施設名']);
      if (r['HP_URL']) this.existingUrls.add(r['HP_URL']);
      const n = parseInt(r['No.'], 10);
      if (!isNaN(n) && n > this.maxNo) this.maxNo = n;
    }
  }

  isDuplicate(name, hpUrl) {
    if (name && this.existingNames.has(name)) return true;
    if (hpUrl && this.existingUrls.has(hpUrl)) return true;
    return false;
  }

  append(facility) {
    this.maxNo++;
    const record = { 'No.': String(this.maxNo), ...facility };
    this.records.push(record);
    if (facility['施設名']) this.existingNames.add(facility['施設名']);
    if (facility['HP_URL']) this.existingUrls.add(facility['HP_URL']);
    fs.writeFileSync(this.filePath, stringify(this.records, { header: true, columns: HEADERS }));
    return record;
  }

  get count() {
    return this.records.length;
  }
}

module.exports = { CsvManager };
