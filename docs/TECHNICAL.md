# Technical documentation

Architecture, installation details, release verification, development, operations, and attribution for `@ds-hu/dsh-better-workspaces`. For the product overview and screenshots, see [README](../README.md).

## Architecture

- **Host** (`lib/index.js` → `git.js`, `worktree.js`, `cleanup.js`, `forge.js`, `diff.js`, `actions.js`, `state.js`, `api.js`, `lane.js` and `discovery.js` as the two cost layers): git-CLI primitives behind one 8-slot lane with a **foreground/background split** (`lane.js`: work a request is waiting on always starts before a recompute or a periodic fetch, and a background task that waits too long is promoted so it cannot starve); repository discovery cached as **strings only** for 30 s, keyed by path **and** dev/ino, with every identity and ownership proof still live and mutation paths always re-discovering (`discovery.js`, ADR 0013 Amendment 2); managed worktrees under `<worktreesDir>/<8-char base36 sha256(mainRepoRoot)>/<repo>-<branch>` — `worktreesDir` defaults to `~/.dsh/worktrees` and is settable as the row's config key (see [Configuration](#configuration-worktree-base-directory), ADR 0017) — the leaf carries the repository name so it is identifiable on its own, and both halves are budgeted to keep it ≤65 characters — with `<gitdir>/dsh-worktree/worktree.json` metadata and three creation intents — `branch-off` (cut from a base), `checkout`, and `pr-checkout` (fetch the forge's `refs/pull/<N>/head` from origin/upstream, create the local branch with `git worktree add -b … --no-track <sha>`, take the PR's own base as the diff baseline, and track `origin/<headRef>` for same-repo PRs only); the leaf derives from `<repo>-<branch>` on the host, so the client sends no directory slug and the plugin makes no LLM calls of its own; snapshot hub with fs watchers (1 s debounce, degraded polling backing off 5 → 15 → 30 s), a bounded round-robin sweep for watcher blind spots, 180 s background fetch (first one deferred 10 s, at most two repositories per tick, 30 s timeout), per-repository fact caches (5 min for default branch and origin URL, 60 s for the comparison ref, dropped on a fetch and on any mutation) and fingerprint-deduped SSE; `forge.js` serves both the batched PR/checks GraphQL and the picker's issue/PR pages (`GET /pulls`, `GET /pull`) through the user's `gh` CLI (30 s cache, never tokens); HTTP+SSE API on the harness webServer under `/better-workspaces/api`.
- **Client** (`lib/client.js`, hand-written `__ModuleLoader__` bundle): slot-registered right-Sidebar diff page + dock pill + composer forge control (`conversation.input.left`) with its `@` reference source/codec for issue/PR chips; DOM injection (MutationObserver + React portals + anchor self-check with silent degradation, ADR 0001) for the hero dropdown and sidebar badges, which have no fine-grained slots.

See [CONTEXT.md](../CONTEXT.md) for the glossary and [docs/adr/](adr/) for the design records.

**The snapshot read path never waits for a compute** (ADR 0018). `POST /snapshots` answers from what is known and names the rest:

```jsonc
// POST /better-workspaces/api/snapshots  { "cwds": ["…"] }
{ "ok": true, "byCwd": { "…a cwd with a snapshot…": { /* full snapshot, unchanged */ } },
  "pending": ["…a cwd that is being computed right now…"] }
```

A cwd that is absent from `byCwd` is "not known yet", **not** "not a git repository" — a non-git workspace answers `isGit: false` like it always did. Consumers keep rendering the previous snapshot until the SSE `snapshot` frame (or the next batch) fills it in, so a badge never blanks and repaints. Add `{ "fresh": true }` to wait for the compute (the client uses that only for its post-action refresh). The same rule explains the timings in this document: a read costs one authorization (cached discovery, live identity checks) and nothing else.

## Install (web profile)

