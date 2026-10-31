import { dayName } from 'comun/agenda.ts';
import type { HourWeather } from 'comun/weather.ts';
import {
	arrivalOf,
	tripOver,
	warningText,
	whenText,
	type LegWeather,
	type PlannedLeg,
	type PlannedTrip
} from '#lib/planned-trips.ts';

/**
 * The trips to come as the voice is told them (#347), without the database: voice.ts reads them.
 */

/** As many as are worth saying: the next ones. */
const MAX_TRIPS = 3;

const durationText = (seconds: number) => {
	const minutes = Math.round(seconds / 60);
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
};

const skyText = (w: HourWeather | null) =>
	w
		? `${Math.round(w.temperature)} °C, ${w.sky}${w.rain >= 30 ? `, ${w.rain} % de lluvia` : ''}`
		: null;

function legText(leg: PlannedLeg, weather: LegWeather | undefined, today: string) {
	const arrival = arrivalOf(leg);
	const parts = [
		`${dayName(leg.day, true)} (${whenText(leg.day, today)}) a las ${leg.time}: ${leg.from} → ${leg.to}`,
		`${durationText(leg.duration)}, ${Math.round(leg.distance / 1000)} km, llega${arrival.day > leg.day ? ` el ${dayName(arrival.day)}` : ''} hacia las ${arrival.time}`
	];
	const depart = skyText(weather?.depart ?? null);
	const arrive = skyText(weather?.arrive ?? null);
	if (depart) parts.push(`al salir ${depart}`);
	if (arrive) parts.push(`al llegar ${arrive}`);
	if (weather?.way?.length) parts.push(`en el camino: ${weather.way.map(warningText).join('; ')}`);
	else if (weather?.way) parts.push('sin avisos en el camino');
	return parts.join('; ');
}

/** The trips to come, as said: those of `trips` not over, the next `MAX_TRIPS`. */
export function tripsText(
	trips: PlannedTrip[],
	weather: Record<number, LegWeather>,
	people: { id: number | string; name: string }[],
	today: string
) {
	const coming = upcoming(trips, today);
	if (!coming.length) return 'No hay viajes planeados (Viajes → Próximos).';
	const name = (id: string) => people.find((p) => String(p.id) === id)?.name ?? null;
	return coming
		.map((t) => {
			const who = t.people.map(name).filter(Boolean);
			const legs = t.legs
				.filter((l) => arrivalOf(l).day >= today)
				.map((l) => `- ${legText(l, weather[l.id], today)}`);
			return `«${t.name}»${t.private ? ' (solo de quien habla)' : ''}, ${who.length ? `van ${who.join(', ')}` : 'de toda la familia'}:\n${legs.join('\n')}`;
		})
		.join('\n');
}

export const upcoming = (trips: PlannedTrip[], today: string) =>
	trips.filter((t) => t.legs.length && !tripOver(t, today)).slice(0, MAX_TRIPS);
