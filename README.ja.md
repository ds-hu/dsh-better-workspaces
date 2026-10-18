# dsh-better-workspaces

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [Français](README.fr.md) · [한국어](README.ko.md)

DeepSeek Harness Web GUI のチャットから、worktree・差分・Pull Request・Issue をそのまま扱えます。1つの会話を1つの変更に集中させ、最初のメッセージからコミットまで同じ画面で完結します。

![入力欄の上にある Local と New worktree の切り替え](docs/screenshots/01-worktree-mode.png)

**1 · 作業場所を選ぶ。** 入力欄の上に `Local` と `New worktree` があります。小さな修正は現在のディレクトリで、独立したブランチとディレクトリが必要なときは `New worktree` を選びます。

![ブランチ名、ベース選択、作成ボタンを備えた worktree フォーム](docs/screenshots/02-worktree-form.png)

**2 · 名前とベースを決めて作成。** ブランチ名を入力するか、サイコロで生成します。ベースはローカルブランチ、リモートブランチ、Pull Request から選べます。Create を押すと、worktree が独立したワークスペースとして開き、セッションも用意されます。

![ブランチと変更量を表示するセッション行](docs/screenshots/03-sidebar-badges.png)

**3 · セッションの状態が一目で分かる。** ブランチと変更量はセッションタイトルの下に表示されます。ブランチに PR やチェックがあれば、同じ行に並びます。

![範囲切り替え、ファイル一覧、行単位の差分、操作ボタンを備えた差分ページ](docs/screenshots/04-diff-view.png)

**4 · 変更全体を1ページで確認。** `±` を押すと右側に差分ページが開きます。未コミット、このセッション、タスク、ベース比較を切り替えられます。ファイルを展開して行単位の差分を見たり、その場で編集したり、コミット一覧を確認できます。

![Commit ボタンと、Pull、Push、PR、マージ、更新、破棄を含む More メニュー](docs/screenshots/05-diff-actions.png)

**5 · 画面を離れずに仕上げる。** Commit、Pull、Push、PR 作成、マージ、ベースから更新、変更の破棄ができます。使えない操作には不足している条件が表示されます。

![オープンな Pull Request と Issue を一覧する GitHub ピッカー](docs/screenshots/06-github-picker.png)

**6 · PR や Issue を入力欄へ。** 入力欄の横にある GitHub ボタンで、現在のリポジトリのオープンな PR と Issue を一覧できます。選ぶと参照として追加されます。

![入力欄に収まった小さな Issue 参照チップと送信ボタン](docs/screenshots/07-reference-chip.png)

**7 · 下書きはコンパクトなまま。** 入力欄に小さなチップが1つ付くだけです。送信時に完全なタイトル、リンク、ベース/ヘッド、本文へ展開され、モデルに正確な文脈が渡ります。

## インストール

```bash
dsh plugin --profile web add github:ds-hu/dsh-better-workspaces
```

`dsh --profile web` を一度再起動します。dsh ≥ 0.2.0、Node.js ≥ 20.19、`pnpm`（`PATH` 上）、git が必要です。PR と Issue の機能には認証済みの `gh` も使います。それ以外の機能は `gh` なしで動きます。

## 使い方

1. git ワークスペースを開き、セッションを開始します。
2. 入力欄の上で `Local` か `New worktree` を選びます。
3. `±` で確認し、`Commit` / `More` で仕上げ、GitHub ボタンで PR や Issue を追加します。

## 補足

- Linux、macOS 13+、Windows 10+ で動作します。
- `gh` は任意です。なくても worktree、バッジ、差分ページは使えます。
- すべての操作は現在のブラウザタブ内で完結します。

## ドキュメント

アーキテクチャ、設計記録、セキュリティ、開発、運用は [docs/TECHNICAL.md](docs/TECHNICAL.md) にあります。設計判断は [docs/adr/](docs/adr/) を参照してください。

## ライセンス

MIT。サードパーティの通知は [NOTICE](NOTICE) と [LICENSES/](LICENSES/) に含まれます。
