import { stat } from 'node:fs/promises';
import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '#lib/server/db/index.ts';
import { track } from '#lib/server/db/schema.ts';
import { fileResponse } from '#lib/server/file-response.ts';
import { musicFile, musicRoot, opusFile } from '#lib/server/library/paths.ts';

/**
 * The FLAC as is: every current browser plays it, and on the home network it needs no converting.
 * With `?format=opus`, its Opus copy (#64), for mobile data; the FLAC while it is not made yet.
 */
export const GET: RequestHandler = async ({ params, request, url }) => {
	if (!musicRoot) error(404, 'No hay carpeta de música (MUSIC_DIR)');
	const id = Number(params.id);
	const [t] = await db
		.select({ path: track.path, opus: track.opus })
		.from(track)
		.where(and(eq(track.id, id), eq(track.status, 'ready')));
	if (!t) error(404, 'Canción no encontrada');
	if (url.searchParams.get('format') === 'opus' && t.opus === 'ready') {
		const file = opusFile(id);
		// DATA_DIR emptied by hand: the FLAC, rather than a song that does not play.
		if (await stat(file).catch(() => null))
			return fileResponse(request, file, 'audio/ogg', 'private, max-age=86400');
	}
	return fileResponse(request, musicFile(t.path), 'audio/flac', 'private, max-age=86400');
};
