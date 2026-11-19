# @ds-hu/dsh-bw-forge

The **Issue 与 PR** (Issues & PRs) module of
[`@ds-hu/dsh-better-workspaces`](../../README.md): one native dsh Loader row
(`bw-forge`) with two independently switchable browser surfaces.

## What it provides

- ① The GitHub mark in the composer's attach-control row: opens the issue/PR
  picker and inserts a reference chip into the draft (the chip is serialized to
  title, link, body and, for PRs, base/head when the message is sent).
- ② A matching right-sidebar **Issue 与 PR** page beside 代码变更: the same
  forge items, with a local filter, a refresh control, and click-to-attach
  into the current draft.

Both surfaces are switched on the row's own Plugins-page configuration card
(`输入框里的 GitHub 图标` / `右侧栏的「Issue 与 PR」页面`); toggling one
re-registers the other live.

## Backend

The module mounts no host routes: it reads the shared data plane's
`GET /pulls` / `GET /pull` through the user's authenticated `gh` CLI. It
therefore works when it is the only feature module enabled, and its absence
never breaks a PR badge on the diff page (that half lives in the snapshot
data plane).

## Switching it off

Disable the `bw-forge` row; the composer control, the picker and the sidebar
page disappear while every other module stays mounted.
