#!/usr/bin/env node
/**
 * FilmLink スクレイパー — 自律補完システム
 *
 * 使い方:
 *   node scraper/index.js --industry 老人ホーム --pref 東京都 --limit 100
 *   node scraper/index.js --industry 老人ホーム --limit 10000
 *
 * 動作:
 *   industry_config.js に定義された優先順でソースを自動的に切り替え、
 *   --limit に達するまで複数サイトから補完収集する。
 *
 * オプション:
 *   --industry  業種名（例: 老人ホーム / 結婚式場 / 工務店）  ※省略時: 老人ホーム
 *   --pref      都道府県名（例: 東京都）                       ※省略時: 全国
 *   --limit     取得上限件数                                   ※省略時: 100
 *   --workers   並列ブラウザ数                                 ※省略時: 4
 */

const { Orchestrator } = require('./orchestrator');
const INDUSTRY_CONFIG = require('./industry_config');

function parseArgs() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key.startsWith('--')) {
      const next = argv[i + 1];
      args[key.slice(2)] = (next && !next.startsWith('--')) ? next : true;
      if (next && !next.startsWith('--')) i++;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs();
  const industry = args.industry || '老人ホーム';
  const pref     = args.pref     || null;
  const limit    = parseInt(args.limit   || '100', 10);
  const workers  = parseInt(args.workers || '4',   10);

  const config = INDUSTRY_CONFIG[industry];

  if (!config) {
    console.error(`\nエラー: 業種 "${industry}" は industry_config.js に未定義です。`);
    console.error(`定義済み業種: ${Object.keys(INDUSTRY_CONFIG).join(' / ')}\n`);
    process.exit(1);
  }

  if (config.adapters.length === 0) {
    console.error(`\nエラー: 業種 "${industry}" のアダプターがまだ追加されていません（${config.description}）。`);
    process.exit(1);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('FilmLink スクレイパー — 自律補完システム');
  console.log(`業種: ${industry} | 対象: ${pref || '全国'} | 上限: ${limit}件 | 並列: ${workers}ブラウザ`);
  console.log(`補完戦略: ${config.description}`);
  console.log(`${'='.repeat(60)}\n`);

  const orchestrator = new Orchestrator({ industry, pref, limit, workers, config });
  const stats = await orchestrator.run();

  process.exit(stats.errors > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('\n予期しないエラーが発生しました:');
  console.error(err.message);
  process.exit(1);
});
