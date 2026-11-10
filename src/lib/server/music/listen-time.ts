import { eq, sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type * as schema from '#lib/server/db/schema.ts';
import { listenTime, track } from '#lib/server/db/schema.ts';
import { SLOT_MINUTES } from '#lib/kid-time.ts';
import { STATIONS } from 'comun/radio.ts';
import type { QueueSave } from 'comun/music.ts';
import { WatchSteps } from 'comun/watch-steps.ts';

/**
 * Time listened to in this app's player (#421), from the queue it saves every 15 s while it plays
 * (/api/music/queue): what the position of the song or the station moved forward since the last
 * save of the same browser, as `watch_time` does with video. Podcasts are counted in Seilide,
 * where they are. The last moments of each song, after its last save, are not counted: a few
 * seconds less, never more.
 */
type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** The last position saved of each person, thing and browser; in memory, a restart loses one step. */
const steps = new WatchSteps();

/** What sounds in it now: the station, or the song it is on; nothing for a podcast. */
function playing(queue: QueueSave) {
	if (queue.podcast !== null) return null;
	if (queue.radio) {
		const station = STATIONS.find((s) => s.uuid === queue.radio);
		return station ? { item: `r${station.uuid}`, station, trackId: null } : null;
	}
	const trackId = queue.trackIds[queue.index];
	return trackId === undefined ? null : { item: `t${trackId}`, station: null, trackId };
}

/** The day and slot of a time, in the server's time zone (TZ), as watch-time.ts. */
function slotOf(date: Date) {
	const minute = date.getHours() * 60 + date.getMinutes();
	const day = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
		.toISOString()
		.slice(0, 10);
	return { day, minute: minute - (minute % SLOT_MINUTES) };
}

/**
 * A save of `userId`'s queue from `source` (the browser's session). Only for who keeps what they
 * watch (`keeps`): children always, adults with «Guardar lo que veo».
 */
export async function addListenTime(
	db: Db,
	userId: string,
	queue: QueueSave,
	source: string,
	keeps: boolean,
	now = new Date()
) {
	const what = playing(queue);
	if (!what) return;
	const step = steps.step(`${userId}:${what.item}:${source}`, queue.positionSec, now.getTime());
	if (!step || !keeps) return;
	let named: { kind: 'cancion' | 'radio'; artist: string | null; title: string };
	if (what.station) named = { kind: 'radio', artist: null, title: what.station.name };
	else {
		const [song] = await db
			.select({
				title: sql<string>`coalesce(${track.customTitle}, ${track.title})`,
				artist: sql<string | null>`coalesce(${track.artist}, ${track.albumArtist})`
			})
			.from(track)
			.where(eq(track.id, what.trackId));
		if (!song) return;
		named = { kind: 'cancion', ...song };
	}
	await db
		.insert(listenTime)
		.values({ userId, ...slotOf(now), item: what.item, ...named, seconds: step })
		.onConflictDoUpdate({
			target: [listenTime.userId, listenTime.day, listenTime.minute, listenTime.item],
			set: {
				artist: sql`excluded.artist`,
				title: sql`excluded.title`,
				seconds: sql`${listenTime.seconds} + excluded.seconds`
			}
		});
}
