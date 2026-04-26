/**
 * FilmLink リストビルダー — メインオーケストレーター
 *
 * 使い方:
 *   node index.js --industry 結婚式場 --area 東京 --limit 100 --source all
 *
 * オプション:
 *   --industry  業種名 (例: 結婚式場, 写真スタジオ, 有料老人ホーム)
 *   --area      エリア (例: 東京, 大阪, 神奈川)
 *   --limit     最大取得件数 (デフォルト: 100)
 *   --source    取得ソース: all | maps | directory (デフォルト: all)
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const path = require('path');
const { fetchFromGoogleMaps } = require('./sources/google_maps');
const { fetchFromDirectory } = require('./sources/directory_scraper');
const { enrichList } = require('./enrich');
const { writeCSV } = require('./output');

// 業種設定を読み込む
const industries = require('./config/industries.json');

/**
 * コマンドライン引数をパースする
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    industry: null,
    area: null,
    limit: 100,
    source: 'all',
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--industry':
        result.industry = args[++i];
        break;
      case '--area':
        result.area = args[++i];
        break;
      case '--limit':
        result.limit = parseInt(args[++i], 10) || 100;
        break;
      case '--source':
        result.source = args[++i];
        break;
    }
  }

  return result;
}

/**
 * 施設リストの重複を除去する (施設名 + 都道府県 で判定)
 */
function deduplicateItems(items) {
  const seen = new Set();
  const deduped = [];

  for (const item of items) {
    const key = `${item.name}__${item.prefecture}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(item);
    }
  }

  return deduped;
}

/**
 * メイン処理
 */
async function main() {
  const { industry, area, limit, source } = parseArgs();

  // 引数チェック
  if (!industry) {
    console.error('エラー: --industry を指定してください。');
    console.error('例: node index.js --industry 結婚式場 --area 東京');
    process.exit(1);
  }

  if (!area) {
    console.error('エラー: --area を指定してください。');
    console.error('例: node index.js --industry 結婚式場 --area 東京');
    process.exit(1);
  }

  // 業種設定チェック
  const industryConfig = industries[industry];
  if (!industryConfig) {
    const available = Object.keys(industries).join(', ');
    console.error(`エラー: 業種 "${industry}" は設定されていません。`);
    console.error(`利用可能な業種: ${available}`);
    process.exit(1);
  }

  // sourceオプションチェック
  if (!['all', 'maps', 'directory'].includes(source)) {
    console.error('エラー: --source は all, maps, directory のいずれかを指定してください。');
    process.exit(1);
  }

  console.log('========================================');
  console.log(' FilmLink リストビルダー');
  console.log('========================================');
  console.log(`業種    : ${industry}`);
  console.log(`エリア  : ${area}`);
  console.log(`上限件数: ${limit}件`);
  console.log(`ソース  : ${source}`);
  console.log('========================================');
  console.log();

  let allItems = [];

  // ① Google Maps ソース
  if (source === 'all' || source === 'maps') {
    console.log('--- [1/4] Google Maps から取得中 ---');
    try {
      const mapsItems = await fetchFromGoogleMaps({
        industry,
        query: industryConfig.google_maps_query,
        area,
        limit,
      });
      console.log(`Google Maps: ${mapsItems.length}件取得`);
      allItems.push(...mapsItems);
    } catch (err) {
      console.error(`Google Maps 取得エラー: ${err.message}`);
    }
    console.log();
  }

  // ② ディレクトリスクレイパー
  if (source === 'all' || source === 'directory') {
    console.log('--- [2/4] ディレクトリサイトから取得中 ---');
    try {
      const dirItems = await fetchFromDirectory({
        industry,
        area,
        limit,
        directorySites: industryConfig.directory_sites,
      });
      console.log(`ディレクトリ: ${dirItems.length}件取得`);
      allItems.push(...dirItems);
    } catch (err) {
      console.error(`ディレクトリ取得エラー: ${err.message}`);
    }
    console.log();
  }

  // ③ 重複除去
  console.log('--- [3/4] 重複除去 ---');
  const beforeCount = allItems.length;
  allItems = deduplicateItems(allItems);
  const removedCount = beforeCount - allItems.length;
  console.log(`重複除去: ${beforeCount}件 → ${allItems.length}件 (${removedCount}件除去)`);

  // limit を超えた場合はトリム
  if (allItems.length > limit) {
    allItems = allItems.slice(0, limit);
    console.log(`上限制限: ${limit}件に絞り込み`);
  }
  console.log();

  // ④ フォームURL補完
  console.log('--- [4/4] フォームURL補完 ---');
  try {
    allItems = await enrichList(allItems);
  } catch (err) {
    console.error(`フォームURL補完エラー: ${err.message}`);
    console.error('フォームURL補完をスキップしてCSV出力に進みます。');
  }
  console.log();

  // ⑤ CSV出力
  console.log('--- CSV出力 ---');
  let outputPath = null;
  try {
    outputPath = await writeCSV(allItems, industry);
  } catch (err) {
    console.error(`CSV出力エラー: ${err.message}`);
    process.exit(1);
  }

  // ⑥ 完了サマリー
  const formUrlCount = allItems.filter(item => item.form_url).length;
  const mapsCount = allItems.filter(item => item.source === 'google_maps').length;
  const dirCount = allItems.filter(item => item.source === 'directory').length;

  console.log();
  console.log('========================================');
  console.log(' 完了サマリー');
  console.log('========================================');
  console.log(`取得件数 (合計)     : ${allItems.length}件`);
  console.log(`  - Google Maps     : ${mapsCount}件`);
  console.log(`  - ディレクトリ    : ${dirCount}件`);
  console.log(`フォームURL発見     : ${formUrlCount}件`);
  console.log(`フォームURL未発見   : ${allItems.length - formUrlCount}件`);
  console.log(`出力ファイル        : ${outputPath}`);
  console.log('========================================');
  console.log();
  console.log('次のステップ: 出力されたCSVを form_sender/facilities.csv にリネームして');
  console.log('  cd ../form_sender && node send_forms.js --dry  でドライランを確認してください。');
}

main().catch(err => {
  console.error('予期しないエラーが発生しました:', err);
  process.exit(1);
});
