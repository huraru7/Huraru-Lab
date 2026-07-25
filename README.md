# huraru-lab

Web技術の実験を1つずつ置いていく実験ラボサイト。
[huraru.com](https://huraru.com)(プロフィール/ガーデン)、[portfolio.huraru.com](https://portfolio.huraru.com)(ポートフォリオ)
に続く自分を表すためのサイトです。

公開URL: `lab.huraru.com`

## コンセプト

自分の技術の実験を1つずつ独立したデモとして公開し、一覧ページから閲覧できるようにする。
自分の技術を試していく、それを公開することで成長の可視化と自分の開示が目的。

## 技術スタック

サイト全体はビルドレス(素のHTML/CSS/JS、フレームワーク・ビルドツールなし)。
ソースがそのまま読める状態に価値がある実験場のため、あえてビルド工程を持たない。
Three.js等の外部ライブラリを使う実験でも、importmap経由でCDNから読み込む形を取り、ビルド設定は導入していない。

## ディレクトリ構成

```
huraru-lab/
├── index.html              # 一覧ページ
├── notes.html              # 詳細メモのビューア(?slug=で対象切り替え)
├── labWorks.json           # MetaData(一覧ページ用)
├── style.css               # 一覧ページ用スタイル
├── assets/
│   ├── header-visual.js    # ヘッダーの装飾用ミニビジュアル
│   ├── notes.css           # notes.html用CSS
│   └── notes-viewer.js     # 簡易Markdownパーサー
└── works/
    └── three-particles/    # 実験の例
        ├── index.html
        ├── script.js
        ├── notes.md        # 詳細メモ(Markdown記述)
        └── models/
```

## 一覧ページの機能

- `labWorks.json` を fetch して各実験のカードを描画(フレームワーク不使用)
- 各カードは `works/{slug}/index.html` を iframe でその場にプレビュー表示し、
  カード自体をクリック(またはEnter/Space)すると新規タブでその実験を開く
- 技術タグ別の内訳を円グラフで表示
- `createdDate` を集計したGitHub風の更新カレンダー(ヒートマップ)を表示

## 詳細メモ(notes.md)

`note` はカード上に2行までしか表示できないため`works/{slug}/notes.md` に**Markdownで**詳細を書く。
HTMLファイルを作る必要はなく、ルート直下の共通ビューアが見出し・リード文をから本文を取得して表示する。
`works/{slug}/notes.md` を置くだけで一覧カードに「詳細 →」リンクが自動的に表示される
(一覧ページが`fetch`で存在確認するため、`labWorks.json`側でのフラグ管理は不要)。

`notes.md` で使える記法(独自の軽量パーサーが対応している範囲):

- `## 見出し` / `### 小見出し`(自動で連番が付く)
- 通常の段落
- `- 箇条書き`
- ` ```〜``` ` のコードブロック
- `` `インラインコード` ``、`**太字**`、`[リンク](url)`
- `> ...` の引用

## 新しい実験を追加する手順

1. `works/{新しいslug}/` に自己完結したHTML/JS/CSSを配置する
2. `labWorks.json` に1エントリ追加する

```json
{
	"slug": "flow-field",
	"title": "フローフィールド生成",
	"technology": ["Canvas"],
	"createdDate": "2026-07-24",
	"note": "少ないパラメータで複雑な流れを作る実験"
}
```

- `slug`: ID
- `title`: 名前
- `technology`: タグ配列
- `createdDate`: 作成日(`YYYY-MM-DD`)
- `note`: 一言メモ・気づき(カード上では2行まで表示、全文はhoverで確認可能)

上記2手順でカードとプレビューを自動的に追加する。
`works/{slug}/notes.md` を追加で置けば、「詳細 →」リンクも自動的に出現する。
