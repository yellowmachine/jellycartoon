import { addDays, mondayOf } from 'comun/agenda.ts';
import { owntracks } from '#lib/server/owntracks/owntracks.ts';
import { firstKeptDay } from '#lib/server/owntracks/retention.ts';
import { dayStart } from '#lib/server/plugs/stats.ts';
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

/**
 * The same between two days (both included), however old: of those whose positions are forgotten
 * (OwnTracks', after 90 days), what was left of each, as one.
 */
export async function onFootBetween(k: Kitchen, userId: string, from: string, to: string) {
	const start = dayStart(from);
	const end = dayStart(addDays(to, 1));
	const kept = firstKeptDay();
	const [walks, weights, old] = await Promise.all([
		walksSince(k, start),
		weight.list(userId),
		from < kept ? owntracks.summariesBetween(userId, from, to) : []
	]);
	const outings = await owntracksOutings(userId, start, end, walks).catch((error) => {
		console.warn('[paseos] Sin OwnTracks', String(error));
		return [];
	});
	const forgotten = new Set(old.map((d) => d.day));
	const row = (day: string, distance: number, seconds: number, outings = 1) => ({
		day,
		distance,
		seconds,
		outings,
		kcal: walkKcal(distance, seconds, weightOn(weights, day))
	});
	const timed = (w: { startedAt: Date; endedAt: Date; distance: number }) =>
		row(dayOf(w.startedAt), w.distance, (w.endedAt.getTime() - w.startedAt.getTime()) / 1000);
	return [
		...walks.filter((w) => w.startedAt < end).map(timed),
		...outings.map(timed).filter((o) => !forgotten.has(o.day)),
		...old.filter((d) => d.outings).map((d) => row(d.day, d.distance, d.seconds, d.outings))
	];
}
