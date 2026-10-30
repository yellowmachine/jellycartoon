import { addDays, dayEvents, localDay, type Occurrence } from 'comun/agenda.ts';
import { ringsToday } from 'comun/alarms.ts';
import { placeName, weatherGlance, type WeatherGlance } from 'comun/weather.ts';
import { agendaBetween, familyPeople, personOf } from './agenda/agenda.ts';
import { listAlarms } from './alarms/alarms.ts';
import { familyPlace, openRouterKey } from './family-settings.ts';
import { fridgeState, type Kitchen } from './fridge.ts';
import { pendingDosesOf } from './medication.ts';

/**
 * Seilide's home page with a session: what there is today in the family at a glance, on the phone.
 * Today's doses still to take (#308), theirs and their children's; the fridge (its post-its and the
 * list, with today's agenda), tomorrow's, the alarms and timers that ring today, the weather where they live (if said), and the first steps of a new family.
 */

/** Open-Meteo's, kept a while for each place: the home page is opened often. */
const WEATHER_MS = 20 * 60_000;
const weathers = new Map<string, { at: number; glance: Promise<WeatherGlance | null> }>();

function weatherAt(lat: number, lon: number) {
	const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
	const kept = weathers.get(key);
	if (kept && Date.now() - kept.at < WEATHER_MS) return kept.glance;
	const glance = weatherGlance(lat, lon).catch((error) => {
		console.warn('[portada] Sin el tiempo', String(error));
		weathers.delete(key);
		return null;
	});
	weathers.set(key, { at: Date.now(), glance });
	return glance;
}

/** The weather where the family lives; null without «Dónde vivís» or if Open-Meteo fails. */
export async function homeWeather(k: Kitchen) {
	const place = await familyPlace(k);
	if (!place) return null;
	const glance = await weatherAt(place.lat, place.lon);
	return glance && { ...glance, place: place.name || placeName(place) };
}

export async function homeOf(k: Kitchen, userId: string, admin: boolean) {
	const tomorrow = addDays(localDay(), 1);
	const me = await personOf(k, userId);
	const [doses, fridge, later, alarms, key, people] = await Promise.all([
		pendingDosesOf(k, userId),
		fridgeState(k),
		agendaBetween(k, tomorrow, tomorrow),
		listAlarms(k, me),
		admin ? openRouterKey(k) : null,
		admin ? familyPeople(k) : []
	]);
	return {
		/** Their person: their own doses go without their name. */
		me,
		doses,
		fridge,
		tomorrow: dayEvents(later.occurrences, tomorrow) as Occurrence[],
		alarms: alarms.filter((a) => ringsToday(a)),
		/** What a new family has yet to do that the server knows: only its administrator does them. */
		steps: admin ? { key: Boolean(key), invited: people.filter((p) => p.account).length > 1 } : null
	};
}
