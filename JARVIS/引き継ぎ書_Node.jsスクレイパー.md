# 引き継ぎ書 — Node.js 施設情報スクレイパー

> 作成: 2026-04-28 by Jarvis  
> 目的: このドキュメントを新しいチャットに貼り付けて、スクレイパーの実装を依頼するための引き継ぎ書

---

## 背景・目的

有料老人ホームなどへの営業フォーム自動送信ツールがすでにある。  
そのツールへの入力となる施設リスト（`facilities.csv`）を、施設情報まとめサイトからスクレイピングして自動生成したい。

現状は手作業でスプレッドシートに施設情報を登録しているが、数千〜数万件規模に拡張するためにスクレイパーが必要。

---

## 既存の技術スタック

- **Node.js** + **Playwright**（すでにインストール済み）
  - パス: `/Users/ribetyan/Desktop/ファミリームービー/ツール/form_sender/`
  - `npm install` と `npx playwright install chromium` は完了済み
- **JavaScript**（Node.js）で書くこと（Pythonは不要・使わない）

---

## 作ってほしいもの

スクリプト名: `scraper.js`  
場所: `/Users/ribetyan/Desktop/ファミリームービー/ツール/form_sender/scraper.js`

### 動作の流れ

```
① スクレイピング対象サイトから施設名・都道府県・HP_URLを取得
      ↓
② 施設名のパターン（チェーン名）に基づいてフォームURLを自動割当
      ↓
③ facilities.csv に追記（既存ステータスは上書きしない・重複はスキップ）
```

---

## 出力フォーマット（facilities.csv）

```csv
No.,施設名,都道府県,市区町村,月額費用,HP_URL,フォームURL,ステータス
```

- `No.` は既存の最大値+1から連番で採番
- `ステータス` は `未処理` で固定
- `月額費用` `市区町村` は取得できれば入れる、なければ空欄でOK

---

## フォームURL自動割当ルール（チェーンパターン）

施設名またはHP_URLに以下のパターンが含まれる場合、対応するフォームURLを割当。
どのパターンにも一致しない場合は `HP_URL` をそのまま `フォームURL` に入れる（後でsend_forms.jsのfindContactUrl()が自動探索する）。

| チェーン名パターン | フォームURL |
|---|---|
| `benesse` / `ベネッセ` / `アリア` / `くらら` / `グランダ` | `手動対応`（ステータスに直接セット・送信しない） |
| `gtl` / `グッドタイムリビング` / `グッドタイム` | `https://www.gtl-daiwa.co.jp/dc/request/index.php` |
| `nichiigakkan` / `ニチイホーム` / `ニチイ学館` | `https://pages.nichiigakkan.co.jp/palace_inquiryform_new.html` |
| `チャームケアコーポレーション` / `チャームプレミア` / `チャーム` | `https://www.charm-cc.jp/inquiry/` |
| `木下の介護` / `kinoshita` | `https://www.kinoshita-kaigo.co.jp/contact/` |
| `ツクイ` / `tsukui` | `https://www.tsukui.net/contact/` |

> 上記は既知パターン。新しいチェーンが出てきたら随時追加できるよう、パターンを配列で管理する設計にしてほしい。

---

## スクレイピング対象サイト（優先順）

### 1. LIFULL介護
- URL: `https://kaigo.homes.co.jp/facility/`
- 構造: 都道府県 → 市区町村 → 施設一覧（ページネーションあり）
- 取得したい情報: 施設名、都道府県、市区町村、HP_URL（各施設の詳細ページURL）

### 2. みんなの介護
- URL: `https://www.minnanokaigo.com/guide/`
- 構造: 都道府県別一覧
- 取得したい情報: 施設名、都道府県、HP_URL

> どちらかのサイトが取得しやすければそちらを優先。両方に対応できれば理想。

---

## 実行方法のイメージ

```bash
# 東京都の施設を100件スクレイピングして facilities.csv に追記
node scraper.js --pref 東京都 --limit 100

# 全国を対象に500件
node scraper.js --limit 500
```

---

## 注意事項

- `facilities.csv` に**すでに存在する施設名はスキップ**（重複防止）
- ベネッセ系はステータスを `手動対応` にして `フォームURL` には空欄またはそのパターンURLをセット
- スクレイピング時は各リクエスト間に **1〜2秒のウェイト**を入れてサーバーに負荷をかけない
- Playwright の `chromium` を使う（すでにインストール済み）

---

## 既存コードの参考（send_forms.js の findContactUrl）

フォームURLが不明な施設に対して、HP_URLのトップページからコンタクトページを自動探索する関数がすでにある。
スクレイパー側でフォームURLが不明な場合は `HP_URL` をそのままセットしておけばOK。

---

## ファイルパス

| ファイル | パス |
|---|---|
| 出力先CSV | `/Users/ribetyan/Desktop/ファミリームービー/ツール/form_sender/facilities.csv` |
| スクレイパー置き場 | `/Users/ribetyan/Desktop/ファミリームービー/ツール/form_sender/scraper.js` |
| 既存の送信ツール | `/Users/ribetyan/Desktop/ファミリームービー/ツール/form_sender/send_forms.js` |

---

*以上が引き継ぎ内容です。不明点があれば聞いてください。*
