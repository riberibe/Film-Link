/**
 * FilmLink リストビルダー — CSV書き出し
 *
 * 施設リストを facilities.csv 形式で書き出す。
 * 出力先: ../form_sender/facilities_[業種]_YYYYMMDD.csv
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { stringify } = require('csv-stringify/sync');

/**
 * 今日の日付を YYYYMMDD 形式で返す
 */
function getTodayStr() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/**
 * 施設リストをCSVに書き出す
 *
 * @param {Array}  items    - 施設リスト
 * @param {string} industry - 業種名 (ファイル名に使用)
 * @returns {Promise<string>} - 出力ファイルのパス
 */
async function writeCSV(items, industry) {
  const outputDir = path.join(__dirname, '..', 'form_sender');
  const dateStr = getTodayStr();
  const fileName = `facilities_${industry}_${dateStr}.csv`;
  const filePath = path.join(outputDir, fileName);

  // 出力先ディレクトリが存在しない場合は作成
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // CSV ヘッダー (form_sender/facilities.csv と同じ列順)
  const header = ['No.', '施設名', '都道府県', '市区町村', '月額費用', 'HP_URL', 'フォームURL', 'ステータス'];

  // データ行を作成
  const rows = items.map((item, idx) => [
    String(idx + 1),           // No. (1始まり)
    item.name || '',
    item.prefecture || '',
    item.city || '',
    '',                        // 月額費用 (空白)
    item.hp_url || '',
    item.form_url || '',
    item.status || '未処理',
  ]);

  const csvContent = stringify([header, ...rows], {
    bom: true,  // Excel で文字化けしないように BOM を付ける
  });

  fs.writeFileSync(filePath, csvContent, 'utf8');

  console.log(`[output] CSV書き出し完了: ${filePath}`);
  console.log(`[output] 件数: ${items.length}件`);

  return filePath;
}

module.exports = { writeCSV };
