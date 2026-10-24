import { mkdir, mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { episode, movie, series } from '#lib/server/db/schema.ts';
import { cachedProbe, inTurn } from '#lib/server/cinema/frames.ts';
import { log } from '#lib/server/log.ts';
import { backdropScore } from './backdrop-score.ts';
import { cropBlackBorders, frame, framesEvery, imageStats, probe, thumbnail } from './ffmpeg.ts';
import { dataRoot, hlsDir, movieFile } from './paths.ts';

/**
 * The image behind the top of a series' or a film's page: a frame of its own, sharp above and
 * blurred as it goes down (Backdrop.svelte). Chosen by hand («Usar de fondo»), or by the app: of a
 * few frames from the middle (neither the opening nor the credits), the one with the most colour
 * that is neither dark nor washed out. Made once, and kept in DATA_DIR/fondo.
 */

const WIDTH = 1280;
/** Frames looked at to choose one. */
const CANDIDATES = 7;
/** Between these parts of the video: past the opening, before the credits. */
const FROM = 0.15;
const TO = 0.75;

const dir = path.join(dataRoot, 'fondo');
export const backdropFile = (kind: 'serie' | 'pelicula', id: number) =>
	path.join(dir, `${kind}-${id}.jpg`);

/** The best of these image files. */
async function best(files: string[]) {
	let chosen: string | null = null;
	let top = -Infinity;
	for (const file of files) {
		const score = backdropScore(
			await imageStats(file).catch(() => ({ brightness: NaN, colour: NaN }))
		);
		if (score > top) [chosen, top] = [file, score];
	}
	return chosen;
}

/**
 * Written aside and then renamed: the page never gets half an image. Without black bars (4:3 inside
 * 16:9): behind the page, only the picture.
 */
async function keep(output: string, write: (partial: string) => Promise<void>) {
	await mkdir(dir, { recursive: true });
	const partial = output.replace(/\.jpg$/, '.part.jpg');
	const cropped = output.replace(/\.jpg$/, '.crop.jpg');
	try {
		await write(partial);
		if (await cropBlackBorders(partial, cropped).catch(() => false)) await rename(cropped, partial);
		await rename(partial, output);
	} finally {
		await rm(partial, { force: true });
		await rm(cropped, { force: true });
	}
}

/** Where candidates go while choosing: on the same disk as the result, which is renamed from it. */
async function workDir() {
	await mkdir(dir, { recursive: true });
	return mkdtemp(path.join(dir, '.elegir-'));
}

/** Making now, by file: asked twice, made once. */
const making = new Map<string, Promise<void>>();

function once(file: string, make: () => Promise<void>) {
	let job = making.get(file);
	if (!job) {
		job = make().finally(() => making.delete(file));
		making.set(file, job);
	}
	return job;
}

/** The series' background, made if it is not yet: its file, or null if it has no episode to take it from. */
export async function seriesBackdrop(seriesId: number) {
	const file = backdropFile('serie', seriesId);
	if (await stat(file).catch(() => null)) return file;
	const [row] = await db
		.select({ episodeId: series.backdropEpisodeId, atSec: series.backdropSec })
		.from(series)
		.where(eq(series.id, seriesId));
	if (!row) return null;
	// The one chosen; otherwise the first episode converted.
	const [ep] = await db
		.select({ id: episode.id, durationSec: episode.durationSec })
		.from(episode)
		.where(
			and(
				eq(episode.seriesId, seriesId),
				eq(episode.status, 'ready'),
				row.episodeId ? eq(episode.id, row.episodeId) : undefined
			)
		)
		.orderBy(asc(episode.season), asc(episode.number))
		.limit(1);
	if (!ep?.durationSec) return null;
	await once(file, () =>
		inTurn(() =>
			keep(file, async (partial) => {
				// From the converted video: the original may have been deleted (DELETE_SOURCES).
				const input = path.join(hlsDir(ep.id), 'master.m3u8');
				const info = await probe(input, undefined, false);
				if (row.episodeId && row.atSec !== null) {
					await thumbnail(input, partial, info, row.atSec, {
						fromStart: true,
						pausable: false,
						width: WIDTH
					});
					return;
				}
				// One pass over the episode's keyframes, one every so often; the best from the middle.
				const work = await workDir();
				try {
					const every = ep.durationSec! / (CANDIDATES / (TO - FROM));
					const frames = await framesEvery(input, info, work, {
						everySec: every,
						width: WIDTH,
						keyframes: true
					});
					const middle = frames.filter((_, i) => {
						const at = (i * every) / ep.durationSec!;
						return at >= FROM && at <= TO;
					});
					const chosen = await best(middle.length ? middle : frames);
					if (!chosen) throw new Error('Ningún fotograma');
					await rename(chosen, partial);
				} finally {
					await rm(work, { recursive: true, force: true });
				}
			})
		)
	);
	log.info('fondos', 'Fondo de una serie', { seriesId, episodeId: ep.id, chosen: row.atSec });
	return file;
}

/** The film's background, made if it is not yet: its file, or null if it is not ready. */
export async function filmBackdrop(movieId: number) {
	const file = backdropFile('pelicula', movieId);
	if (await stat(file).catch(() => null)) return file;
	const [film] = await db
		.select({
			path: movie.path,
			durationSec: movie.durationSec,
			status: movie.status,
			atSec: movie.backdropSec
		})
		.from(movie)
		.where(eq(movie.id, movieId));
	if (!film || film.status !== 'ready' || !film.durationSec) return null;
	await once(file, async () => {
		const input = movieFile(film.path);
		const info = await cachedProbe(movieId, input);
		const duration = film.durationSec!;
		const times =
			film.atSec !== null
				? [film.atSec]
				: Array.from(
						{ length: CANDIDATES },
						(_, i) => duration * (FROM + ((TO - FROM) * i) / (CANDIDATES - 1))
					);
		const work = await workDir();
		try {
			const frames: string[] = [];
			for (const [i, at] of times.entries()) {
				const jpeg = await inTurn(() => frame(input, info, at, WIDTH));
				const name = path.join(work, `${i}.jpg`);
				await writeFile(name, jpeg);
				frames.push(name);
			}
			const chosen = frames.length === 1 ? frames[0]! : await best(frames);
			if (!chosen) throw new Error('Ningún fotograma');
			await keep(file, (partial) => rename(chosen, partial));
		} finally {
			await rm(work, { recursive: true, force: true });
		}
	});
	log.info('fondos', 'Fondo de una película', { movieId, chosen: film.atSec });
	return file;
}

/** Chosen by hand (or back to the app's choice, `null`): made again the next time it is asked. */
export async function chooseSeriesBackdrop(
	seriesId: number,
	chosen: { episodeId: number; atSec: number } | null
) {
	await db
		.update(series)
		.set({ backdropEpisodeId: chosen?.episodeId ?? null, backdropSec: chosen?.atSec ?? null })
		.where(eq(series.id, seriesId));
	await rm(backdropFile('serie', seriesId), { force: true });
	return seriesBackdrop(seriesId);
}

export async function chooseFilmBackdrop(movieId: number, atSec: number | null) {
	await db.update(movie).set({ backdropSec: atSec }).where(eq(movie.id, movieId));
	await rm(backdropFile('pelicula', movieId), { force: true });
	return filmBackdrop(movieId);
}
