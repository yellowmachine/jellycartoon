import { fold } from './music.ts';
import type { Place } from './road.ts';

/**
 * The road mode's last destinations (#78), on this device: a family goes again and again to the
 * same places (school, the grandparents', the supermarket), so they come first as one types, or
 * before typing at all, without asking anyone. With their point, to go there at once.
 */

const KEY = 'jellycartoon:destinos';
const KEPT = 8;

/** Gone to: first, once. */
export function remember(list: Place[], place: Place): Place[] {
	return [place, ...list.filter((p) => p.label !== place.label)].slice(0, KEPT);
}

/** Those with every word typed («abu tol»), accents and case aside; typed nothing, the latest. */
export function matching(list: Place[], query: string, max = 5): Place[] {
	const words = fold(query).split(/\s+/).filter(Boolean);
	return list.filter((p) => words.every((w) => fold(p.label).includes(w))).slice(0, max);
}

export function loadRecent(): Place[] {
	try {
		const list = JSON.parse(localStorage.getItem(KEY) ?? '[]');
		return Array.isArray(list)
			? list.filter((p) => typeof p?.label === 'string' && Array.isArray(p?.at))
			: [];
	} catch {
		return [];
	}
}

export function saveRecent(list: Place[]) {
	try {
		localStorage.setItem(KEY, JSON.stringify(list));
	} catch {
		// A private window: only forgotten.
	}
}
