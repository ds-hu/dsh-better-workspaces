# dsh-better-workspaces

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [Français](README.fr.md) · [한국어](README.ko.md)

DeepSeek Harness Web GUI に Git worktree、差分ビューア、Pull Request および Issue 連携を統合します。1 つのタスクに 1 つの独立したブランチと作業ディレクトリを割り当て、最初のプロンプト入力からコミット・プッシュまで、ブラウザの 1 画面で完結します。

---

## 主な機能

### 1. プロンプト入力欄から作業モードを選択

入力欄の真上にある `Local` と `New worktree` で作業場所を切り替えます。ちょっとした修正は `Local`（現在のディレクトリ）のまま進め、並行作業や独立した機能開発は `New worktree` を選択。専用のブランチと隔離ディレクトリが用意され、作業同士の競合を防ぎます。

![入力欄の上にある Local と New worktree の切り替え](docs/screenshots/01-worktree-mode.png)

### 2. ブランチや PR からワンクリックで作業領域を作成

ブランチ名を入力するか、サイコロをクリックして自動生成します。ベースにはローカルブランチ、リモートブランチ、既存の Pull Request を指定可能。**Create** を押すと、独立した worktree ワークスペースと新しいセッションが即座に立ち上がります。

![ブランチ名、ベース選択、作成ボタンを備えた worktree フォーム](docs/screenshots/02-worktree-form.png)

### 3. セッション一覧で Git の状態を一目で把握

サイドバーのセッションカードに、対象ブランチと変更行数（`+11 −3`）が常時表示されます。紐づく PR や CI チェックの状態も同じ行にまとまるため、ターミナルで `git status` を確認する手間が省けます。

![ブランチと変更量を表示するセッション行](docs/screenshots/03-sidebar-badges.png)

### 4. サイドバーで完結するフル機能の差分レビュー

`±` バッジをクリックすると右側に差分ビューが開きます。未コミットの変更、現在のセッション、タスク全体、ベースブランチとの比較をスムーズに切り替え可能。行単位のハンク確認、その場でのインライン編集、コミット履歴の確認に対応しています。

![範囲切り替え、ファイル一覧、行単位の差分、操作ボタンを備えた差分ページ](docs/screenshots/04-diff-view.png)

### 5. 画面を離れずにコミットから PR 作成まで実行

差分パネルから Commit、Pull、Push、PR 作成、マージ、ベースからの更新、変更の破棄を直接実行できます。実行に必要な条件を満たしていない操作は、理由が明快に示されます。

![Commit ボタンと、Pull、Push、PR、マージ、更新、破棄を含む More メニュー](docs/screenshots/05-diff-actions.png)

### 6. GitHub の PR・Issue をすばやくプロンプトへ追加

入力欄の横にある GitHub ボタンから、リポジトリ内のオープンな PR や Issue を一覧表示して選択。ワンクリックで構造化された参照としてプロンプトに添付できます。

![オープンな Pull Request と Issue を一覧する GitHub ピッカー](docs/screenshots/06-github-picker.png)

### 7. すっきりした入力チップと正確なコンテキスト展開

入力欄ではコンパクトなチップとして表示されるため、プロンプトの編集を妨げません。送信時にタイトル、本文、ブランチ情報、URL を含む完全なコンテキストへ自動展開され、モデルに正確な情報が届きます。

![入力欄に収まった小さな Issue 参照チップと送信ボタン](docs/screenshots/07-reference-chip.png)

---

## クイックワークフロー

1. **セッション開始:** DeepSeek Harness で Git ワークスペースを開き、セッションを開始します。
2. **モード選択:** 入力欄の上で `Local`（その場編集）または `New worktree`（隔離ブランチ）を選択します。
3. **開発とレビュー:** GitHub ピッカーで Issue を参照し、サイドバーで変更量を確認しながら、`±` で行単位の差分をレビューします。
4. **反映・提出:** 差分パネルから直接コミット、プッシュ、または Pull Request を作成します。

---

## インストール

npm から 1 行のコマンドでインストールできます。

```bash
dsh plugin --profile web add @ds-hu/dsh-better-workspaces
```

インストール後、`dsh --profile web` を一度再起動してください。

DSH の Web UI からインストールすることもできます。

1. サイドバーの **Plugins** を開きます。
2. **Add plugin** をクリックします。
3. `@ds-hu/dsh-better-workspaces` を入力し、インストール元として **Official npm registry** を選択します。
4. **Install** をクリックし、完了後に **Enable now** をクリックします。再起動を求められた場合は、`dsh --profile web` を一度再起動してください。

### 動作環境
- **DeepSeek Harness:** ≥ 0.2.0
- **Node.js:** ≥ 20.19
- **必須ツール:** `git`、`pnpm`（`PATH` に通っていること）
- **GitHub CLI（任意）:** ログイン済みの `gh` がある場合、PR および Issue の選択・参照機能が有効になります。未インストールの状態でも、worktree、バッジ表示、差分レビューなどの基本機能はすべて利用可能です。

---

## 補足事項

- Linux、macOS 13+、Windows 10+ をサポートしています。
- すべての操作はブラウザの同一タブ内で完結します。

---

## ドキュメント

- [docs/TECHNICAL.md](docs/TECHNICAL.md) — アーキテクチャ、セキュリティ設計、アップグレード時の注意点、運用保守手順。
- [docs/adr/](docs/adr/) — 設計判断を記録した ADR（Architecture Decision Records）。

---

## ライセンス

[MIT](LICENSE)。サードパーティ製コンポーネントのライセンス通知は [NOTICE](NOTICE) および [LICENSES/](LICENSES/) に記載されています。
