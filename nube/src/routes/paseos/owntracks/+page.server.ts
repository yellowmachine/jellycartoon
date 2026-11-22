import type { PageServerLoad } from './$types';
import { dayStart } from '#lib/server/plugs/stats.ts';
import { owntracks } from '#lib/server/owntracks/owntracks.ts';
import { KEEP_DAYS } from '#lib/owntracks.ts';
import type { StoredPoint } from '#lib/trips.ts';
import { walkingOutings } from '#lib/owntracks-walking.ts';
import { kitchenOf, today } from '#lib/server/fridge.ts';
import { listWalks } from '#lib/server/walks/walks.ts';

const isDay = (v: string | null): v is string =>
	!!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/** The local day after or before one: «2026-11-22» → «2026-11-23». */
const shift = (day: string, by: number) => {
	const d = new Date(`${day}T12:00:00Z`);
	d.setUTCDate(d.getUTCDate() + by);
	return d.toISOString().slice(0, 10);
};

/**
 * Paseos → OwnTracks (#593): whether it is connected, and a day's way as it came (`?dia=`, today
 * by default), on the map. With its outings walking and their km (phase 2).
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const userId = locals.user!.id;
	const now = today();
	const asked = url.searchParams.get('dia');
	const oldest = shift(now, -KEEP_DAYS);
	const day = isDay(asked) && asked <= now && asked >= oldest ? asked : now;
	const from = dayStart(day);
	const to = dayStart(shift(day, 1));
	const [status, points, walks] = await Promise.all([
		owntracks.status(userId),
		owntracks.between(userId, from, to),
		kitchenOf(userId).then((k) => listWalks(k))
	]);
	// The app's walks that day: theirs what they overlap (phase 2), said apart.
	const appWalks = walks.filter((w) => w.startedAt < to && w.endedAt > from);
	const outings = walkingOutings(points, appWalks);
	const line: StoredPoint[] = points.map((p) => [p.lon, p.lat, Math.round(p.at.getTime() / 1000)]);
	return {
		status,
		day,
		today: now,
		before: day > oldest ? shift(day, -1) : null,
		after: day < now ? shift(day, 1) : null,
		line,
		first: points[0]?.at ?? null,
		last: points.at(-1)?.at ?? null,
		outings,
		appWalks: appWalks.map(({ id, startedAt, distance }) => ({ id, startedAt, distance }))
	};
};
