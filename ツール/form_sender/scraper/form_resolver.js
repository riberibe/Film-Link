const CHAIN_PATTERNS = require('./chain_patterns');

// 施設名とHP_URLをもとにフォームURL/HP URL/ステータスを決定する
// hpUrl がチェーン側で定義されていれば、それを HP_URL としても返す
function resolveFormUrl(name, hpUrl) {
  const searchStr = `${name} ${hpUrl || ''}`.toLowerCase();

  for (const chain of CHAIN_PATTERNS) {
    const matched = chain.match.some(p => searchStr.includes(p.toLowerCase()));
    if (matched) {
      return {
        formUrl: chain.formUrl ?? hpUrl ?? '',
        hpUrl: chain.hpUrl ?? hpUrl ?? '',
        status: chain.status ?? '未処理',
        chainHit: true,
      };
    }
  }

  return { formUrl: hpUrl || '', hpUrl: hpUrl || '', status: '未処理', chainHit: false };
}

module.exports = { resolveFormUrl };
