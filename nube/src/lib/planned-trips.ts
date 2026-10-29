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

/** A leg's weather where it leaves when it leaves, and where it arrives when it arrives. */
export interface LegWeather {
	depart: HourWeather | null;
	arrive: HourWeather | null;
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
