import type { PageServerLoad } from './$types';
import { addDays } from 'comun/agenda.ts';
import { dayStart } from '#lib/server/plugs/stats.ts';
import { owntracks } from '#lib/server/owntracks/owntracks.ts';
import { firstKeptDay } from '#lib/server/owntracks/retention.ts';
import type { StoredPoint } from '#lib/trips.ts';
import { dayStretches, stretchAt, whereAt } from '#lib/owntracks-day.ts';
import { walkingOutings } from '#lib/owntracks-walking.ts';
import { weight } from '#lib/server/walks/weight.ts';
import { addKcal, walkKcal, weightOn } from '#lib/walk-kcal.ts';
import { dayOf, kitchenOf, today } from '#lib/server/fridge.ts';
import { notesBetween } from '#lib/server/notes.ts';
import { listWalks, walkPhotosBetween } from '#lib/server/walks/walks.ts';

const isDay = (v: string | null): v is string =>
	!!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/**
 * Paseos → OwnTracks (#593): whether it is connected, and a day's way as it came (`?dia=`, today
 * by default), on the map, with its outings walking and their km (phase 2) and its arrivals at
 * and leavings of their places (phase 4), in stretches walking or by vehicle, with the notes and
 * photos of the day (#613). A day over 90 days
 * old, only what was left of it (phase 3).
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const userId = locals.user!.id;
	const now = today();
	const firstKept = firstKeptDay(now);
	const asked = url.searchParams.get('dia');
	const oldest = (await owntracks.firstDay(userId, dayOf)) ?? now;
	const day = isDay(asked) && asked <= now && asked >= oldest ? asked : now;
	const from = dayStart(day);
	const to = dayStart(addDays(day, 1));
	const k = await kitchenOf(userId);
	const [status, points, walks, summary, arrivals, notes, photos, weights] = await Promise.all([
		owntracks.status(userId),
		owntracks.between(userId, from, to),
		listWalks(k, 1000),
		day < firstKept ? owntracks.summaryOf(userId, day) : null,
		owntracks.transitionsBetween(userId, from, to),
		notesBetween(k, userId, from, to),
		walkPhotosBetween(k, from, to),
		weight.list(userId)
	]);
	// The app's walks that day: theirs what they overlap (phase 2), said apart.
	const appWalks = walks.filter((w) => w.startedAt < to && w.endedAt > from);
	const outings = walkingOutings(points, appWalks);
	const kg = weightOn(weights, day);
	const stretches = dayStretches(points, outings, appWalks);
	/** What was kept that day, where it was made or, without that, where the phone was then. */
	const kept = [
		...notes.map((n) => ({
			key: `nota-${n.id}`,
			at: n.at,
			text: n.text,
			photo: n.photo,
			audio: n.hasAudio ? `/notas/${n.id}/audio` : null,
			own: n.lon !== null && n.lat !== null ? ([n.lon, n.lat] as [number, number]) : null
		})),
		...photos.map((p) => ({
			key: `foto-${p.id}`,
			at: p.at,
			text: '',
			photo: `/paseos/fotos/${p.id}`,
			audio: null,
			own: p.lon !== null && p.lat !== null ? ([p.lon, p.lat] as [number, number]) : null
		}))
	]
		.sort((a, b) => a.at.getTime() - b.at.getTime())
		.map(({ own, ...item }) => ({
			...item,
			position: own ?? whereAt(points, item.at),
			/** Where the phone was about then, not where it was made. */
			guessed: !own,
			stretch: stretchAt(stretches, item.at)
		}));
	const line: StoredPoint[] = points.map((p) => [p.lon, p.lat, Math.round(p.at.getTime() / 1000)]);
	return {
		status,
		day,
		today: now,
		before: day > oldest ? addDays(day, -1) : null,
		after: day < now ? addDays(day, 1) : null,
		line,
		first: points[0]?.at ?? null,
		last: points.at(-1)?.at ?? null,
		outings,
		/** The outings' kcal; null without their weight. */
		kcal: addKcal(
			outings.map((o) =>
				walkKcal(o.distance, (o.endedAt.getTime() - o.startedAt.getTime()) / 1000, kg)
			)
		),
		stretches,
		kept,
		appWalks: appWalks.map(({ id, startedAt, distance }) => ({ id, startedAt, distance })),
		/** Its positions forgotten: what is left. */
		summary: summary && {
			distance: summary.distance,
			seconds: summary.seconds,
			outings: summary.outings,
			points: summary.points
		},
		forgotten: day < firstKept,
		/** Arriving at and leaving their places (phase 4). */
		arrivals
	};
};
