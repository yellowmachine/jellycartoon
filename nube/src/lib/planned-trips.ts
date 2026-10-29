import type { WayWarning } from 'comun/route-weather.ts';
import type { HourWeather } from 'comun/weather.ts';
import type { LngLat } from 'comun/road.ts';

/**
 * Trips still to come (Viajes → Próximos): what the server and the pages share. A trip is the
 * family's, or only its maker's («Solo para mí»); who goes says whose home page it is on.
 */

export const MAX_TRIP_NAME = 80;
export const MAX_LEGS = 20;
/** Shown on the home page when its next leg leaves within this many days. */
export const HOME_DAYS = 14;

export interface PlannedLeg {
	id: number;
	/** `YYYY-MM-DD` and `HH:MM`, when it leaves, in the family's time. */
	day: string;
	time: string;
	/** Its stops' names, first and last: «Toledo», «Oviedo». */
	from: string;
	to: string;
	start: LngLat;
	end: LngLat;
	/** Metres and seconds. */
	distance: number;
	duration: number;
}

export interface PlannedTrip {
	id: number;
	name: string;
	private: boolean;
	/** Made by who looks: only they change a private one. */
	mine: boolean;
	/** Who goes, the family's people's ids. None: everyone's. */
	people: string[];
	legs: PlannedLeg[];
}

/** A warning on a leg's way (comun/route-weather.ts), with the town it starts near, if known. */
export type TripWarning = WayWarning & { town: string | null };

/**
 * A leg's weather where it leaves when it leaves, and where it arrives when it arrives; and along
 * its way, what to beware of (none: a good road), or null if it could not be looked at.
 */
export interface LegWeather {
	depart: HourWeather | null;
	arrive: HourWeather | null;
	way: TripWarning[] | null;
}

const HAZARDS: Record<WayWarning['hazard'], string> = {
	nieve: '❄️ Nieve',
	hielo: '🧊 Hielo',
	niebla: '🌫️ Niebla',
	lluvia: '🌧️ Lluvia fuerte',
	tormenta: '⛈️ Tormenta',
	viento: '💨 Viento'
};

/** «❄️ Nieve de 12:00 a 12:30, cerca de Pajares (1350 m), 1,5 cm/h». */
export function warningText(w: TripWarning) {
	// To five minutes: it is a guess, at an even speed.
	const clock = (ms: number) =>
		new Date(Math.round(ms / 300_000) * 300_000).toLocaleTimeString('es-ES', {
			hour: '2-digit',
			minute: '2-digit'
		});
	const when =
		w.from === w.to ? `hacia las ${clock(w.from)}` : `de ${clock(w.from)} a ${clock(w.to)}`;
	const where = w.town ? `cerca de ${w.town}` : `en el km ${w.km}`;
	const height = w.elevation >= 700 ? ` (${w.elevation.toLocaleString('es-ES')} m)` : '';
	const how =
		w.hazard === 'nieve'
			? w.snowfall
				? `, ${w.snowfall.toLocaleString('es-ES', { maximumFractionDigits: 1 })} cm/h`
				: ''
			: w.hazard === 'hielo'
				? `, ${w.temperature} °C`
				: w.hazard === 'niebla'
					? w.visibility < 1000
						? `, se ve a ${Math.round(w.visibility / 50) * 50} m`
						: ''
					: w.hazard === 'viento'
						? `, rachas de ${w.gusts} km/h`
						: `, ${w.rain} %`;
	return `${HAZARDS[w.hazard]} ${when}, ${where}${height}${how}`;
}

/** When it arrives: its day and time, driving its whole duration. */
export function arrivalOf(leg: Pick<PlannedLeg, 'day' | 'time' | 'duration'>) {
	const at = new Date(`${leg.day}T${leg.time}:00`);
	at.setSeconds(at.getSeconds() + Math.round(leg.duration));
	const pad = (n: number) => String(n).padStart(2, '0');
	return {
		day: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`,
		time: `${pad(at.getHours())}:${pad(at.getMinutes())}`
	};
}

/** Whether a trip is over: all its legs arrived before `day`. One without legs is not. */
export const tripOver = (trip: PlannedTrip, day: string) =>
	trip.legs.length > 0 && trip.legs.every((l) => arrivalOf(l).day < day);

/** «en 3 días», «mañana», «hoy». */
export function whenText(day: string, today: string) {
	const days = Math.round(
		(new Date(`${day}T12:00:00Z`).getTime() - new Date(`${today}T12:00:00Z`).getTime()) / 86_400_000
	);
	if (days <= 0) return 'hoy';
	if (days === 1) return 'mañana';
	return `en ${days} días`;
}

/** «Sábado 31»: a day's name to start a line with. */
export const upFirst = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
