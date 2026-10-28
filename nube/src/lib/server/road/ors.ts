import { createOrs, DEFAULT_ORS_URL } from 'comun/road/ors.ts';
import { orsKey } from '#lib/server/family-settings.ts';
import type { Kitchen } from '#lib/server/fridge.ts';

/**
 * openrouteservice for the family's road mode (#253; jellycartoon's #78), with its own key, in
 * Ajustes: each family, its free quota.
 */
export const orsFor = (k: Kitchen) =>
	createOrs(async () => ({ apiKey: await orsKey(k), url: DEFAULT_ORS_URL }), {
		info: (what, data) => console.info(`[rutas] ${what}`, data ?? ''),
		warn: (what, data) => console.warn(`[rutas] ${what}`, data ?? '')
	});
