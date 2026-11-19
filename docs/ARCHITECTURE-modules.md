# Modular architecture (0.4.0)

This document is the contract for the 0.4.0 split. It describes *what* each
layer owns, *where* it lives, and *which* boundaries may be crossed. Anything
not written here is an implementation detail of one layer.

## 1. Why a split at all

0.3.x shipped one Loader row: every host route, every browser surface and every
piece of git state lived inside one plugin, so the dsh plugin panel could only
switch the whole product on or off. 0.4.0 turns the product into a **bundle of
independent feature plugins**:

```
@ds-hu/dsh-better-workspaces      bundle package: owns cordis.patch.yml only
  └─ rows inserted by its patch:
       @ds-hu/dsh-bw-diff         row id bw-diff
       @ds-hu/dsh-bw-worktree     row id bw-worktree
       @ds-hu/dsh-bw-status       row id bw-status
       @ds-hu/dsh-bw-forge        row id bw-forge
  each feature plugin depends on (never on another feature plugin):
       @ds-hu/dsh-bw-core        shared host library + shared browser source
```

Rules:

1. A feature plugin may import `@ds-hu/dsh-bw-core` and nothing else from this
   repository.
2. `core` imports nothing from a feature plugin. It is a library, not a row:
   it never appears in the plugin panel and never owns UI.
3. No feature plugin may call another feature plugin's HTTP route, service or
   client bundle. Shared reads go through `core` (in process) or the core data
   plane (over HTTP).
4. Turning one row off must leave every other row fully working. Cross-feature
   *niceties* degrade (see §6), no feature loses its own function.

## 2. Native switching

The plugin panel lists one switch per Loader row (and a bundle switch). That is
the only switching mechanism we use:

* `cordis.patch.yml` inserts one row per feature plugin; row `name` is the
  package name (the Loader resolves it from the profile) and row `id` equals
  the `name` the host half exports.
* Row ids are stable forever (`bw-diff`, …). Users can pin a row's config or
  disable it from the profile patch by id.
* Disabled row ⇒ Loader does not mount the host half **and**
  `dsh-client-modules` drops the client half from `__DSH_BOOT__`; the browser
  surface disappears with no effect on other rows.
* Module-level sub-surfaces (module II and IV) are switched from the row's own
  native config page, registered in the `plugins.row.config` slot under
  `<bundle package name>#<row id>`.
* `@ds-hu/dsh-bw-core` declares no `dsh.bundle` and no `dsh.client`, so it can
  never show up as a switchable module.

## 3. Module catalog

| Row | Package | Browser surfaces | Host route groups |
| --- | --- | --- | --- |
| `bw-diff` | `@ds-hu/dsh-bw-diff` | right-sidebar **代码变更** page (diff view + file editor) | `diff`, `file`, `actions`, `archive` |
| `bw-worktree` | `@ds-hu/dsh-bw-worktree` | composer **新建 worktree** strip (toggle ①) and right-sidebar **新建 worktree** page (toggle ②, new) | `worktree` |
| `bw-status` | `@ds-hu/dsh-bw-status` | workspace row badge line + composer diff pill | `status` |
| `bw-forge` | `@ds-hu/dsh-bw-forge` | composer GitHub control + picker (toggle ①) and right-sidebar **Issue 与 PR** page (toggle ②, new) | — (reads the data plane) |

The two toggle pages persist in `localStorage` under
`dsh-bw:<module>:surfaces:v1`; the module re-registers its surfaces live when
the store changes (no reload needed).

`bw-worktree` also owns the background maintenance scheduler (boot recovery and
the hourly abandoned sweep) because the scheduler's unit of work is a managed
worktree. Creation itself is crash-safe without it (`createWorktree` replays
its own journal), so the other rows never depend on it.

## 4. Host layers

```
packages/core/lib/
  git.js lane.js discovery.js stable.js mutation.js diff.js forge.js
  worktree.js state.js authorize.js cleanup.js actions.js git-child.js
      domain + platform plumbing, unchanged in behaviour from 0.3.x
  api.js            one HTTP router; routes are tagged with a group (see §5)
  engine.js         the process-wide runtime every row leases (below)
  index.js          public library surface (`createApi`, scheduler helpers,
                    authorizer/mutation helpers) for tests and feature rows
```

### 4.1 Engine (`engine.js`)

```js
export function acquireRuntime(ctx, config) // -> runtime handle, ref-counted
```

