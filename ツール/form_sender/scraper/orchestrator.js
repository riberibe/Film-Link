const { chromium } = require('playwright');
const { CsvManager } = require('./csv_manager');
const { SheetsManager } = require('./sheets_manager');
const { resolveFormUrl } = require('./form_resolver');

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

class Orchestrator {
  constructor({ industry, pref, limit, workers, config }) {
    this.industry = industry;
    this.pref = pref;
    this.limit = limit;
    this.workers = workers;
    this.adapterClasses = config.adapters;   // 複数アダプタークラスの配列
    this.csv = new CsvManager(industry);
    this.sheets = new SheetsManager(config.sheetName || industry);
    this.stats = { added: 0, skipped: 0, errors: 0 };
  }

  async run() {
    let remaining = this.limit;

    console.log(`補完ソース数: ${this.adapterClasses.length}個\n`);

    for (let i = 0; i < this.adapterClasses.length; i++) {
      if (remaining <= 0) break;

      const AdapterClass = this.adapterClasses[i];
      const sourceName = AdapterClass.name || `ソース${i + 1}`;

      console.log(`${'─'.repeat(50)}`);
      console.log(`[${i + 1}/${this.adapterClasses.length}] ${sourceName}`);
      console.log(`  残り取得目標: ${remaining}件`);

      // Phase 1: このソースから施設リストを収集（単一ブラウザ）
      const listBrowser = await chromium.launch({ headless: true });
      let candidates = [];

      try {
        const adapter = new AdapterClass(listBrowser);
        candidates = await adapter.fetchList({ pref: this.pref, limit: remaining });
      } catch (err) {
        console.error(`  リスト取得エラー: ${err.message.split('\n')[0]}`);
      } finally {
        await listBrowser.close();
      }

      const newCandidates = candidates.filter(f => !this.csv.isDuplicate(f.name, f.detailUrl));
      const dupCount = candidates.length - newCandidates.length;

      console.log(`  リスト取得: ${candidates.length}件 | 新規: ${newCandidates.length}件 | 重複スキップ: ${dupCount}件`);

      if (newCandidates.length === 0) {
        console.log(`  → 新規取得なし。次のソースへ。`);
        continue;
      }

      // Phase 2: 詳細取得 + 書き込み（並列ワーカー）
      console.log(`\n  詳細取得中（${this.workers}並列）...`);
      const addedBefore = this.stats.added;
      await this._runWorkers(newCandidates, AdapterClass);
      const addedFromSource = this.stats.added - addedBefore;

      remaining -= addedFromSource;
      console.log(`\n  → このソースで ${addedFromSource}件追加。残り目標: ${remaining}件`);
    }

    console.log(`\n${'='.repeat(60)}`);
    if (remaining > 0) {
      console.log(`完了（上限に届かず） — 追加: ${this.stats.added}件 / 目標: ${this.limit}件`);
      console.log(`残り ${remaining}件はすべてのソースを使い切っても取得できませんでした。`);
    } else {
      console.log(`完了（目標達成） — 追加: ${this.stats.added}件`);
    }
    console.log(`スキップ(重複): ${this.stats.skipped}件 / エラー: ${this.stats.errors}件`);
    console.log(`${'='.repeat(60)}\n`);

    return this.stats;
  }

  async _runWorkers(pending, AdapterClass) {
    const queue = [...pending];
    const total = pending.length;
    let done = 0;

    const runWorker = async (workerId) => {
      const browser = await chromium.launch({ headless: true });
      const adapter = new AdapterClass(browser);

      try {
        while (true) {
          const facility = queue.shift();
          if (!facility) break;

          try {
            const detail = await adapter.fetchDetail(facility);

            if (this.csv.isDuplicate(detail.name, detail.hpUrl)) {
              this.stats.skipped++;
            } else {
              const { formUrl, status } = resolveFormUrl(detail.name, detail.hpUrl);
              const record = {
                '施設名': detail.name,
                '業種': this.industry,
                '都道府県': detail.pref || '',
                '市区町村': detail.city || '',
                '月額費用': detail.cost || '',
                'HP_URL': detail.hpUrl || '',
                'フォームURL': formUrl,
                'ステータス': status,
              };

              const saved = this.csv.append(record);

              await this.sheets.append(saved).catch(err =>
                console.error(`\n  [Sheets] 書き込みエラー: ${err.message.split('\n')[0]}`)
              );

              this.stats.added++;
            }
          } catch (err) {
            this.stats.errors++;
            console.error(`\n  [Worker${workerId}] エラー (${facility.name}): ${err.message.split('\n')[0]}`);
          }

          done++;
          process.stdout.write(
            `\r  進捗: ${done}/${total}  追加:${this.stats.added} / スキップ:${this.stats.skipped} / エラー:${this.stats.errors}  `
          );

          await sleep(1000 + Math.random() * 1000);
        }
      } finally {
        await browser.close();
      }
    };

    await Promise.all(
      Array.from({ length: this.workers }, (_, i) => runWorker(i + 1))
    );

    process.stdout.write('\n');
  }
}

module.exports = { Orchestrator };
