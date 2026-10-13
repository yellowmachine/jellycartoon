import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '#lib/server/db/index.ts';
import { track } from '#lib/server/db/schema.ts';
import { fileResponse } from '#lib/server/file-response.ts';
import { musicFile, musicRoot } from '#lib/server/library/paths.ts';

/** The FLAC as is: every current browser plays it, and on the home network it needs no converting. */
export const GET: RequestHandler = async ({ params, request }) => {
	if (!musicRoot) error(404, 'No hay carpeta de música (MUSIC_DIR)');
	const [t] = await db
		.select({ path: track.path })
		.from(track)
		.where(and(eq(track.id, Number(params.id)), eq(track.status, 'ready')));
	if (!t) error(404, 'Canción no encontrada');
	return fileResponse(request, musicFile(t.path), 'audio/flac', 'private, max-age=86400');
};
