import { orsConfig } from '#lib/server/app-settings.ts';
import { log } from '#lib/server/log.ts';
import { createOrs } from 'comun/road/ors.ts';

/**
 * openrouteservice for the house's road mode (#78), with the key in its Ajustes
 * (comun/road/ors.ts).
 */
export const { searchPlaces, suggestPlaces, whereIs, placeName, drivingRoute, orsMessage } =
	createOrs(orsConfig, {
		info: (what, data) => log.info('rutas', what, data),
		warn: (what, data) => log.warn('rutas', what, data)
	});
