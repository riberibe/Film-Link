# 引き継ぎ書 — Node.js 施設情報スクレイパー

> 作成: 2026-04-28 by Jarvis
> 改訂: 2026-04-30（campaigns構成・SHODAN互換フォーマットへ全面更新）
> 目的: このドキュメントを新しいチャットに貼り付けて、スクレイパーの実装を依頼するための引き継ぎ書

---

## 背景・目的

FilmLink では既存事業者（介護施設・結婚式場など）への営業フォーム自動送信ツールを運用している。
現在は SHODAN Pro 経由で施設リストを取得しているが、SHODAN ではカバーできないチェーン系施設や、特定ジャンルを網羅したいケースのために、**施設情報まとめサイトからスクレイピングして CSV を生成する補助スクレイパー**を作る。

最終的な送信ツール（`send_forms.js`）は **campaigns ディレクトリ構成**に移行済みで、スクレイパーの出力もこの構成に乗せる必要がある。

---

## 現行ディレクトリ構成（重要）

```
ツール/form_sender/
├── send_forms.js                   # 送信本体（--campaign オプション対応済み）
├── check_alive_all.js              # URL生存確認ツール
├── config.json                     # 送信者情報
├── scraper/                        # スクレイパー置き場（このディレクトリに実装する）
└── campaigns/
    ├── 01_kaigo/                   # 介護施設キャンペーン
    │   ├── message.txt
    │   ├── raw_shodan.csv.csv      # SHODAN由来の生CSV
    │   ├── alive.csv               # 生存確認済み（送信対象）
    │   └── ng.csv                  # 除外
    └── 02_wedding/
        └── message.txt
```

**スクレイパーは `ツール/form_sender/scraper/` 配下に配置する**。campaigns 直下ではない（スクレイパーは複数キャンペーンで共用するため）。

---

## 既存の技術スタック

- **Node.js** + **Playwright**（インストール済み）
  - パス: `/Users/ribetyan/Desktop/ファミリームービー/ツール/form_sender/`
  - `npm install` と `npx playwright install chromium` 完了済み
- **JavaScript（Node.js）で書くこと**（Pythonは不要）

---

## 作ってほしいもの

スクリプト名: `scraper.js`
配置先: `/Users/ribetyan/Desktop/ファミリームービー/ツール/form_sender/scraper/scraper.js`

### 動作フロー

```
① スクレイピング対象サイトから施設情報を取得
      ↓
② 施設名/URLパターン（チェーン名）に基づいてフォームURLを自動割当
      ↓
③ campaigns/<キャンペーンID>/scraped.csv に追記（既存と重複する施設はスキップ）
      ↓
④ 利用者は check_alive_all.js を通して alive.csv を生成 → send_forms.js で送信
```

---

## 出力フォーマット（SHODAN互換・絶対遵守）

`send_forms.js` および `check_alive_all.js` は **SHODAN Pro の CSV カラム構成を前提**にしている。スクレイパーの出力もこのカラム順を厳守する。

### CSVヘッダ（21カラム固定）

```csv
会社名,代表電話番号,代表メール,お問い合わせフォーム,本社住所,代表者名,業界,従業員数,売上高,資本金,市場区分,設立年,決算月,概要,事業内容,タグ,Linkedin,Wantedly,Youtrust,Facebook,X
```

### 各カラムの埋め方

| カラム | 必須 | 内容 |
|---|---|---|
| 会社名 | ◯ | 施設名（運営法人名がわかればそちら） |
| 代表電話番号 | △ | 取得できれば |
| 代表メール | △ | 取得できれば |
| お問い合わせフォーム | ◯ | チェーン判定でフォームURL自動割当（後述）。不明ならHP_URLをそのまま入れる |
| 本社住所 | ◯ | 都道府県＋市区町村＋以降を結合 |
| 代表者名 | × | 空欄でOK |
| 業界 | ◯ | 介護案件なら `医療・福祉・介護 高齢者住宅（介護施設・有料老人ホーム等）` 固定 |
| 従業員数〜決算月 | × | 空欄でOK |
| 概要・事業内容 | △ | 取得できれば |
| タグ | △ | チェーン名やジャンルを入れると後段の絞り込みに便利 |
| Linkedin〜X | × | 空欄でOK |

> ⚠️ カラム数とヘッダ名は1文字も変えない。`send_forms.js` が「お問い合わせフォーム」「会社名」などの列名で参照しているため、変えると壊れる。

---

## フォームURL自動割当ルール（チェーンパターン）

施設名または取得HP_URLに以下のパターンが含まれる場合、`お問い合わせフォーム` 列に対応するURLをセット。
どのパターンにも一致しない場合は **取得した施設HP_URLをそのまま入れる**（後で `send_forms.js` の `findContactUrl()` が自動探索する）。

