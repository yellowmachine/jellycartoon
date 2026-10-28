import { error } from '@sveltejs/kit';
import { DJ_BATCH, djEnabled, makeClip, randomTracks } from './dj.ts';
import { tracksById } from './albums.ts';
import { musicRoot } from '#lib/server/library/paths.ts';
import { DJ_DEFAULT_VOICE, isDjVoice } from 'comun/music.ts';

/**
 * Modo DJ's two requests (#117), from this house's browsers and from the cloud's (#253, through
 * its API): checked here once for both.
 */

const isStrings = (value: unknown): value is string[] =>
	Array.isArray(value) && value.length <= 500 && value.every((v) => typeof v === 'string');
const isIds = (value: unknown): value is number[] =>
	Array.isArray(value) && value.length <= 5000 && value.every((v) => Number.isInteger(v));

/** More songs at random, of those `artists`, not the ones already queued (`exclude`). */
export async function moreSongs(body: unknown) {
	if (!musicRoot || !(await djEnabled())) error(404, 'No hay modo DJ');
	const { artists, exclude } = (body ?? {}) as { artists?: unknown; exclude?: unknown };
	if (!isStrings(artists) || !isIds(exclude)) error(400, 'Petición no válida');
	return randomTracks(artists, DJ_BATCH, exclude);
}

/**
 * What the DJ says after `played` (the songs since it last spoke), before `next`. The songs are
 * read here, by their ids: the AI is told only what the library says.
 */
export async function djWords(body: unknown) {
	if (!(await djEnabled())) error(404, 'No hay modo DJ');
	const {
		played,
		next,
		lang,
		voice = DJ_DEFAULT_VOICE
	} = (body ?? {}) as { played?: unknown; next?: unknown; lang?: unknown; voice?: unknown };
	if (
		!Array.isArray(played) ||
		!played.length ||
		played.length > 20 ||
		!played.every((id) => Number.isInteger(id)) ||
		(next !== null && !Number.isInteger(next)) ||
		(lang !== 'es' && lang !== 'en') ||
		!isDjVoice(voice)
	)
		error(400, 'Petición no válida');
	const nextId = next as number | null;
	const tracks = await tracksById(nextId === null ? played : [...played, nextId]);
	const byId = new Map(tracks.map((t) => [t.track.id, t.track]));
	const songs = played.flatMap((id: number) => byId.get(id) ?? []);
	if (!songs.length) error(400, 'Canciones no encontradas');
	try {
		return await makeClip(songs, nextId === null ? null : (byId.get(nextId) ?? null), lang, voice);
	} catch (err) {
		error(503, err instanceof Error ? err.message : String(err));
	}
}
