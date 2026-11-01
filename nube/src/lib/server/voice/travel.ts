import type { Place } from 'comun/road.ts';

/**
 * Where «¿cuánto tardo a…?» goes (`travel_time`), from what was said as a navigator would take it,
 * «El Extremeño, Sangonera la Seca, Murcia»: the first of openrouteservice's results in the town
 * said. Without its town in the label, it is somewhere else with a name alike («Calle Sangonera
 * la Verde», in Lumbreras, for «Sangonera la Seca» searched near Vélez-Rubio, 2026-11-01).
 */

const plain = (text: string) =>
	text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** «El Extremeño, Sangonera la Seca, Murcia» → what («El Extremeño») and the town after it. */
export function splitPlace(said: string): { what: string; town: string | null } {
	const [what = '', ...rest] = said.split(',').map((part) => part.trim());
	const town = rest.filter(Boolean).join(', ');
	return { what, town: town || null };
}

/** The first result in `town` (its first part, «Sangonera la Seca»), or null; any, without one. */
export function inTown(results: Place[], town: string | null): Place | null {
	if (!town) return results[0] ?? null;
	const wanted = plain(town.split(',')[0]!);
	return results.find((p) => plain(p.label).includes(wanted)) ?? null;
}
