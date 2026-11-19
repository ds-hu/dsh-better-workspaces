# @ds-hu/dsh-bw-status

The **workspace Git status** module of
[`@ds-hu/dsh-better-workspaces`](../../README.md): one native dsh Loader row
(`bw-status`) with two browser surfaces that belong together.

## What it provides

- The badge line under each Workspace title in the left sidebar: branch name,
  `#PR`, checks ring, `+N/−N`, `↑a↓b`, plus the managed-worktree icon.
- The composer **diff pill**: the DiffStat capsule that opens the right-sidebar
  diff page.

It only reads the shared data plane (`/snapshots`, `/events`, `/detect`) and its
own `/worktree-workspaces` route for the managed-worktree icon; it never writes.

## Switching it off

Disable the `bw-status` row. The diff page, worktree creation and forge
surfaces keep their own entry points; only the badge line, the icon and the
pill disappear.
