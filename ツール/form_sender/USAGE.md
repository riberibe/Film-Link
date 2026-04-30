# フォーム一斉送信ツール — 使い方

## 概要

SHODAN Pro でダウンロードした介護施設・結婚式場などのCSVリストを使い、お問い合わせフォームへ一斉送信するツール。

---

## ディレクトリ構成

```
form_sender/
├── send_forms.js          # 送信本体
├── check_alive_all.js     # URL生存確認ツール
├── config.json            # 送信者情報・設定
└── campaigns/
    ├── 01_kaigo/
    │   ├── message.txt    # 介護施設向け文面（件名＋本文）
    │   ├── alive.csv      # 生存確認済みURL（ローカルのみ）
    │   └── results.csv    # 送信結果（ローカルのみ）
    └── 02_wedding/
        └── message.txt    # 結婚式場向け文面（件名＋本文）
```

---

## 基本フロー（Jarvisスキル推奨）

**Jarvisに `/営業お問い合わせ送信` と入力すると、以下のSTEPをガイド付きで実行できる。**

| STEP | 内容 |
|------|------|
| 1 | SHODAN Pro CSVをcampaignsフォルダへ配置 |
| 2 | URL生存確認 → alive.csv を自動生成 |
| 3 | 3件サンプル送信で文面・動作確認 |
| 4 | 全件送信（Jarvis実行 or ターミナル手動） |

---

## 手動実行コマンド

### STEP 2 — URL生存確認

```bash
cd /Users/ribetyan/Desktop/ファミリームービー/ツール/form_sender
node check_alive_all.js campaigns/01_kaigo/<SHODANのCSVファイル名>.csv
```

完了すると `campaigns/01_kaigo/alive.csv`（送信可能）と `ng.csv`（除外）が生成される。

### STEP 3 — サンプル3件送信

```bash
node send_forms.js --campaign campaigns/01_kaigo --sample 3
```

### STEP 4 — 全件送信

```bash
node send_forms.js --campaign campaigns/01_kaigo
```

---

## 文面の変更方法

`campaigns/<ジャンル>/message.txt` を直接編集する。

```
件名: ここに件名を書く

ここから本文。
1行空けてから書き始める。
```

---

## 設定変更（config.json）

| 項目 | 内容 |
|------|------|
| `sender.name` | 送信者名（現在：田中） |
| `sender.email` | 返信先メールアドレス |
| `settings.daily_limit` | 1日の送信上限（現在：50件） |
| `settings.delay_between_sites_ms` | サイト間の待機時間（現在：5秒） |

---

## 新しいジャンルを追加する場合

```bash
mkdir -p campaigns/<番号_ジャンル名>
```

`message.txt` を作成して件名と本文を記載する。

---

## 注意事項

- **送信は取り消し不可**。必ずサンプル3件で動作確認してから全件送信する
- 一度送信済みのURLは `results.csv` に記録され、再実行時に自動スキップされる
- `alive.csv` / `results.csv` / `ng.csv` はGit管理対象外（ローカルのみ）
