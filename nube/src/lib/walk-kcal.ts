/**
 * The kcal of going on foot: net (what it takes over staying still) and on the flat, by its km and
 * the person's weight. An average of people, a guide: heights are not counted.
 * Near what the ACSM equations give for walking and running, without their resting part.
 */

/** Net kcal by kg and km: walking, and running. */
export const WALK_KCAL = 0.5;
export const RUN_KCAL = 1;
/** km/h: from here, running; over the other, not on foot (a bicycle recorded as a walk). */
const RUNS_FROM = 7.5;
const FASTEST = 20;

/** A weight as it is written, in kg: from 25 to 300, with a decimal; null if it is not one. */
export function weightFromText(text: string) {
	const said = text
		.trim()
		.replace(/\s*kg$/i, '')
		.replace(',', '.');
	if (!/^\d{2,3}(\.\d)?$/.test(said)) return null;
	const kg = Number(said);
	return kg >= 25 && kg <= 300 ? kg : null;
}

export interface Weight {
	/** `YYYY-MM-DD`. */
	day: string;
	kg: number;
}

/** What they weighed that day, as last noted by then; before the first, the first. */
export function weightOn(weights: Weight[], day: string): number | null {
	const sorted = [...weights].sort((a, b) => a.day.localeCompare(b.day));
	return (sorted.findLast((w) => w.day <= day) ?? sorted[0])?.kg ?? null;
}

/** Null without a weight, a time, or if it was not on foot. */
export function walkKcal(metres: number, seconds: number, kg: number | null) {
	if (kg === null || seconds <= 0) return null;
	const km = metres / 1000;
	const kmh = km / (seconds / 3600);
	if (kmh > FASTEST) return null;
	return km * kg * (kmh >= RUNS_FROM ? RUN_KCAL : WALK_KCAL);
}

/** «≈ 195 kcal», to the nearest 5: it is not more exact than that. */
export const kcalText = (kcal: number) =>
	`≈\u00a0${(Math.round(kcal / 5) * 5).toLocaleString('es-ES')}\u00a0kcal`;

/** Those known, added up; null, none. */
export const addKcal = (list: (number | null)[]) =>
	list.reduce<number | null>((sum, k) => (k === null ? sum : (sum ?? 0) + k), null);

export interface FootWeek {
	/** Its Monday. */
	week: string;
	km: number;
	kcal: number | null;
}

/** Each of those weeks' km and kcal; `day`, each outing's. */
export const footWeeks = (
	weeks: string[],
	outings: { week: string; distance: number; kcal: number | null }[]
): FootWeek[] =>
	weeks.map((week) => {
		const those = outings.filter((o) => o.week === week);
		return {
			week,
			km: those.reduce((sum, o) => sum + o.distance, 0) / 1000,
			kcal: addKcal(those.map((o) => o.kcal))
		};
	});
