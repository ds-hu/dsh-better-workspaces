/**
 * The diff page's own identity + registration.
 *
 * The page (tab type, body slot, chip title, guide entry) is registered through
 * `registerSidebarPage`, the same helper the two 0.4.0 pages use; the legacy
 * ids/order/glyph are unchanged.
 */
import { h, react } from '@ds-hu/dsh-bw-core/client/react.js';
import { registerSidebarPage } from '@ds-hu/dsh-bw-core/client/sidebar-page.js';
import { DiffGlyph } from '@ds-hu/dsh-bw-core/client/icons.js';
import { t } from '@ds-hu/dsh-bw-core/client/i18n.js';
import { DiffView } from './view.js';

/**
 * This page type's identity in the tab system, and the key its body and chip
 * title register under in `sidebar.right.pane.tab` /
 * `sidebar.right.pane.tab.title`.
 */
export const SIDEBAR_DIFF_ID = 'dsh-better-workspaces/diff';
/** Type discriminator; `ctx.sidebarRight.openTab` names it. */
export const SIDEBAR_DIFF_KIND = 'bw-diff';

/**
 * The diff page's registry definition: a page type (no resource address),
 * offered the same way the official files panel offers itself.
 *
 * The `guide` entry is what puts a 代码变更 capsule beside the official
 * 工作区文件 one on the sidebar's 开始 page; the composer pill stays the
 * one-click door (ADR 0006 Amendment 1).
 */
export function sidebarDiffDefinition() {
  return {
    id: SIDEBAR_DIFF_ID,
    kind: SIDEBAR_DIFF_KIND,
    priority: 'extension',
    title: () => t('view.diff'),
    guide: [{
      // Required by `SidebarRightGuideEntry`: the entry's stable identity.
      id: 'diff',
      order: 20,
      title: () => t('guide.title'),
      description: () => t('guide.description'),
      icon: DiffGlyph,
    }],
    Body: SidebarDiffBody,
    Title: SidebarDiffTitle,
  };
}

/** The diff page's body: the shared DiffView, aware of whether its tab is showing. */
export function SidebarDiffBody(props) {
  const info = props.useTabInfo();
  return h('div', { className: 'dsh-bw-sb' },
    h(DiffView, { key: props.sessionId, sessionId: props.sessionId, visible: info.tab.visible }));
}

/** The diff chip: the glyph before the tab's captured title. */
export function SidebarDiffTitle({ useTabInfo }) {
  const { tab } = useTabInfo();
  return h(react.Fragment, null,
    h(DiffGlyph, { size: 16, className: 'dsh-bw-tabicon' }),
    tab.title);
}

/**
 * Register the 代码变更 page.
 * @param ctx - the bundle's root context.
 * @returns a disposer releasing every registration.
 */
export function registerDiffPage(ctx) {
  return registerSidebarPage(ctx, sidebarDiffDefinition());
}
