# FilmLink リストビルダー — 完全マニュアル

> 対象: リベ様 / 運用スタッフ（エンジニアじゃなくても使えます）  
> 最終更新: 2026-04-27

---

## このツールが何をするか（1分で理解）

営業先企業のリストを**自動で収集するツール**です。

```
手作業だと...
  「結婚式場 東京」で検索 → 1件ずつサイトを開く → 社名・住所・HPを手でメモ
  → 「お問い合わせページ」を探してURLをコピー
  → これを100件繰り返す（数時間かかる）

このツールだと...
  コマンド1行打つだけ → 100件のリストをCSVに自動出力
  → そのまま form_sender（自動送信ツール）に読み込ませて送信できる
```

---

## 目次

1. [ファイル構成（何がどこにあるか）](#1-ファイル構成)
2. [ツール全体の流れ（仕組みの図解）](#2-ツール全体の流れ)
3. [初回セットアップ（最初の1回だけ）](#3-初回セットアップ)
4. [基本的な使い方](#4-基本的な使い方)
5. [収集方法の違い（source オプション）](#5-収集方法の違い)
6. [新しい業種を追加するとき](#6-新しい業種を追加するとき)
7. [出力されるCSVの見方](#7-出力されるCSVの見方)
8. [リストを営業送信に使うまでの流れ](#8-リストを営業送信に使うまでの流れ)
9. [よくあるトラブルQ&A](#9-よくあるトラブルqa)
10. [コマンド早見表](#10-コマンド早見表)

---

## 1. ファイル構成

```
ファミリームービー/ツール/list_builder/
│
├── index.js                 ← ツール本体（触らなくてOK）
├── sources/
│   ├── google_maps.js       ← Google Mapsから企業を収集する部品
│   └── directory_scraper.js ← まとめサイトから企業を収集する部品
├── enrich.js                ← お問い合わせフォームのURLを自動で補完する部品
├── output.js                ← 結果をCSVに書き出す部品
├── config/
│   └── industries.json      ← 業種ごとの設定（追加・変更はここ）
├── package.json             ← ツールの設定ファイル（触らなくてOK）
├── .env                     ← APIキーの保存場所（自分で作成）
└── .env.example             ← .env の見本ファイル
```

**基本的に操作するのは `config/industries.json` と `.env` の2つだけです。**

---

## 2. ツール全体の流れ

コマンドを1行打つと、以下の4ステップが自動で実行されます。

```
【ステップ1】企業リストを収集する
    ↓
    ① Google Maps API で「結婚式場 東京」などを検索
    　 → 企業名・住所・公式サイトURLを取得
    
    ② まとめサイト（みんなのウエディングなど）をスクレイピング
    　 → 企業名・公式サイトURLを取得
    
    ③ ①と②の結果をマージして重複を除去

【ステップ2】お問い合わせフォームのURLを自動補完する
    ↓
    各企業の公式サイトを自動で開いて
    「お問い合わせ」「contact」などのリンクを探してURLを記録

【ステップ3】CSVに出力する
    ↓
    form_sender/facilities_結婚式場_20260427.csv として保存

【ステップ4】完了サマリーを表示
    ↓
    何件収集できたか / フォームURL発見率 を報告
```

---

## 3. 初回セットアップ

> この作業は最初の1回だけです。

### ステップ1: ツールフォルダに移動する

**Mac:**
```
cd /Users/ribetyan/Desktop/ファミリームービー/ツール/list_builder
```

**Windows:**
```
cd C:\FilmLink\list_builder
```

### ステップ2: 必要なパーツをインストールする

```
npm install
```
（完了まで1〜3分かかります）

```
npx playwright install chromium
```
（完了まで3〜5分かかります）

### ステップ3: 動作確認

以下を実行して「エラー: --industry を指定してください」と出ればセットアップ完了です。

```
node index.js
```

---

## 4. 基本的な使い方

### コマンドの書き方

```
node index.js --industry [業種] --area [地域] --limit [件数] --source [方法]
```

| オプション | 意味 | 例 |
|---|---|---|
| `--industry` | 収集したい業種 | `結婚式場` / `写真スタジオ` / `有料老人ホーム` |
| `--area` | 対象の地域 | `東京` / `大阪` / `神奈川` |
| `--limit` | 最大何件収集するか | `100` / `50` / `200` |
| `--source` | 収集方法 | `all` / `directory` / `maps` |

### 実行例

```bash
# 東京の結婚式場を100件（全方法）
node index.js --industry 結婚式場 --area 東京 --limit 100 --source all

# 大阪の写真スタジオを50件（まとめサイトのみ・無料）
node index.js --industry 写真スタジオ --area 大阪 --limit 50 --source directory

# 東京の有料老人ホームを200件（Google Mapsのみ・APIキー必要）
node index.js --industry 有料老人ホーム --area 東京 --limit 200 --source maps
```

### 実行中の画面の見方

```
========================================
 FilmLink リストビルダー
========================================
業種    : 結婚式場
エリア  : 東京
上限件数: 100件
ソース  : all
========================================

--- [1/4] Google Maps から取得中 ---
[google_maps] 検索クエリ: "結婚式場 ウエディング 東京" (最大100件)
[google_maps] 取得済み: 60件
Google Maps: 60件取得

--- [2/4] ディレクトリサイトから取得中 ---
[directory] みんなのウエディング: https://www.minna-wedding.co.jp/...
[directory] みんなのウエディング: 取得済み 45件

--- [3/4] 重複除去 ---
重複除去: 105件 → 87件 (18件除去)

--- [4/4] フォームURL補完 ---
[enrich] フォームURL補完を開始します (対象: 87件)
[enrich] [1/87] アニヴェルセル 東京ベイ → 発見: https://...
[enrich] [2/87] ザ・ストリングス → 発見: https://...
[enrich] [3/87] ○○式場 → 未発見

========================================
 完了サマリー
========================================
取得件数 (合計)     : 87件
  - Google Maps     : 60件
  - ディレクトリ    : 27件
フォームURL発見     : 71件
フォームURL未発見   : 16件
出力ファイル        : ../form_sender/facilities_結婚式場_20260427.csv
========================================

次のステップ: 出力されたCSVを form_sender/facilities.csv にリネームして
  cd ../form_sender && node send_forms.js --dry  でドライランを確認してください。
```

---

## 5. 収集方法の違い

`--source` オプションで収集方法を選べます。

### `--source directory`（まとめサイトスクレイピング・**無料・おすすめ**）

**仕組み:**
「みんなのウエディング」「みんなの介護」などの専門まとめサイトを自動で開いて、
掲載されている施設名・サイトURLを1ページずつ収集します。

```
みんなのウエディング → 結婚式場が大量に掲載されているサイト
みんなの介護        → 有料老人ホームが大量に掲載されているサイト
```

**メリット:** 無料・リスト品質が高い（すでにそのジャンルの施設が厳選されている）  
**デメリット:** 対応していない業種は使えない（industries.json で追加可能）

---

### `--source maps`（Google Maps API・**要APIキー**）

**仕組み:**
「結婚式場 東京」のようなキーワードで Google Maps を検索して、
表示された施設の名前・住所・公式サイトURLを自動取得します。

**メリット:** どの業種・地域でも使える・住所情報が正確  
**デメリット:** Google Maps APIキーが必要（月1000件まで無料、それ以上は課金）

**APIキーの設定方法:**

1. `ツール/list_builder/.env` というファイルを新規作成する
2. 以下を1行書いて保存する:
   ```
   GOOGLE_MAPS_API_KEY=取得したAPIキーをここに貼る
   ```

> Google Maps APIキーの取得方法は別途Jarvisに依頼してください。

---

### `--source all`（両方実行・**最もリストが充実する**）

directoryとmapsの両方を実行して、結果をマージ・重複除去します。  
APIキーが未設定でも、directory部分だけ動きます。

---

## 6. 新しい業種を追加するとき

`config/industries.json` を編集します。

### 現在対応している業種

```json
{
  "結婚式場": { ... },
  "写真スタジオ": { ... },
  "有料老人ホーム": { ... }
}
```

### 新しい業種を追加する手順

例として「葬儀社」を追加する場合:

1. `config/industries.json` をテキストエディタで開く
2. 最後の `}` の前に以下を追加する:

```json
  "葬儀社": {
    "google_maps_query": "葬儀社 葬儀場",
    "directory_sites": []
  }
```

3. 保存する
4. 使える:

```bash
node index.js --industry 葬儀社 --area 東京 --limit 50 --source maps
```

### まとめサイトも追加する場合

そのジャンルの専門まとめサイトのURLを調べて、`directory_sites` に追加します。
（具体的な設定方法はJarvisに依頼してください）

---

## 7. 出力されるCSVの見方

出力先: `ツール/form_sender/facilities_[業種]_[日付].csv`

例: `facilities_結婚式場_20260427.csv`

| 列名 | 内容 | 例 |
|---|---|---|
| No. | 通し番号 | 1, 2, 3… |
| 施設名 | 企業・施設の名前 | アニヴェルセル東京ベイ |
| 都道府県 | 都道府県 | 東京都 |
| 市区町村 | 市区町村 | 港区 |
| 月額費用 | 空白（結婚式場などは不要） | （空白） |
| HP_URL | 公式サイトURL | https://... |
| フォームURL | お問い合わせフォームのURL | https://.../contact |
| ステータス | 送信状況 | 未処理 |

**フォームURLが空白の行について:**
フォームURLが自動で見つからなかった企業です。  
手動でサイトを開いて確認するか、スキップして送信時に自動スキップされます。

---

## 8. リストを営業送信に使うまでの流れ

list_builder で収集したリストをそのまま form_sender に渡せます。

### ステップ1: リストを収集する

```bash
cd /Users/ribetyan/Desktop/ファミリームービー/ツール/list_builder
node index.js --industry 結婚式場 --area 東京 --limit 100 --source directory
```

→ `../form_sender/facilities_結婚式場_20260427.csv` が生成される

### ステップ2: form_sender に読み込ませる

```bash
cd /Users/ribetyan/Desktop/ファミリームービー/ツール/form_sender
```

既存の `facilities.csv` を退避してから新しいリストに切り替える:

**Mac:**
```bash
mv facilities.csv facilities_老人ホーム_backup.csv
cp facilities_結婚式場_20260427.csv facilities.csv
```

**Windows (PowerShell):**
```
Rename-Item facilities.csv facilities_老人ホーム_backup.csv
Copy-Item facilities_結婚式場_20260427.csv facilities.csv
```

### ステップ3: config.json の文面を業種に合わせて変更する

文面の変更方法は [フォーム自動送信マニュアル](業務マニュアル_FilmLink営業自動化.md) の「5. 文面を変えたいとき」を参照してください。  
**文面変更は必ずリベ様の確認が必要です。**

### ステップ4: ドライランで確認する

```bash
node send_forms.js --dry
```

### ステップ5: 本番送信（GOサイン後）

```bash
node send_forms.js
```

---

## 9. よくあるトラブルQ&A

**Q: 「エラー: 業種 "○○" は設定されていません」と出る**

`config/industries.json` に対象の業種が登録されていません。  
「6. 新しい業種を追加するとき」を参照して追加してください。

---

**Q: Google Maps の件数が0件で終わる**

`.env` ファイルの `GOOGLE_MAPS_API_KEY` が設定されていない可能性があります。  
`--source directory` に切り替えれば APIキーなしで動きます:

```bash
node index.js --industry 結婚式場 --area 東京 --limit 100 --source directory
```

---

**Q: フォームURLが半分くらい「未発見」になる**

正常です。すべての企業がわかりやすいURL構造をしているわけではないため、  
自動発見できない場合があります。フォームURL未発見の企業は送信時に自動スキップされます。  
発見率60〜80%が目安です。

---

**Q: 途中でエラーが出て止まってしまった**

再度同じコマンドを実行してください。  
フォームURL補完（ステップ4）の部分はキャッシュが保存されているので、  
続きから自動で再開します。

---

**Q: 出力されたCSVをExcelで開いたら文字化けした**

CSVファイルをExcelで開くときは、以下の手順で開いてください:

1. Excelを開く
2. 「データ」タブ → 「テキストまたはCSVから」
3. ファイルを選択
4. 文字コード「UTF-8」を選んでインポート

---

## 10. コマンド早見表

```bash
# ツールフォルダに移動（Mac）
cd /Users/ribetyan/Desktop/ファミリームービー/ツール/list_builder

# 結婚式場・東京・100件・全ソース
node index.js --industry 結婚式場 --area 東京 --limit 100 --source all

# 写真スタジオ・大阪・50件・まとめサイトのみ（無料）
node index.js --industry 写真スタジオ --area 大阪 --limit 50 --source directory

# 有料老人ホーム・神奈川・200件・Google Mapsのみ（APIキー必要）
node index.js --industry 有料老人ホーム --area 神奈川 --limit 200 --source maps

# 途中で止めたいとき
Ctrl + C
```

---

## 付録: form_sender との関係図

```
【リスト収集】                    【営業送信】
list_builder/                    form_sender/
  index.js                         send_forms.js
     ↓                                  ↑
  sources/                        facilities.csv  ← ここに渡す
  google_maps.js       →→→→→→→→→↗
  directory_scraper.js
     ↓
  enrich.js（フォームURL補完）
     ↓
  output.js
     ↓
  facilities_[業種]_[日付].csv
```

list_builder が「どこに送るか（リスト）」を作り、  
form_sender が「実際に送る」という役割分担です。

---

*最終更新: 2026-04-27 by Jarvis*
