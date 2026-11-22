# ADR 0020 — Repository watcher registration

## Context

The snapshot hub tracks Git status for each active workspace. On Linux, a recursive Node filesystem watcher traverses the repository and consumes inotify watches as the tree grows. This also covers directories Git ignores.

## Decision

| Platform | Working tree | Branch refs |
| --- | --- | --- |
| macOS and Windows | Native recursive watch on the working-tree root | Native recursive watch on the shared `refs` directory |
| Linux and other platforms | Non-recursive watch on the working-tree root | Non-recursive watch on the shared `refs/heads` directory when available |

Both policies also watch the per-worktree Git directory for changes to `HEAD` and the index, and the common Git directory for shared metadata such as packed refs. A main checkout shares those two directories and registers three watches in total. A linked checkout registers up to four. A required watcher failure switches the target to its existing polling backoff. Pruning the target or disposing the hub closes its watches.

## Freshness

Root-level changes still trigger the debounced refresh. Under the shallow policy a nested tracked edit, untracked file, or namespaced branch ref can first surface at the next refresh. The existing round-robin sweep covers up to four active targets a minute. A completed fetch or an explicit fresh read can update the snapshot sooner. macOS and Windows continue to receive recursive changes through their native watchers. [Snapshot refresh scheduling](0018-read-path-never-waits.md)
