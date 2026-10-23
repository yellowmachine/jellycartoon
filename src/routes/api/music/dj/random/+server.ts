import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { musicRoot } from '#lib/server/library/paths.ts';
import { DJ_BATCH, djEnabled, randomTracks } from '#lib/server/music/dj.ts';

const isStrings = (value: unknown): value is string[] =>
	Array.isArray(value) && value.length <= 500 && value.every((v) => typeof v === 'string');
const isIds = (value: unknown): value is number[] =>
	Array.isArray(value) && value.length <= 5000 && value.every((v) => Number.isInteger(v));

/** Modo DJ in the browser: more songs at random, of those artists, not the ones already queued. */
export const POST: RequestHandler = async ({ request }) => {
	if (!musicRoot || !djEnabled) error(404, 'No hay modo DJ');
	const { artists, exclude } = await request.json();
	if (!isStrings(artists) || !isIds(exclude)) error(400, 'Petición no válida');
	return json(await randomTracks(artists, DJ_BATCH, exclude));
};