* One runtime per Cordis root context, created by the first row that mounts and
  destroyed when the last row disposes. Rows lease it with
  `ctx.effect(() => () => handle.release())`.
* The runtime owns: the git state hub, the workspace authorizer, the mutation
  coordinator, the single `webServer` prefix route, SSE fan-out and the
  snapshot/forge read paths.
* `handle.claim(groups)` adds route groups and returns an **idempotent
  disposer** that removes exactly those claims (`claim` is ref-counted per
  group, so two rows may share one). The data plane group (`data`) is always on
  while any row is alive and cannot be claimed away. (`groupsOwner` is an alias
  kept for the naming in §4.1 of the original design note; there is no separate
  `releaseGroup` — disposing the claim is the release.)
* `config`: feature rows accept the same optional core config
  (`worktreesDir`). The runtime accepts the first non-null value and throws on
  disagreement, so the key may be written on any one row (recommended:
  `bw-worktree`). Unknown keys are refused.
* The runtime exposes the helpers a feature row's route group needs
  (`hub`, `authorizer`, `workspaceRows`, `createWorkspace`,
  `assertCreationSource`, `assertWorkspaceArchivable`, `deleteWorkspace`,
  `cleanup`, `mutations`), so a group factory receives one object instead of
  eight closures. Helpers that only the engine's own API construction needs
  (for example the stable-root guard) stay internal and are not part of the
  handle.

### 4.2 Feature row (`packages/<feature>/lib/index.js`)

```js
export const name = 'bw-diff';
export const inject = ['webServer', 'workspaceRegistry'];
export function apply(ctx, config = {}) {
  const runtime = acquireRuntime(ctx, config);
  ctx.effect(() => () => runtime.release(), 'bw-diff: runtime lease');
  ctx.effect(() => runtime.claim(['diff', 'file', 'actions', 'archive']),
    'bw-diff: routes');
}
```

`bw-worktree` additionally starts the cleanup scheduler inside its own
`ctx.effect`, with its own `AbortController` (not the shared runtime lifecycle):
turning this one row off must abort only its in-flight sweep, never the hub or
another row's work, and remounting starts from a fresh signal. Nothing else
differs.

## 5. HTTP contract

One prefix survives: `/better-workspaces/api`. The router is mounted once by
the runtime; a path whose group is not claimed answers `404 {"ok":false,
"error":"feature module disabled"}`.

| Group | Paths | Claimed by |
| --- | --- | --- |
| `data` | `GET /detect`, `POST /snapshots`, `GET /snapshot`, `GET /events`, `GET /pulls`, `GET /pull` | runtime (always) |
| `diff` | `GET /diff`, `GET /commits`, `GET /raw` | `bw-diff` |
| `file` | `GET /file`, `POST /file` | `bw-diff` |
| `actions` | `GET /actions`, `POST /action` | `bw-diff` |
| `archive` | `GET /worktrees/deferred`, `POST /worktrees/finalize-delete` | `bw-diff` |
| `worktree` | `GET /branches`, `GET /worktrees`, `POST /worktrees`, `POST /worktrees/archive`, `POST /worktrees/cleanup` | `bw-worktree` |
| `status` | `GET /worktree-workspaces` | `bw-status` |

Rationale: `/pull(s)` are read-only forge *reads* used by both the worktree
creation surface (PR checkout rows) and the forge surface (picker), so they sit
in the data plane instead of making forge a dependency of worktree. The archive
saga (`/action` name `archive` → `/worktrees/deferred` → `/finalize-delete`) is
driven entirely by the diff page's action ladder, so those routes belong to the
diff row even though the domain object is a worktree.

`createApi(hub, { groups })` keeps its 0.3.x behaviour for the host tests when
`groups` is omitted (all groups on).

## 6. Graceful degradation (documented, not accidental)

* Disable `bw-worktree`: diff/status/forge keep working; the diff action ladder
  no longer offers Archive (the button is driven by worktree metadata in the
  snapshot, which stays correct), and no new worktrees can be created.
* Disable `bw-diff`: the other surfaces keep their data plane and their own
  routes; the 代码变更 guide entry disappears.
* Disable `bw-forge`: the diff page keeps PR status badges (the data plane
  computes them); only the composer control and the Issue/PR page disappear.
* Disable `bw-status`: badges and the diff pill disappear; every action surface
  keeps its own entry point.
