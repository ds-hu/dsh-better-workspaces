# dsh-better-workspaces

Worktrees, diffs, pull requests and issue references for the DeepSeek Harness
Web GUI — delivered as **four independently switchable plugins** that share one
small engine.

`@ds-hu/dsh-better-workspaces` is a bundle package. Its own `cordis.patch.yml`
inserts four Loader rows, so the dsh Plugins page shows four separate switches:

| Row | Module | What you get |
| --- | --- | --- |
| `bw-diff` | **代码变更** | The right-sidebar diff page: uncommitted/committed/task diffs, commit list, the commit → pull → push → PR → merge → archive action ladder, and the CAS-protected file editor. |
| `bw-worktree` | **新建 worktree** | ① the staging strip above the composer (worktree mode, branch-name dice, base-branch/PR selector, Create) and ② a matching right-sidebar **新建 worktree** page. Both live on one row and each has its own switch on the row's configuration card. |
| `bw-status` | **工作区 Git 状态** | The branch/PR/CI/`+N/−N`/`↑a↓b` badge line under every Workspace title, the managed-worktree icon, and the composer diff pill. |
| `bw-forge` | **Issue 与 PR** | ① the GitHub control inside the composer (opens the issue/PR picker, inserts a reference chip) and ② a matching right-sidebar **Issue 与 PR** page. Both live on one row with a switch each. |

Switching one row off leaves the other three fully mounted: each row is a
separate Cordis entry with its own host routes, its own browser bundle and its
own switch. The shared library `@ds-hu/dsh-bw-core` is **not** a switchable
module (it declares neither `dsh.bundle` nor `dsh.client`), so no feature can be
disabled by accident.

## Install

Requirements: `dsh` ≥ 0.2.0 with the `web` profile, Node.js ≥ 20.19, `pnpm` on
`PATH`, `git` ≥ 2.31. Linux, Windows 10+/Server 2016+ (Git for Windows) and
macOS 13+ are supported. `gh` (authenticated) is optional: it enables PR/checks
badges, the picker and PR checkout; everything else degrades gracefully.

```bash
dsh plugin --profile web add @ds-hu/dsh-better-workspaces
```

Restart `dsh --profile web` once. No second step: the package declares
`dsh.bundle` and its patch is what mounts the four rows. Do **not** hand-edit
the profile's `cordis.patch.yml` — the bundle already ships every row.

### Upgrading from 0.3.x (one row)

0.3.x shipped a single row called `better-workspaces`. 0.4.x replaces it with
`bw-diff`, `bw-worktree`, `bw-status` and `bw-forge`. Two things to do in a
profile that pinned the old row:

1. Delete any `- id: better-workspaces` override from the profile's
   `cordis.patch.yml` (an unknown id is only a warning, but it is dead weight).
2. Re-apply per-row choices: each module now has its own switch, and
   `worktreesDir` is read from any feature row (recommended: `bw-worktree`).

Browser storage keys, the draft hand-off protocol and every HTTP response shape
are unchanged.

## Native module switching

* **Whole module** — the Plugins page switch of its row. Disabled means the
  Loader does not mount the host half *and* the browser bundle drops out of
  `__DSH_BOOT__`.
* **Module II / IV surfaces** — the row's own configuration card in the Plugins
  page (the two surfaces are registered from the same bundle and re-register
  live when you flip a switch).
* **Route groups** — a disabled module's routes answer
  `404 {"ok":false,"error":"feature module disabled"}`. The read data plane
  (`/snapshots`, `/events`, `/detect`, `/pulls`, `/pull`) is owned by the shared
  engine and stays available while any module is mounted, which is why each
  module is fully functional on its own.

See [docs/ARCHITECTURE-modules.md](docs/ARCHITECTURE-modules.md) for the exact
package/route/surface contract, [CONTEXT.md](CONTEXT.md) for the domain
glossary and [docs/adr/](docs/adr/) for the design records.

## Configuration

The only host config key is `worktreesDir`, the parent directory of the managed
worktree namespace (default `<DSH_HOME>/worktrees`). Write it on one feature
row — `bw-worktree` is the natural place — in the profile patch:

```yaml
- id: bw-worktree
  config:
    worktreesDir: /absolute/path/to/worktrees
```

Changing the base directory after worktrees exist keeps those checkouts usable
for diffs, commits and pushes but drops them out of the managed namespace (no
archive, no abandoned sweep); the host logs the stranded directories at boot.

## Development

The repository is an npm-workspaces monorepo:

```
packages/core       @ds-hu/dsh-bw-core   shared host engine + shared browser source
packages/diff       @ds-hu/dsh-bw-diff   row bw-diff
packages/worktree   @ds-hu/dsh-bw-worktree row bw-worktree
packages/status     @ds-hu/dsh-bw-status row bw-status
packages/forge      @ds-hu/dsh-bw-forge  row bw-forge
```

Browser bundles are **CI artifacts**: `npm run build:client` (esbuild) produces
`packages/<feature>/lib/client.js`, which is git-ignored and built before the
tests and before publish. Nothing in the repository ships built client code, so
a checkout is never stale. Quality gates and releases run in GitHub Actions
(`.github/workflows/ci.yml`, `.github/workflows/release.yml`); `npm run check`
is the same gate locally/CI-side and requires the built bundles.

## Attribution

Portions of the worktree/editor design follow
[paseo](https://github.com/paseo-ai/paseo) (Apache-2.0) and the harness's
`dsh-git-worktree` (MIT); see `NOTICE` and `LICENSES/`.

## License

MIT
