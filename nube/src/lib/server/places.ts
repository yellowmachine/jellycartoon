import { findPlaces, type Place } from 'comun/weather.ts';
import { orsKey } from '#lib/server/family-settings.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { orsFor } from '#lib/server/road/ors.ts';

/**
 * A town or city by its name, for the weather: «Dónde vivís» (Ajustes) and the voice's. With the
 * family's openrouteservice key, its search, which understands the whole phrase («velez rubio
 * almeria», as the road mode); without it, or if it fails or finds nothing, Open-Meteo's, which
 * takes only the name. Either way, its point: the weather is always Open-Meteo's.
 */
export async function findPlacesFor(k: Kitchen, name: string, count = 5): Promise<Place[]> {
	if (await orsKey(k)) {
		const found = await orsFor(k)
			.searchTowns(name, count)
			.catch((error) => {
				console.warn(`[tiempo] openrouteservice no buscó «${name}»: se busca en Open-Meteo`, error);
				return [];
			});
		if (found.length) return found;
	}
	return findPlaces(name, count);
}