Prerequisites: `dsh` ≥ 0.2.0 with the `web` profile, Node.js ≥ 20.19, `pnpm` on `PATH`, `git` ≥ 2.31, and a supported platform — Linux, Windows 10+/Server 2016+ (Git for Windows), or macOS 13+. **0.2.1 is the tested target;** the package declares `engines.dsh` `>=0.2.0 <0.3.0`, so 0.2.0 keeps the pre-`workingDirectory` fallback while 0.2.1 adds the effective-directory and native-worktree paths described below. Platform anchoring is layered (ADR 0013): **Linux** pins every repository mutation and file save to verified dirfds through `/proc` and commits saves with `renameat2(RENAME_EXCHANGE)` (GNU coreutils `mv --exchange`; a Linux system without it still fails closed with HTTP 503 rather than weakening the exchange guarantee); **Windows and macOS** run the paseo path model — canonical paths for Git discovery, stat dev/ino identity checks at every operation boundary plus re-authorization after mutations, and file saves through fsync + sha1 compare-and-swap + atomic rename (paseo's file-editor semantics; the displaced-inode exchange rollback is a Linux-only extra). `gh` (authenticated) is optional — it enables the PR/checks features and the composer's issue/PR picker and PR checkout, and degrades gracefully when absent.

**One command installs and mounts the plugin** (plain JS, no build step):

```bash
dsh plugin --profile web add @ds-hu/dsh-better-workspaces
```

Then restart `dsh --profile web` once. There is no second step: this package is a **bundle** (it declares `dsh.bundle.patch` next to `dsh.client`), so the dsh CLI's reconcile step appends it to the profile's `dsh.profile.bundles` automatically, and its own `cordis.patch.yml` becomes a patch layer that carries the plugin row. **Do not hand-edit the profile's `cordis.patch.yml`** — the package already ships that row.

Self-check:

```bash
# the composed tree shows the package's own layer and exactly one row
dsh --profile web --dump-config | grep -A 1 '== @ds-hu/dsh-better-workspaces'
#   # == @ds-hu/dsh-better-workspaces
#   - id: better-workspaces
#     name: '@ds-hu/dsh-better-workspaces'

curl -s http://127.0.0.1:3080/better-workspaces/api/worktree-workspaces
#   expected {"ok":true,...}; 404 means the row did not activate
```

Uninstall is symmetric — reconcile also drops the bundle from `dsh.profile.bundles`:

```bash
dsh plugin --profile web remove @ds-hu/dsh-better-workspaces
```

## Configuration (worktree base directory)

Managed worktrees live under `<worktreesDir>/<8-char base36 sha256(mainRepoRoot)>/<repo>-<branch>`. `worktreesDir` is a plugin-row config key; when it is absent the base is `$DSH_HOME/worktrees` (`~/.dsh/worktrees`). This is **config-only on purpose** — there is no UI for it (ADR 0017).

Set it by patching the mount row in your profile's `cordis.patch.yml`:

```yaml
# $DSH_HOME/profiles/web/cordis.patch.yml
- id: better-workspaces
  config:
    worktreesDir: 'D:\worktrees'
```

That entry is a **patch, not a second mount**: it carries no `insert` and no `name`, so `@deepseek-ai/cordis-plugin-include` resolves the row the package's own bundle layer inserted and assigns `config` to it. Profile layers are applied after every bundle layer, so the row always exists by the time this patch runs — and adding `insert` or a second `name` here is the ADR 0007 `duplicate loader entry id` boot failure. `dsh --profile web --dump-config` shows the resulting row, `config` included.

Rules the host enforces:

| Value | Behaviour |
|---|---|
| `~`, `~/…`, `~\…` | expanded to the home directory |
| `$VAR` / `%VAR%` | **not** expanded — write the literal path |
| empty / absent | the built-in base; a config-layer reload that drops the key restores it |
| relative path, non-string, unknown key | the row **fails to mount**, with the offending value in the message; the plugin never falls back to a different directory |
| non-existent directory | created on first use (exactly as `$DSH_HOME/worktrees` always was) |
| symlink / junction / short-name path | refused on first use — the managed root must be a real direct directory (ADR 0010) |
| path inside the checkout being branched | refused on first use, so a typo cannot nest a worktree inside the repository |
| `config` in a patch | replaces the row's whole config (host patch semantics); this row ships no config today, so the snippet is complete |

**Changing it later strands the existing worktrees.** Managed identity is namespace membership: a checkout under a base that is no longer configured stops being managed. It keeps working — diffs, commits, pushes, PRs and merge actions never depended on managed metadata — but archive and abandoned cleanup no longer reach it, and `/detect` reports `managed: false`, which moves the diff view's default scope from task to session/uncommitted. The plugin writes one warning to the host log at startup naming both directories and the count; in-flight create journals and registry tombstones under the previous base are not scanned either, so finish any in-flight creation before you change the value. Decide the base before creating worktrees, or archive what you no longer need and move what you do with `git worktree move`.

The config layer is live in the `web` profile, so a change re-applies the row without a restart; sessions keep their cwd either way, which means only worktrees created afterwards land under the new base. (When in doubt, restart — a stale row is indistinguishable from a typo until you look.)

## Verifying a release against a live dsh (required before publishing)

The offline suites (`npm test`) load this package's own JS with stub `ctx`, stub slot hooks and a stub right-Sidebar registry. That is deliberate — it keeps them fast and hermetic — but it means **they cannot see the harness's live contracts**, so they pass while a contract drifts. Real examples caught only by the recipe below: the right-Sidebar registry requires a `guide[].id` this package originally omitted, and the host's workspace-registry `create()` moved from sync to `async` while `sessions.list()` changed from an id map to `Session[]`.

A throwaway profile proves both halves against the `dsh` on `PATH` without touching your real profile. It is cheap and catches the whole class:

```bash
snap=$(mktemp -d)/bw          # a snapshot OUTSIDE this repo
git worktree add --detach "$snap" HEAD
scratch=$(mktemp -d)/dshhome
mkdir -p "$scratch/profiles/web"
printf 'name: dsh-profile-web\nphase: external\nisolation: manual\n' \
  > "$scratch/profiles/web/cordis.yml"
printf '{"name":"dsh-profile-web","private":true,"dsh":{"profile":{"bundles":["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app"],"patchReload":"live"}},"dependencies":{}}' \
  > "$scratch/profiles/web/package.json"
printf 'packages:\n  - .\n' > "$scratch/profiles/web/pnpm-workspace.yaml"

# 1. the CLI reconciles the bundle and the loader composes exactly one row
DSH_HOME="$scratch" dsh plugin --profile web add "link:$snap"
DSH_HOME="$scratch" dsh --profile web --dump-config | grep -A 1 '== @ds-hu/dsh-better-workspaces'

# 2. boot it and prove BOTH halves are live (host route + browser bundle)
DSH_HOME="$scratch" dsh --profile web --no-open --port 3099 &
curl -s http://127.0.0.1:3099/better-workspaces/api/worktree-workspaces
#   expected {"ok":true,...}; 404 means the row did not activate
# open the printed ?token= URL, then confirm the plugin bundle is injected and
# served (both must be 200 — 200 + 404 means the host half mounted while the
# browser half did not build):
#   grep -o 'better-workspaces/client.js' <index.html>
#   curl -b <cookie> 'http://127.0.0.1:3099/plugins/??...,@ds-hu/dsh-better-workspaces/client.js,...'
```

`link:` points at the snapshot, so the plugin is installed from a clean checkout — what a user gets from `@ds-hu/dsh-better-workspaces` — and your working tree stays untouched. Then remove the probe worktree (`git worktree remove "$snap"`).

**Two footguns in that recipe, both learned the hard way.**

`link:` is for probing only. The profile's correctness then depends on a directory that lives outside it, so **the moment the snapshot is deleted the plugin's manifest becomes unreadable** and the Plugins page renders `包元信息错误: Plugin metadata for @ds-hu/dsh-better-workspaces: … ENOENT: no such file or directory, open '/…/package.json'` — the plugin itself keeps running, only its display metadata breaks. Always replace the probe with the published spec (same command without the `link:`) before walking away, and only then remove the snapshot.

The **rendered UI must be looked at**, because DOM-injection degradation is silent by design (ADR 0001). The offline suites build their own DOM and therefore cannot see the slot framework's wrappers — a slot's `parentElement` is the renderer's `display: contents` anchor, *not* the layout row containing it (ADR 0001 Amendment 2).

**A control that renders is not a control that works.** The hero worktree button appeared, was enabled, armed itself with a branch name, and still did nothing for a whole session: the on-screen Session was read from `sessions.list.current`, a field `dsh-api-session-controller` never publishes, so the create guard returned silently *before* the request, the busy state and the error (ADR 0015). When a click produces neither a request nor a message, check `__dshBwDebug.hero()` (`lastCwd`, `lastGuard`) and then the network panel — a missing request names the bug class.

Ask the plugin itself instead of inferring from the DOM, using the read-only diagnostic surface it installs while mounted:

```js
window.__dshBwDebug.describeOnScreen()
// { currentId, sessionCwd, resolvedCwd, source, owningWorkspacePath,
//   lastGuard: { visible, noCwd, noDetect, notGit, linkedWorktree },
//   lastDetect, rowFound, controlCount }
```

`source` names the tier that supplied the directory — `'session'` for the session's own cwd, `'workspace'` for the path of the Workspace that owns it, which is what a blank session has before its first message — and `lastGuard` names exactly which term of the visibility test decided the outcome. Pair it with `probe()`, which reports the DOM the injector actually saw:

```js
window.__dshBwDebug.probe()
// dom: { rowCount, rowFound, rowChildren:[{cls,dataSlot,display,text}], slotTags, controls:[...] }
// resolution: the fields describeOnScreen reports
```

Which reading means what:

| `rowFound` | `controls[0]` | `resolvedCwd` | `lastGuard` | layer to fix |
|---|---|---|---|---|
| `false` | none | any | — | the hero row is not on screen; not a defect |
| `true` | none | `null` | `noCwd` | resolution: neither the session nor its Workspace gives a directory |
| `true` | none | set | `noDetect` | detection never settled for that cwd |
| `true` | none | set | `notGit` / `linkedWorktree` | not an ordinary checkout; hiding is by design |
| `true` | present, `width: 0` | set | `visible` | the control mounted but draws nothing |
| `true` | absent, `visible` | set | `visible` | injection: the anchor moved |

The rule that keeps this from becoming a rewrite: **no visible control while `lastGuard.visible === true` is an anchor bug; every other combination is decided before rendering.** This hook is a diagnostic, not a public API — it is read-only, removed with the plugin's effect, and carries no stability promise.

If `window.__dshBwDebug` is missing, the browser is still running an older bundle: hard-refresh (Ctrl+Shift+R) before reading anything else, because the client bundle is assembled once when `dsh web` starts.

## Upgrading from a pre-bundle install (0.0.1)

Versions before 0.1.0 declared only `dsh.client`, so mounting meant hand-writing this row into the profile's `cordis.patch.yml`:

```yaml
- insert:
    - id: better-workspaces
      name: dsh-better-workspaces
```

That row must now be **deleted** (re-run the `add` command above first so reconcile lists the bundle). Two sources for one row is not a harmless duplicate: the include inserts rows verbatim and the Loader rejects a repeated entry id, so the next boot fails loudly with

```
duplicate loader entry id: better-workspaces
```

Delete the hand-written insert block (leave every other entry in that file, such as the `authorization` row, untouched) and the package's own layer takes over.

### Upgrading from the unscoped package

Releases up to 0.2.6 were published as `dsh-better-workspaces`; the current package is `@ds-hu/dsh-better-workspaces`. Both bundles insert a loader row with id `better-workspaces`, so installing the new one beside the old one makes the next boot fail with `duplicate loader entry id: better-workspaces`. Remove the old bundle first, then install the new one once:

```bash
dsh plugin --profile web remove dsh-better-workspaces
dsh plugin --profile web add @ds-hu/dsh-better-workspaces
# or, before the next npm release:
dsh plugin --profile web add /path/to/ds-hu-dsh-better-workspaces-0.2.9.tgz
```

Restart `dsh --profile web` after the swap. The installed components change name and version, and the profile's bundle list is recomputed at boot; a page refresh alone does not re-read the host half.

## DSH 0.2.1 compatibility

DSH 0.2.1 changes the Session directory model and introduces native Git worktrees; this release (0.2.9) adapts to both without changing the managed-worktree lifecycle.

- **Effective working directory.** 0.2.1 keeps the Session header's `cwd` as the immutable *original* project and records the directory a Session actually entered in the `workingDirectory` Session projection. The client reads that projection first (`effectiveSessionCwd`) and keeps the header as the 0.2.0 fallback, so sidebar badges, the hero control, the diff page, and forge references follow a Session that moved into a worktree.
- **Native worktrees.** The optional official *Git Worktrees* bundle creates checkouts under `<repo>/.agents/worktrees/<name>` and changes the calling Session's working directory, but does not write this plugin's `dsh-worktree` metadata. The host authorizer accepts such a checkout only when it is a live `git worktree list` row of an **exact registered main checkout**; it is authorized as `kind: 'linked-worktree'`, so snapshots, diffs, commits, pushes, PRs, and merge actions work. Archive and cleanup still require `managed-worktree` metadata, so they never delete a native checkout. A subdirectory of a worktree, and a worktree of an unregistered checkout, remain unauthorized (ADR 0010).
- **Compatibility declaration.** `package.json` declares `engines.dsh` (`>=0.2.0 <0.3.0`). 0.2.1's installation and profile preflight read that range before any DSH peer dependency.
- **Inventory metadata.** `locale/en.json` and `locale/zh.json` provide the localized title and description (English *Better Workspaces* / 中文 *工作区增强*), and `icon.svg` is original artwork. All three are exported and included in `files`, so Plugin Manager and Settings can read them without activating the plugin.
- **Coexistence.** Both worktree flows may be enabled at once. This plugin's archive and cleanup only ever touch its own managed worktrees; native checkouts stay owned by DSH and Git. Prefer one flow per task to avoid two checkouts of the same branch.

## Developing from a local checkout

Use a `link:` spec; only the spec differs, the mount is the same:

```bash
dsh plugin --profile web add link:/path/to/dsh-better-workspaces
```

Host code edits need a `dsh` restart (Node's ESM cache survives patch reloads — ADR 0003); client-bundle edits hot-rebuild in the module graph and only need a page refresh. The package's `cordis.patch.yml` is composed at boot, so editing *that* file needs a restart too. The row declares hard injects for `webServer` and `workspaceRegistry`, so cold boot waits for both the HTTP surface and the registry-backed authorization source instead of racing either one (ADRs 0005 and 0010) — if the UI is missing after a restart, run the self-check in the operations section below.

## Reverse proxy and Cloudflare Tunnel

The API's POST gate is same-origin by design (ADR 0012): an `Origin` must match the `Host` header and the scheme the *browser* used. A TLS-terminating tunnel (Cloudflare Tunnel, or any `https` reverse proxy) speaks plain HTTP to this server, so the browser-visible scheme can only come from the proxy itself:

- run the tunnel client on the same host, point it at `http://127.0.0.1:3080`, and leave the `Host` header untouched (cloudflared's default — do **not** pass `--http-host-header`);
- the Cloudflare edge supplies `X-Forwarded-Proto: https`, which the plugin honours **only for loopback peers**; a request arriving from a non-loopback address can never vouch for its own scheme or host;
- if a proxy rewrites `Host`, it must also state the browser-visible name in `X-Forwarded-Host`.

Requests without an `Origin`, opaque (`Origin: null`) ones, and any request whose `Sec-Fetch-Site` is not `same-origin` stay rejected — embedding the GUI in a cross-site frame is not supported.

## Development and quality gates

Repository development uses npm and the committed lockfile; `pnpm` above is a DSH installer/runtime prerequisite, not this repository's package manager. React and ReactDOM are supplied to the browser half by the DSH module graph; matching React 18 versions are development-only dependencies for deterministic real lifecycle tests.

```bash
npm ci
npm run check
```

`npm run check` runs ESLint, scratch-repository Host tests, security and mutation suites, the fast client contract smoke test, a real React + JSDOM effect/focus/cleanup suite, mount checks, and an npm-pack allowlist test that requires NOTICE, both locale dictionaries, the icon, and all third-party licenses. CI runs that full gate on Ubuntu with the latest Node 20 and Node 22, and a second job on `windows-latest` (Node 22, host + security + mount) for the half of the implementation Linux cannot see: the Windows path model of ADR 0013.

### Running the suites locally

The Host suite is dominated by process spawns and file writes — on Windows every `git` invocation, and every freshly written fixture file, goes through antivirus — so the same cases take about a minute on Linux CI and anywhere from 7 to 40 minutes on a Windows workstation. Measured on one such box: a `git` spawn against a warm repository averaged 822 ms with a 78 ms minimum and a 2.9 s maximum, while a whole worktree creation costs only a handful of milliseconds of `fsync`. Three knobs keep local runs usable:

- `npm run test:host -- --progress` prints one line per case with its duration, so a stalled run is distinguishable from a slow one.
- `npm run test:host -- --only=worktreesDir,archive` runs only the cases whose label contains one of the needles. Use it for self-contained cases — several share fixtures created by earlier ones — and never as a substitute for the full gate.
- `DSH_BW_TEST_TMP=<dir>` moves the scratch tree (thousands of files) onto a faster or antivirus-excluded volume. Fixture repositories are also initialized from an empty Git template, so each one writes 9 files instead of 27; the option is passed first because one fixture supplies a positional directory (`git init --separate-git-dir <dir> <work>`).
- `--tmp=<dir>` does the same for one run. The scratch root is canonicalized with `realpathSync.native` — the JS implementation walks components and leaves an 8.3 short name alone — because a hosted Windows runner reaches `%TEMP%` as `C:\Users\RUNNER~1\…` while Git and `realpath` report `C:\Users\runneradmin\…`; comparing those two failed 43 cases. Pass a short-name path (`--tmp=C:\ProgRA~1\…`) to reproduce that class locally; it also exercises the "use that canonical path" hint for a `worktreesDir` given in short form.

A finished suite exits on purpose: `test/run.js` prints its report, lists any handle still open, and exits once the report has flushed. The state hub's housekeeping timers are `unref()`ed for the same reason. Without both, a case that leaked a hub (or an HTTP server a failing case never closed) left the process on the event loop — on a hosted Windows runner that meant every case reported within 17 seconds and the job then sat until its timeout.

Cases whose fixture cannot exist on Windows are recorded as `SKIP <label>: <reason>` — never as a pass, because a skip says nothing about the guard it would prove. They are: POSIX shells with `/usr/bin/git` and process-group kill (the parent-guard and inspect/remove-race fixtures), control characters, quotes and a literal backslash in file names (the porcelain `-z` decoding case), `which` + `:`-separated `PATH` (the fake `git`), `/proc/self/fd` (the descriptor-leak count), a Windows absolute path inside a ref name (the push-option injection case), and the fake `gh` behind the forge suite — a `#!/bin/sh` script that Windows neither executes nor searches, so the *real* `gh` answered, reached github.com over the network, and made five cases slow and state-dependent. All of them run in full on Linux CI; what a Windows run adds is the platform-specific behaviour — path-mode anchoring, exchange-capability gating, and NTFS mode/identity quirks (`0o664` reads back as `0o666`; a file index above 2^53 makes `ino + 1` round to itself).

## Operations: cold start and restart self-check

**Module resolution.** The dsh loader resolves bare package names through Node's internal ESM loader relative to the **profile directory**, so a `link:` dependency installed in `$DSH_HOME/profiles/web/node_modules` is enough. No other anchor is needed (an earlier “shared anchor” diagnosis was wrong; see ADR 0005).

**The cold-start failure that motivated the injects** (ADR 0005): the host row used to declare `inject = []`, so on a cold boot it activated before the web app provided `webServer`. `ctx.get('webServer')` returned nothing, the row took the dormant path and never retried, and every route and client bundle returned 404. The GUI lost the hero control, badges, and tabs together. Patch reloads happened inside an already-running process where `webServer` existed, which is why live reload always looked fine. The fix is `export const inject = ['webServer']`; Cordis waits for the service before activating the row.

**Where the row comes from.** This package declares `dsh.bundle.patch`, so the row is supplied by the package's own `cordis.patch.yml` layer (`dsh plugin add` writes the package into `dsh.profile.bundles`). The profile's own patch layer must **not** contain a second row with the same id: include `insert` appends verbatim and does not deduplicate by id, and the loader fails the whole web boot with `duplicate loader entry id: better-workspaces`.

Three checks after a restart:

1. `dsh --profile web --dump-config | grep -A 1 '== @ds-hu/dsh-better-workspaces'` — the package layer appears and `id: better-workspaces` appears **exactly once** (more than once means a hand-written row is still in the profile layer; delete it).
2. `curl -s http://127.0.0.1:3080/better-workspaces/api/worktree-workspaces` — expect `{"ok":true,...}`. A 404 means the row did not activate: confirm the `link:` dependency exists in the profile's `node_modules` and that `lib/index.js` still injects both `webServer` and `workspaceRegistry`.
3. Refresh the GUI: a non-worktree workspace shows the `Local` hero control; a worktree workspace hides it and shows a branch icon on the workspace row.

`npm test` includes `test/mount-check.mjs`. It asserts that `inject` contains both `webServer` and `workspaceRegistry` (the latter supplies the authorization root), that the package declares `dsh.bundle.patch`, and that its own patch contributes exactly one row (`name` = package name, `id` = the host-exported `name`, published through `files`). Without those declarations, `dsh plugin add` installs the package as an ordinary dependency and silently mounts nothing. The check also imports and applies every host module with a minimal fake `ctx` (both dormant and `webServer` paths), so mount-time throws surface without restarting a dsh process.

## Third-party attribution

Original project code is MIT-licensed; modified or independently adapted third-party portions retain their notices from Paseo (Apache-2.0) and dsh-git-worktree (MIT). Exact audited revisions, modification notices and complete license texts ship in `NOTICE` and `LICENSES/`.
