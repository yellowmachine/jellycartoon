import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { djEnabled, makeClip } from '#lib/server/music/dj.ts';
import { tracksById } from '#lib/server/music/albums.ts';

/**
 * Modo DJ in the browser: what the DJ says after `played` (the songs since it last spoke), before
 * `next`. The songs are read here, by their ids: the AI is told only what the library says.
 */
export const POST: RequestHandler = async ({ request }) => {
	if (!djEnabled) error(404, 'No hay modo DJ');
	const { played, next, lang } = await request.json();
	if (
		!Array.isArray(played) ||
		!played.length ||
		played.length > 20 ||
		!played.every((id) => Number.isInteger(id)) ||
		(next !== null && !Number.isInteger(next)) ||
		(lang !== 'es' && lang !== 'en')
	)
		error(400, 'Petición no válida');
	const tracks = await tracksById(next === null ? played : [...played, next]);
	const byId = new Map(tracks.map((t) => [t.track.id, t.track]));
	const songs = played.flatMap((id: number) => byId.get(id) ?? []);
	if (!songs.length) error(400, 'Canciones no encontradas');
	try {
		return json(await makeClip(songs, next === null ? null : (byId.get(next) ?? null), lang));
	} catch (err) {
		error(503, err instanceof Error ? err.message : String(err));
	}
};
