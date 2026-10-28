import { stat } from 'node:fs/promises';
import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { track } from '#lib/server/db/schema.ts';
import { fileResponse } from '#lib/server/file-response.ts';
import { musicFile, musicRoot, opusFile } from '#lib/server/library/paths.ts';
import { audioType, isOpus } from './tags.ts';

/**
 * A track's file (FLAC or Opus): every current browser plays it, and on the home network it needs
 * no converting. With `opus`, a FLAC's Opus copy (#64), for mobile data; the FLAC while it is not
 * made yet. An Opus file is always itself. For the app (/api/music/track) and the cloud
 * (/api/v1/musica, #253).
 */
export async function trackFile(request: Request, id: number, { opus = false } = {}) {
	if (!musicRoot) error(404, 'No hay carpeta de música (MUSIC_DIR)');
	const [t] = await db
		.select({ path: track.path, opus: track.opus })
		.from(track)
		.where(and(eq(track.id, id), eq(track.status, 'ready'), eq(track.missing, false)));
	if (!t) error(404, 'Canción no encontrada');
	if (opus && t.opus === 'ready' && !isOpus(t.path)) {
		const file = opusFile(id);
		// DATA_DIR emptied by hand: the FLAC, rather than a song that does not play.
		if (await stat(file).catch(() => null))
			return fileResponse(request, file, 'audio/ogg', 'private, max-age=86400');
	}
	return fileResponse(request, musicFile(t.path), audioType(t.path), 'private, max-age=86400');
}
