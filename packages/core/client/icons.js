/**
 * The plugin's icons: the branch motif, the GitHub mark, the diff glyph and the
 * forge row glyphs. Components here are pure — they render markup and read no
 * module state.
 *
 * `WT_ICON_SVG` is the raw SVG string the sidebar injector needs for DOM
 * injection (injected nodes need markup); `GitBranchGlyph` is the same motif for
 * our own React renders.
 */
import { h } from './react.js';

/** raw SVG string for DOM injection into shell workspace rows. */
export const WT_ICON_SVG = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="4.75" cy="3.6" r="1.85"></circle><circle cx="4.75" cy="12.4" r="1.85"></circle><circle cx="11.6" cy="5.15" r="1.85"></circle><path d="M4.75 5.45v5.1"></path><path d="M11.6 7c0 2.85-2.55 3.35-4.55 3.65"></path></svg>';

/** git-branch glyph, stroke style to match the shell's hero icons. */
export function GitBranchGlyph(props) {
  return h('svg', Object.assign({
    width: '1em', height: '1em', viewBox: '0 0 16 16', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round',
    'aria-hidden': 'true', focusable: 'false',
    style: { flex: 'none', display: 'block' },
  }, props || {}),
  h('circle', { cx: 4.75, cy: 3.6, r: 1.85 }),
  h('circle', { cx: 4.75, cy: 12.4, r: 1.85 }),
  h('circle', { cx: 11.6, cy: 5.15, r: 1.85 }),
  h('path', { d: 'M4.75 5.45v5.1' }),
  h('path', { d: 'M11.6 7c0 2.85-2.55 3.35-4.55 3.65' }));
}

/** Alias kept for the 0.3.x export name. */
export const BranchIcon = GitBranchGlyph;

/** GitHub mark (octicon path, currentColor) — the composer's third button. */
export function GithubMark(props) {
  return h('svg', Object.assign({
    width: '1em', height: '1em', viewBox: '0 0 16 16', fill: 'currentColor',
    'aria-hidden': 'true', focusable: 'false',
    style: { flex: 'none', display: 'block' },
  }, props || {}),
  h('path', { d: 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A7.995 7.995 0 0016 8c0-4.42-3.58-8-8-8z' }));
}

/** Alias kept for the 0.3.x export name. */
export const ForgeIcon = GithubMark;

/** The diff page's glyph: a page with one added and one removed line. */
export function DiffGlyph({ size, className } = {}) {
  const edge = size || 16;
  return h('svg', {
    viewBox: '0 0 16 16', width: edge, height: edge, className,
    fill: 'none', stroke: 'currentColor', strokeWidth: 1.25,
    strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
  },
  h('path', { d: 'M3.5 2.25h5.75L12.5 5.5v8.25h-9z' }),
  h('path', { d: 'M9.25 2.25V5.5h3.25' }),
  h('path', { d: 'M6 8h4' }),
  h('path', { d: 'M8 6v4' }),
  h('path', { d: 'M6 11.5h4' }));
}

/** Pull-request row glyph. */
export function PullIcon() {
  return h('svg', { width: '13', height: '13', viewBox: '0 0 16 16', fill: 'currentColor', 'aria-hidden': 'true' },
    h('path', { d: 'M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z' }));
}

/** Issue row glyph. */
export function IssueIcon() {
  return h('svg', { width: '13', height: '13', viewBox: '0 0 16 16', fill: 'currentColor', 'aria-hidden': 'true' },
    h('path', { d: 'M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z' }),
    h('path', { d: 'M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z' }));
}
