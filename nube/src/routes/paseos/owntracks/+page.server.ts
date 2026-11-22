import type { PageServerLoad } from './$types';
import { addDays } from 'comun/agenda.ts';
import { dayStart } from '#lib/server/plugs/stats.ts';
import { owntracks } from '#lib/server/owntracks/owntracks.ts';
import { firstKeptDay } from '#lib/server/owntracks/retention.ts';
import type { StoredPoint } from '#lib/trips.ts';
import { walkingOutings } from '#lib/owntracks-walking.ts';
import { dayOf, kitchenOf, today } from '#lib/server/fridge.ts';
import { listWalks } from '#lib/server/walks/walks.ts';

const isDay = (v: string | null): v is string =>
	!!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/**
 * Paseos → OwnTracks (#593): whether it is connected, and a day's way as it came (`?dia=`, today
 * by default), on the map, with its outings walking and their km (phase 2). A day over 90 days
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
	const [status, points, walks, summary] = await Promise.all([
		owntracks.status(userId),
		owntracks.between(userId, from, to),
		kitchenOf(userId).then((k) => listWalks(k, 1000)),
		day < firstKept ? owntracks.summaryOf(userId, day) : null
	]);
	// The app's walks that day: theirs what they overlap (phase 2), said apart.
	const appWalks = walks.filter((w) => w.startedAt < to && w.endedAt > from);
	const outings = walkingOutings(points, appWalks);
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
		appWalks: appWalks.map(({ id, startedAt, distance }) => ({ id, startedAt, distance })),
		/** Its positions forgotten: what is left. */
		summary: summary && {
			distance: summary.distance,
			seconds: summary.seconds,
			outings: summary.outings,
			points: summary.points
		},
		forgotten: day < firstKept
	};
};
