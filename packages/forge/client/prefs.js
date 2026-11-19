/**
 * The `bw-forge` row's own surface preferences.
 *
 * The row's Loader switch is the outer on/off; these two module-level switches
 * only hide surfaces inside the row, and they live in localStorage so flipping
 * one survives a reload. Registered live by the bundle entry.
 */
import { createPrefs } from '@ds-hu/dsh-bw-core/client/prefs.js';

/** Module-level surfaces of `bw-forge`: the composer GitHub control and the
 * right-sidebar page. */
export const surfacePrefs = createPrefs('dsh-bw:forge:surfaces:v1', {
  composer: true,
  sidebar: true,
});
