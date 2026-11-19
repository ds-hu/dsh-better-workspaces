# @ds-hu/dsh-bw-diff

The **代码变更** (Code Changes) module of
[`@ds-hu/dsh-better-workspaces`](../../README.md): one native dsh Loader row
(`bw-diff`) that owns the official right-sidebar diff page.

## What it provides

- A right-sidebar page type beside the official 工作区文件 panel, with a guide
  card on the sidebar start page.
- Uncommitted / committed / task diff modes, the commit list, the action ladder
  (commit → pull → push → merge PR → auto-merge → create PR → merge-to-base →
  update-from-base → archive), and the pending workspace-deletion saga.
- The CAS-protected file editor inside the diff view.

## Switching it off

Disable the `bw-diff` row in the dsh Plugins page. Every other feature module
stays mounted; the diff route group (`/diff`, `/file`, `/actions`, plus the
archive-deletion routes) answers `404 feature module disabled`.

## Backend

All git behaviour lives in the shared library
`@ds-hu/dsh-bw-core` (installed automatically). This package only claims its
routes and the page. The always-on read data plane (`/snapshots`, `/events`,
`/detect`) is mounted by whichever feature module is active, so this module
works when it is the only one enabled.
