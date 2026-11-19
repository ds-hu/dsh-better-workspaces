/**
 * The React binding every feature bundle shares.
 *
 * React is provided by the DSH client module table only — never by a global.
 * The build script keeps `react` external and the ModuleLoader factory hands
 * the module table's namespace to the bundle; this module is the one place
 * that receives it, and every surface source imports `h` (or the hooks) from
 * here. Named hook re-exports keep the legacy `h = react.createElement` style
 * (there is no JSX in this code base).
 */
import * as react from 'react';

export { react };

/** The element factory every component in this repository uses. */
export const h = react.createElement;

export const Fragment = react.Fragment;
export const useState = react.useState;
export const useEffect = react.useEffect;
export const useLayoutEffect = react.useLayoutEffect;
export const useRef = react.useRef;
export const useCallback = react.useCallback;
export const useMemo = react.useMemo;
export const useSyncExternalStore = react.useSyncExternalStore;
