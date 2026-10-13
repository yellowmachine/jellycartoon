import { error, json } from '@sveltejs/kit';
import { and, eq, inArray } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '#lib/server/db/index.ts';
import { track } from '#lib/server/db/schema.ts';
import { musicFile } from '#lib/server/library/paths.ts';
import { getAlbums } from '#lib/server/music/albums.ts';
import { controlSnapcast, queueOnSnapcast, snapcastEnabled } from '#lib/server/music/snapcast.ts';
import type { MusicTrack, SnapcastAction } from '#lib/music.ts';

const isIds = (value: unknown): value is number[] =>
	Array.isArray(value) && value.length > 0 && value.every((v) => Number.isInteger(v));

/** Only well-formed commands reach mpv. */
function parse(body: Record<string, unknown>): SnapcastAction | null {
	const { action, value, trackIds, start } = body;
	switch (action) {
		case 'play':
			return isIds(trackIds) && Number.isInteger(start)
				? { action, trackIds, start: start as number }
				: null;
		case 'append':
			return isIds(trackIds) ? { action, trackIds } : null;
		case 'pause':
			return typeof value === 'boolean' ? { action, value } : null;
		case 'seekTo':
			return typeof value === 'number' && Number.isFinite(value) ? { action, value } : null;
		case 'next':
		case 'previous':
		case 'stop':
			return { action };
		default:
			return null;
	}
}

/** The tracks, in the order asked, with their files: paths come from the catalogue, never the page. */
async function resolve(ids: number[]) {
	const rows = await db
		.select({ id: track.id, path: track.path, albumId: track.albumId })
		.from(track)
		.where(and(inArray(track.id, ids), eq(track.status, 'ready'), eq(track.missing, false)));
	const albumIds = [...new Set(rows.map((r) => r.albumId!))];
	const tracks = new Map<number, MusicTrack>();
	for (const id of albumIds)
		for (const a of await getAlbums(id)) for (const t of a.tracks) tracks.set(t.id, t);
	const paths = new Map(rows.map((r) => [r.id, musicFile(r.path)]));
	return ids.flatMap((id) => {
		const t = tracks.get(id);
		const path = paths.get(id);
		return t && path ? [{ track: t, path }] : [];
	});
}

/** A button of the music on Snapcast. */
export const POST: RequestHandler = async ({ request }) => {
	if (!snapcastEnabled) error(404, 'No hay Snapcast configurado (MUSIC_MPV_SOCKET)');
	const remote = parse(await request.json());
	if (!remote) error(400, 'Orden no válida');
	try {
		if (remote.action === 'play' || remote.action === 'append') {
			const tracks = await resolve(remote.trackIds);
			if (!tracks.length) error(400, 'No hay canciones que poner');
			await queueOnSnapcast(tracks, {
				replace: remote.action === 'play',
				start: remote.action === 'play' ? remote.start : undefined
			});
		} else {
			await controlSnapcast(remote);
		}
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		error(503, err instanceof Error ? err.message : String(err));
	}
	return json({ ok: true });
};