| パターン（小文字化して部分一致） | フォームURL |
|---|---|
| `benesse` / `ベネッセ` / `アリア` / `くらら` / `グランダ` | （**手動対応**：そのレコードは出力スキップ、または `タグ` 列に `手動対応` を付けて出力） |
| `gtl` / `グッドタイムリビング` / `グッドタイム` | `https://www.gtl-daiwa.co.jp/dc/request/index.php` |
| `nichiigakkan` / `ニチイホーム` / `ニチイ学館` | `https://pages.nichiigakkan.co.jp/palace_inquiryform_new.html` |
| `チャームケアコーポレーション` / `チャームプレミア` / `チャーム` | `https://www.charm-cc.jp/inquiry/` |
| `木下の介護` / `kinoshita` | `https://www.kinoshita-kaigo.co.jp/contact/` |
| `ツクイ` / `tsukui` | `https://www.tsukui.net/contact/` |

> パターンは**配列で管理**し、新チェーンを後から追加できる設計にすること（例: `scraper/chain_patterns.js` として外出し）。

---

## スクレイピング対象サイト（優先順）

### 1. LIFULL介護
- URL: `https://kaigo.homes.co.jp/facility/`
- 構造: 都道府県 → 市区町村 → 施設一覧（ページネーションあり）
- 取得項目: 施設名・住所・施設HP_URL（詳細ページのリンク）

### 2. みんなの介護
- URL: `https://www.minnanokaigo.com/guide/`
- 構造: 都道府県別一覧
- 取得項目: 施設名・都道府県・HP_URL

> どちらか取得しやすい方を優先。両方対応できれば理想。
> モジュール分離例: `scraper/sources/lifull.js` / `scraper/sources/minnano.js` を作り、`scraper.js` から `--source` で切り替えられる構成。

---

## 実行コマンド（CLI仕様）

```bash
cd /Users/ribetyan/Desktop/ファミリームービー/ツール/form_sender

# 介護キャンペーン用に東京都の施設を100件取得
node scraper/scraper.js --campaign 01_kaigo --pref 東京都 --limit 100

# 全国対象で500件
node scraper/scraper.js --campaign 01_kaigo --limit 500

# データソース指定
node scraper/scraper.js --campaign 01_kaigo --source lifull --pref 東京都 --limit 100
```

### 引数仕様

| フラグ | 必須 | 内容 |
|---|---|---|
| `--campaign` | ◯ | 出力先キャンペーンID（例: `01_kaigo`）。`campaigns/<ID>/` に出力 |
| `--limit` | ◯ | 最大取得件数 |
| `--pref` | × | 都道府県絞り込み（未指定なら全国） |
| `--source` | × | `lifull` / `minnano` 切替（未指定なら lifull） |

---

## 出力先と重複スキップ

- 出力ファイル: `campaigns/<キャンペーンID>/scraped.csv`
- 既存の `scraped.csv` がある場合は **追記モード**で、`会社名` ＋ `本社住所` の組み合わせが重複するレコードはスキップ
- 同じキャンペーンの `alive.csv` `ng.csv` `raw_shodan.csv.csv` 等の既存CSVも読み込んで、`会社名`重複は除外（多重送信防止）

---

## 後段フローとの接続

スクレイパー出力後、利用者は以下を手動で実行する：

```bash
# 生存確認（alive.csv / ng.csv 生成）
node check_alive_all.js campaigns/01_kaigo/scraped.csv

# サンプル3件送信
node send_forms.js --campaign campaigns/01_kaigo --sample 3

# 全件送信
node send_forms.js --campaign campaigns/01_kaigo
```

スクレイパー側ではこの後段は呼ばない（責務分離）。

---

## 注意事項

- 各リクエスト間に **1〜2秒のウェイト**を入れる（サーバー負荷配慮）
- Playwright の `chromium` を使用（インストール済み）
- ベネッセ系は手動対応のためデフォルトで出力からスキップ。`--include-manual` フラグを付けたときのみ `タグ` に `手動対応` を入れて出力する設計でも可
- 取得失敗・タイムアウトは握りつぶさず、コンソールに `[WARN]` で出してスキップ → 件数サマリを最後に表示
- HP_URLが取れない施設はそのレコード自体を出力しない（送信できないため）

---

## 参考：既存 `send_forms.js` のキャンペーン処理

```js
// send_forms.js 抜粋
const CAMPAIGN = (() => { const i = _args.indexOf('--campaign'); return i !== -1 ? _args[i + 1] : null; })();
const csvPath = CAMPAIGN ? path.join(CAMPAIGN, 'alive.csv') : './facilities.csv';
```

つまり `--campaign campaigns/01_kaigo` を渡すと `campaigns/01_kaigo/alive.csv` を読みに行く。スクレイパーの出力 `scraped.csv` → `check_alive_all.js` で `alive.csv` 化、というバトン渡し。

---

## ファイルパスまとめ

| ファイル | パス |
|---|---|
| スクレイパー本体 | `ツール/form_sender/scraper/scraper.js` |
| チェーンパターン定義 | `ツール/form_sender/scraper/chain_patterns.js` |
| データソースモジュール | `ツール/form_sender/scraper/sources/<source>.js` |
| 出力CSV | `ツール/form_sender/campaigns/<キャンペーンID>/scraped.csv` |
| 後段：生存確認 | `ツール/form_sender/check_alive_all.js`（既存） |
| 後段：送信本体 | `ツール/form_sender/send_forms.js`（既存） |

---

*以上が引き継ぎ内容。実装着手前に不明点があれば確認のこと。*
