import { localDay } from 'comun/agenda.ts';
import { familyPeople } from '#lib/server/agenda/agenda.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { listPlannedTrips, tripsWeather } from './planned.ts';
import { tripsText, upcoming } from './voice-text.ts';

/**
 * «¿Tengo algún viaje?», «¿a qué hora salimos mañana?» (#347): the trips still to come (Viajes →
 * Próximos), as the voice tells them. Who speaks sees the family's and their own private ones; a
 * satellite (no one known), only the family's. Each leg with its day, time, way and weather.
 */

export async function plannedTripsByVoice(k: Kitchen, now = new Date()) {
	const today = localDay(now);
	const trips = upcoming(await listPlannedTrips(k), today);
	if (!trips.length) return tripsText([], {}, [], today);
	const [weather, people] = await Promise.all([tripsWeather(k, trips), familyPeople(k)]);
	return tripsText(trips, weather, people, today);
}
