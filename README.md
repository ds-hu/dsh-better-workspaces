# dsh-better-workspaces

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [Français](README.fr.md) · [한국어](README.ko.md)

Worktrees, diffs, pull requests, and issue references inside the DeepSeek Harness Web GUI. Keep one conversation focused on one change, from the first message to the commit, without switching tabs.

![Worktree mode in the composer](docs/screenshots/01-worktree-mode.png)

**1 · Choose where the work happens.** The composer has a `Local` / `New worktree` switch. Keep `Local` for a quick fix; pick `New worktree` when the task deserves its own branch and directory.

![Worktree form with branch name, base picker, and Create button](docs/screenshots/02-worktree-form.png)

**2 · Name it, choose a base, create.** Type a branch name or roll the dice. The base can be a local branch, an origin branch, or a pull request. Create opens the worktree as its own workspace with a ready session.

![Session row showing branch and diff size](docs/screenshots/03-sidebar-badges.png)

**3 · See each session's state at a glance.** Branch and change size sit under the session title. When the branch has a PR and checks, those join the same row.

![Diff page with scopes, file list, hunks, and actions](docs/screenshots/04-diff-view.png)

**4 · Review the whole change on one page.** The `±` pill opens a diff page in the right sidebar. Switch between uncommitted changes, this session, the task, and a base comparison. Expand a file for line-by-line hunks, edit it in place, or check the commit list.

![Commit button and More menu with pull, push, PR, merge, update, and discard](docs/screenshots/05-diff-actions.png)

**5 · Ship without leaving the page.** Commit, pull, push, create a PR, merge, update from the base, or discard changes. Unavailable actions explain what is missing.

![GitHub picker listing open pull requests and issues](docs/screenshots/06-github-picker.png)

**6 · Bring a PR or issue into the prompt.** The GitHub button beside the composer lists open pull requests and issues from the current repository. Pick one to attach a reference.

![Composer with a compact issue reference chip and send button](docs/screenshots/07-reference-chip.png)

**7 · Keep the draft compact.** The composer holds one small chip. On send, it expands into the full title, link, base/head, and body, so the model receives exact context.

## Install

```bash
dsh plugin --profile web add github:ds-hu/dsh-better-workspaces
```

Restart `dsh --profile web` once. Requires dsh ≥ 0.2.0, Node.js ≥ 20.19, `pnpm` on `PATH`, and git. The PR and issue features also use an authenticated `gh`; everything else works without it.

## Use it

1. Open a git workspace and start a session.
2. Choose `Local` or `New worktree` in the composer.
3. Use `±` to review, `Commit` / `More` to ship, and the GitHub button to attach a PR or issue.

## Notes

- Runs on Linux, macOS 13+, and Windows 10+.
- `gh` is optional. Without it, worktrees, badges, and the diff page still work.
- Every action stays in the current browser tab.

## Documentation

Architecture, design records, security, development, and operations are in [docs/TECHNICAL.md](docs/TECHNICAL.md). The decisions behind the plugin are in [docs/adr/](docs/adr/).

## License

MIT. Third-party notices ship in [NOTICE](NOTICE) and [LICENSES/](LICENSES/).
