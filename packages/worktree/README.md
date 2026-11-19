# @ds-hu/dsh-bw-worktree

The **新建 worktree** (New Worktree) module of
[`@ds-hu/dsh-better-workspaces`](../../README.md): one native dsh Loader row
(`bw-worktree`) with two independently switchable browser surfaces.

## What it provides

- ① The staging strip above the composer: worktree mode menu, branch-name
  input with the mnemonic dice, base-branch selector (origin-first, PR rows),
  and the Create button with the best-effort draft hand-off.
- ② A matching right-sidebar **新建 worktree** page beside 代码变更, with the
  same backend and a full-panel layout that follows the sidebar's habits.
- Background maintenance for managed worktrees (crash recovery at boot, the
  hourly abandoned sweep).

Both surfaces share settings on the row's own Plugins-page configuration card
(`输入框上方的「新建 worktree」` / `右侧栏的「新建 worktree」页面`); switching one
off re-registers only the other, live.

## Config

`worktreesDir` (optional) moves the managed-worktree namespace; see the bundle
README. Write it on this row (or any other feature row) — two rows disagreeing
is a mount error.

## Switching it off

Disable the `bw-worktree` row. Diff/status/forge keep working; only this row's
routes (`/branches`, `/worktrees`, …) disappear and no new worktrees can be
created or swept.
