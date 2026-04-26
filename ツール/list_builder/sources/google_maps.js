/**
 * FilmLink リストビルダー — Google Places API ソース
 *
 * Google Places API (Text Search) を使って施設リストを取得する。
 * APIキーは .env の GOOGLE_MAPS_API_KEY から読む。
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

/**
 * 日本語住所から都道府県と市区町村を分離する
 * 例: "東京都渋谷区代々木1-1-1" → { prefecture: "東京都", city: "渋谷区" }
 */
function parsePrefectureCity(address) {
  if (!address) return { prefecture: '', city: '' };

  // 都道府県のパターン
  const prefMatch = address.match(/^(.+?[都道府県])/);
  if (!prefMatch) return { prefecture: '', city: address };

  const prefecture = prefMatch[1];
  const rest = address.slice(prefecture.length);

  // 市区町村のパターン
  const cityMatch = rest.match(/^(.+?[市区町村郡])/);
  const city = cityMatch ? cityMatch[1] : '';

  return { prefecture, city };
}

/**
 * Google Places API (Text Search) で施設リストを取得する
 *
 * @param {object} options
 * @param {string} options.industry   - 業種名 (例: "結婚式場")
 * @param {string} options.query      - 検索クエリ (例: "結婚式場 ウエディング")
 * @param {string} options.area       - エリア (例: "東京")
 * @param {number} options.limit      - 最大取得件数
 * @returns {Promise<Array>}           - 施設リスト
 */
async function fetchFromGoogleMaps({ industry, query, area, limit }) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!apiKey || apiKey === 'your_api_key_here') {
    console.error('[google_maps] エラー: GOOGLE_MAPS_API_KEY が設定されていません。');
    console.error('[google_maps] .env ファイルに GOOGLE_MAPS_API_KEY=<APIキー> を設定してください。');
    console.error('[google_maps] Google Maps ソースをスキップして directory scraper のみで続行します。');
    return [];
  }

  const results = [];
  const searchQuery = `${query} ${area}`;
  let nextPageToken = null;

  console.log(`[google_maps] 検索クエリ: "${searchQuery}" (最大${limit}件)`);

  try {
    do {
      const params = new URLSearchParams({
        query: searchQuery,
        key: apiKey,
        language: 'ja',
        region: 'jp',
        fields: 'name,formatted_address,website,formatted_phone_number',
      });

      if (nextPageToken) {
        params.set('pagetoken', nextPageToken);
        // nextPageToken が有効になるまで2秒待つ (Google API の要件)
        await new Promise(r => setTimeout(r, 2000));
      }

      const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?${params.toString()}`;

      const response = await fetch(url);
      if (!response.ok) {
        console.error(`[google_maps] APIエラー: HTTP ${response.status}`);
        break;
      }

      const data = await response.json();

      if (data.status === 'REQUEST_DENIED') {
        console.error('[google_maps] APIエラー: リクエストが拒否されました。APIキーを確認してください。');
        console.error(`[google_maps] 詳細: ${data.error_message || '(詳細なし)'}`);
        break;
      }

      if (data.status === 'INVALID_REQUEST') {
        console.error('[google_maps] APIエラー: 無効なリクエストです。');
        break;
      }

      if (!data.results || data.results.length === 0) {
        break;
      }

      // 詳細情報を取得するために Place Details API を呼ぶ
      for (const place of data.results) {
        if (results.length >= limit) break;

        // Place Details API でウェブサイト・電話番号を取得
        let hp_url = '';
        let phone = '';

        try {
          const detailParams = new URLSearchParams({
            place_id: place.place_id,
            fields: 'website,formatted_phone_number',
            key: apiKey,
            language: 'ja',
          });
          const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?${detailParams.toString()}`;
          const detailRes = await fetch(detailUrl);

          if (detailRes.ok) {
            const detailData = await detailRes.json();
            if (detailData.result) {
              hp_url = detailData.result.website || '';
              phone = detailData.result.formatted_phone_number || '';
            }
          }
        } catch (err) {
          // 詳細取得失敗は無視して続行
        }

        const { prefecture, city } = parsePrefectureCity(place.formatted_address || '');

        results.push({
          name: place.name || '',
          prefecture,
          city,
          phone,
          hp_url,
          form_url: '',
          source: 'google_maps',
          status: '未処理',
        });

        process.stdout.write(`\r[google_maps] 取得済み: ${results.length}件`);
      }

      nextPageToken = data.next_page_token || null;
    } while (nextPageToken && results.length < limit);

  } catch (err) {
    console.error(`\n[google_maps] 予期しないエラー: ${err.message}`);
  }

  console.log(`\n[google_maps] 完了: ${results.length}件取得`);
  return results;
}

module.exports = { fetchFromGoogleMaps };
