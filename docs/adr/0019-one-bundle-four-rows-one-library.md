# ADR 0019 — One bundle, four feature rows, one shared library

Status: accepted (0.4.0).

## Context

0.3.x shipped exactly one Loader row. Every host route, every browser surface
and the whole git-state engine lived in that row, so the dsh Plugins page could
only switch the entire product on or off. The product is four products:

1. a diff page in the official right sidebar,
2. new-worktree creation (composer strip, and later a right-sidebar page),
3. Git status shown where the workspace lives (badge line, diff pill),
4. forge references (composer control, and later a right-sidebar page).

They share a large read-only engine (git plumbing, snapshot hub, authorization,
forge reads) and share no user-facing behaviour.

## Decision

**One bundle package, one row per feature, one shared library.**

* `@ds-hu/dsh-better-workspaces` stays the installable bundle. It declares
  `dsh.bundle.patch` and nothing else: no `main`, no `exports`, no `dsh.client`.
  Its patch inserts exactly four rows.
* Each feature is a published npm package with its own host half and its own
  browser bundle: `@ds-hu/dsh-bw-diff` (`bw-diff`),
  `@ds-hu/dsh-bw-worktree` (`bw-worktree`), `@ds-hu/dsh-bw-status`
  (`bw-status`), `@ds-hu/dsh-bw-forge` (`bw-forge`). A row is a package, so the
  Loader, the client module graph, the panel's metadata and the user's
  disable/config override all address it natively.
* `@ds-hu/dsh-bw-core` is a *library*, not a row: it declares neither
  `dsh.bundle` nor `dsh.client` and can never appear as a switch. It owns the
  engine, and a ref-counted per-root runtime (`acquireRuntime`) mounts the
  always-on read data plane once for whichever rows are alive.
* Host routes are partitioned into groups (`data`, `diff`, `file`, `actions`,
  `archive`, `worktree`, `status`). A row claims only its groups; an unclaimed
  group answers `404 feature module disabled`.
* Module II and IV expose their two surfaces as switches on the row's own
  native configuration card (`plugins.row.config`), persisted in
  `localStorage` and applied live.
* Browser bundles are CI artifacts bundled by esbuild from the repo's source,
  so each bundle is self-contained; the only runtime coupling is the host data
  plane.

## Rejected alternatives

**Nested sub-packages linked by a `postinstall` script** (the dsh-pocket
pattern). It works, but it makes the published tarball the installer's job: the
link is created inside the installed package, pnpm's script blocking becomes a
user-facing step, and the Loader resolves rows from the profile, not from the
bundle. Publishing each module as a real dependency of the bundle keeps
resolution in npm's hands and removes the install-time script entirely.

**One row with a native config form for module selection.** The panel would show
one switch and a form, so a user could not see which modules are alive, an
`agent` could not enable a module with a profile patch row, and a broken module
would take the other three down with it (one host entry, one client bundle).

**A service-bearing engine row.** The four feature rows would `inject` the
engine's service; disabling the engine row would break all of them, and adding
a new module would require the engine row too. A library has no such switch.

**Keeping the monolith as the composition root** and registering feature rows
that only render UI. The host behaviour would stay in one file that every row
imports, so "independent" would be a rendering claim only.

## Consequences

* A feature can be released, switched and configured at row granularity; a
  crashed module no longer affects the others' mounting.
* The publish graph grows from one package to six, published in dependency
  order by the release workflow.
* The migration is a row-id change; see README. Users delete old
  `better-workspaces` overrides.
* Cross-module *niceties* are explicit: with `bw-worktree` off, the diff action
  ladder no longer offers Archive; with `bw-forge` off, PR creation still works
  because `gh` reads stay in the core data plane. Every module keeps its own
  function regardless of the others (docs/ARCHITECTURE-modules.md §6).
* Tests split along the same line: host suites import core domain modules and
  the union router; a new isolation suite proves each row mounts alone; the
  browser suites load all four built bundles and merge their test hooks.