* Disable the bundle: the old single-plugin behaviour is replaced by four new
  row ids. A profile that pinned `id: better-workspaces` keeps a harmless
  unknown-id warning; see README migration.

## 7. Browser layers

```
packages/core/client/            shared browser source, no bundle of its own
  index.js                       re-exports the shared surface
  react.js                       module-table require helper (`require('react')`)
  util.js store.js api.js feed.js i18n.js icons.js dom.js
  sidebar-page.js                registerSidebarPage(ctx, definition) — one
                                 page type + pane tab + title + guide entry
packages/<feature>/client/
  index.js                       the bundle entry: `apply`/`inject`/`__bwTest`
  … surface sources
packages/<feature>/lib/client.js built artifact, git-ignored, produced by CI
```

* Every feature client bundle is self-contained: `@ds-hu/dsh-bw-core/client/*`
  sources are bundled into it by esbuild, so no runtime import crosses a
  package boundary.
* Shared browser state is duplicated per bundle on purpose. The only shared
  runtime fact is the host's data plane, which is idempotent and cached.
* Each bundle registers its own locale namespace
  (`bw-diff`, `bw-worktree`, `bw-status`, `bw-forge`) and its own CSS tag
  (`data-plugin-css="<package name>/client.css"`).
* Each row package ships its own `icon.svg` through both the manifest `icon`
  field and the `./icon` export; the four glyphs share one tile family but are
  distinct (split diff, branch fork, status line, conversation). The bundle
  icon draws the four module panes it mounts. `test/package.mjs` fails when two
  published icons are byte-identical.
* The new right-sidebar pages use the same `registerSidebarPage` helper as the
  diff page: page type + `sidebar.right.pane.tab` body + `.title` + a `guide`
  entry, so they appear beside 代码变更 on the sidebar's start page and as
  chips in the tab strip.
* Feature client `inject` lists the official packages whose services it uses
  (`@deepseek-ai/dsh-client-ui-conversation`, `-session`, `-sidebar-right`,
  `-workspace`), never another feature package.

## 8. Build

`scripts/build-client.mjs` (esbuild, run in CI only) bundles each
`packages/<feature>/client/index.js` into `packages/<feature>/lib/client.js`
wrapped in `window.__ModuleLoader__.load({ id: <package name>, factory })`.
Externals: `react`, `react-dom/client`,
`@deepseek-ai/dsh-client-ui-primitives`. Built artifacts are git-ignored and are
always produced by CI before tests and before publish.

## 9. Tests

* Host suites import `packages/core/lib/*` directly and keep exercising the
  domain modules unchanged. `createApi` without `groups` still mounts the whole
  surface, so 0.3.x cases are portable.
* New host cases prove the split: each feature row mounts alone (fake ctx with
  only that row imported), claims only its groups, answers its own routes and
  404s every unclaimed one; two runtimes in one process share one hub; the last
  release unregisters the prefix route.
* Browser suites load all four built bundles through one fake
  `window.__ModuleLoader__`, merge their `__bwTest` exports into one object
  (0.3.x assertions keep working) and offer `applyAll(ctx)` for full-surface
  tests.
* `test/package.mjs` validates every published manifest (row names, patch rows,
  locale meta, icons, no dev files).
* `test/mount-check.mjs` imports every host entry and runs `apply` against a
  dormant and a live fake ctx, exactly as in 0.3.x.
* Builds and test runs happen **only in GitHub Actions**; the repository never
  ships built client artifacts.

## 10. Release

`.github/workflows/release.yml` runs on tag `v*`: install, build, full check,
then publish `core → four feature packages → bundle` in that order (npm), then
create a GitHub release. The bundle's `dependencies` pin the four feature
packages to the same version, and each feature package pins `core` to the same
version. Transitional `engines.dsh` stays `>=0.2.0 <0.3.0`.

## 11. Compatibility

* Profile rows: old `better-workspaces` row id disappears; four new ids appear.
  Existing `- id: better-workspaces` overrides in a profile patch are inert
  (unknown id) and should be deleted.
* `worktreesDir` moves to the feature rows (any single row). The built-in
  default and validation rules are unchanged.
* Host routes and their response shapes are unchanged; only *which row* mounts
  them changed, and the two new-forge paths reuse the existing handler code
  (`/pull(s)` stay in the data plane).
* Browser storage keys and the draft hand-off protocol are unchanged.
