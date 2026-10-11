import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { CLIP_SECONDS } from '#lib/birds-eye.ts';
import { db } from '#lib/server/db/index.ts';
import { movie } from '#lib/server/db/schema.ts';
import { clip } from '#lib/server/library/ffmpeg.ts';
import { movieClipDir, movieFile } from '#lib/server/library/paths.ts';
import { cachedProbe, inTurn } from './frames.ts';

/** Clips kept on disk; older ones are deleted when a new one is made. */
const KEEP = 20;

/** Clips being made, so the browser's repeated requests (Range) wait for the same one. */
const making = new Map<string, Promise<string>>();

/**
 * The file of `CLIP_SECONDS` of the film from `atSec`, with the audio in `audioLang`; made the
 * first time. `null` if there is no such film or moment.
 */
export async function movieClip(movieId: number, atSec: number, audioLang: string | null) {
	const [film] = await db
		.select({ path: movie.path, durationSec: movie.durationSec, status: movie.status })
		.from(movie)
		.where(eq(movie.id, movieId));
	if (!film || film.status !== 'ready' || !film.durationSec || atSec >= film.durationSec)
		return null;

	const name = `${movieId}-${atSec}-${audioLang ?? 'auto'}.mp4`;
	const output = path.join(movieClipDir, name);
	if (await stat(output).catch(() => null)) return output;

	let pending = making.get(name);
	if (!pending) {
		pending = make(movieFile(film.path), output, movieId, atSec, audioLang);
		making.set(name, pending);
		pending.finally(() => making.delete(name)).catch(() => {});
	}
	return pending;
}

async function make(
	input: string,
	output: string,
	movieId: number,
	atSec: number,
	audioLang: string | null
) {
	await mkdir(movieClipDir, { recursive: true });
	// Written aside and then renamed, so a half-made clip is never served.
	const partial = `${output}.partial`;
	try {
		await inTurn(async () =>
			clip(input, partial, await cachedProbe(movieId, input), {
				atSec,
				seconds: CLIP_SECONDS,
				audioLang
			})
		);
		await rename(partial, output);
	} catch (err) {
		await rm(partial, { force: true });
		throw err;
	}
	await prune();
	return output;
}

/** Leaves the `KEEP` newest clips. */
async function prune() {
	const files = await Promise.all(
		(await readdir(movieClipDir))
			.filter((f) => f.endsWith('.mp4'))
			.map(async (f) => {
				const file = path.join(movieClipDir, f);
				return { file, mtime: (await stat(file)).mtimeMs };
			})
	);
	files.sort((a, b) => b.mtime - a.mtime);
	await Promise.all(files.slice(KEEP).map((f) => rm(f.file, { force: true })));
}
