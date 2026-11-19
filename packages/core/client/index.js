/**
 * The shared browser surface of `@ds-hu/dsh-bw-core`.
 *
 * Feature bundles import the individual modules directly
 * (`@ds-hu/dsh-bw-core/client/react.js`, …); this entry re-exports the whole
 * surface for consumers that prefer one specifier, and carries nothing that the
 * individual modules do not already own.
 */
export * from './react.js';
export * from './util.js';
export * from './api.js';
export * from './store.js';
export * from './session.js';
export * from './draft.js';
export * from './workspace.js';
export * from './icons.js';
export * from './ui.js';
export * from './dom.js';
export * from './prefs.js';
export * from './css.js';
export * from './sidebar-page.js';
export * from './debug.js';
export * from './i18n.js';
export { createGitFeed, useGitCwd, gitCwd, detectPath, syncOf, snapshotMutationKnown } from './feed.js';