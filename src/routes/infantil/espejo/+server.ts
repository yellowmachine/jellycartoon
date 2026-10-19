import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '#lib/server/db/index.ts';
import { movie } from '#lib/server/db/schema.ts';
import { mirrorStream, probe } from '#lib/server/library/ffmpeg.ts';
import { segmentsFrom } from '#lib/server/library/hls-seek.ts';
import { cinemaRoot, hlsDir, movieFile } from '#lib/server/library/paths.ts';

/**
 * The small, silent copy of what a child watches, for /infantil's «Ahora» (#75): `?episode=` or
 * `?movie=`, from second `t`. Adults only, as the rest of /infantil (see kids.ts).
 */
export const GET: RequestHandler = async ({ url, request }) => {
	const atSec = Math.max(0, Number(url.searchParams.get('t')) || 0);
	const episodeId = Number(url.searchParams.get('episode'));
	const movieId = Number(url.searchParams.get('movie'));

	let input: string;
	let info = null;
	let seek = {};
	if (Number.isInteger(episodeId) && episodeId > 0) {
		// Its converted video alone, already H.264: from the segment with that second.
		const dir = path.join(hlsDir(episodeId), 'video');
		const playlist = await readFile(path.join(dir, 'index.m3u8'), 'utf8').catch(() => null);
		const from = playlist && segmentsFrom(playlist, atSec);
		if (!from) error(404, 'No está convertido');
		input = `concat:${[from.map, ...from.segments].map((f) => path.join(dir, f)).join('|')}`;
		seek = { skipSec: from.offsetSec };
	} else if (Number.isInteger(movieId) && movieId > 0 && cinemaRoot) {
		const [film] = await db.select({ path: movie.path }).from(movie).where(eq(movie.id, movieId));
		if (!film) error(404, 'Película no encontrada');
		input = movieFile(film.path);
		// HDR or a DVD's non-square pixels: as its frames are made.
		info = await probe(input, request.signal, false).catch(() => null);
		if (!info) error(404, 'No se puede abrir la película');
		seek = { seekSec: atSec };
	} else {
		error(400, 'Falta qué');
	}

	return new Response(mirrorStream(input, info, seek, request.signal), {
		headers: { 'content-type': 'video/mp4', 'cache-control': 'no-store' }
	});
};
