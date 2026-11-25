import { mondayOf } from 'comun/agenda.ts';
import { dayOf, type Kitchen } from '#lib/server/fridge.ts';
import { owntracksOutings } from '#lib/server/owntracks/walking.ts';
import { walkKcal, weightOn } from '#lib/walk-kcal.ts';
import { walksSince } from './walks.ts';
import { weight } from './weight.ts';

/**
 * All of a person's going on foot since a moment: their walks and what OwnTracks saw, without
 * counting anything twice (#593), each with its kcal if they noted their weight.
 */
export async function onFootSince(k: Kitchen, userId: string, from: Date) {
	const [walks, weights] = await Promise.all([walksSince(k, from), weight.list(userId)]);
	const outings = await owntracksOutings(userId, from, new Date(), walks).catch((error) => {
		console.warn('[paseos] Sin OwnTracks', String(error));
		return [];
	});
	const row = (owntracks: boolean) => (w: { startedAt: Date; endedAt: Date; distance: number }) => {
		const day = dayOf(w.startedAt);
		const seconds = (w.endedAt.getTime() - w.startedAt.getTime()) / 1000;
		return {
			owntracks,
			day,
			week: mondayOf(day),
			distance: w.distance,
			seconds,
			kcal: walkKcal(w.distance, seconds, weightOn(weights, day))
		};
	};
	return { weights, list: [...walks.map(row(false)), ...outings.map(row(true))] };
}
