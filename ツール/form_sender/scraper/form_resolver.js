const CHAIN_PATTERNS = require('./chain_patterns');

// 施設名とHP_URLをもとにフォームURLとステータスを決定する
function resolveFormUrl(name, hpUrl) {
  const searchStr = `${name} ${hpUrl || ''}`.toLowerCase();

  for (const chain of CHAIN_PATTERNS) {
    const matched = chain.match.some(p => searchStr.includes(p.toLowerCase()));
    if (matched) {
      return {
        formUrl: chain.formUrl ?? hpUrl ?? '',
        status: chain.status ?? '未処理',
      };
    }
  }

  // パターン未一致 → HP_URLをそのままセット（send_forms.js の findContactUrl が自動探索）
  return { formUrl: hpUrl || '', status: '未処理' };
}

module.exports = { resolveFormUrl };
