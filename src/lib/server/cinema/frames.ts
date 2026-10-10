import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { movie } from '#lib/server/db/schema.ts';
import { frame, probe, type Probe } from '#lib/server/library/ffmpeg.ts';
import { movieFile } from '#lib/server/library/paths.ts';

/** At most this many ffmpeg at once: the server may be playing a film at the same time. */
const PARALLEL = 3;
let active = 0;
const waiting: (() => void)[] = [];

async function inTurn<T>(work: () => Promise<T>): Promise<T> {
	if (active >= PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
	active++;
	try {
		return await work();
	} finally {
		active--;
		waiting.shift()?.();
	}
}

/** The streams of the last films looked at: the 20 frames of a view need the same probe. */
const probes = new Map<number, Promise<Probe>>();

function cachedProbe(movieId: number, file: string) {
	let cached = probes.get(movieId);
	if (!cached) {
		cached = probe(file, undefined, false);
		cached.catch(() => probes.delete(movieId));
		probes.set(movieId, cached);
		if (probes.size > 10) probes.delete(probes.keys().next().value!);
	}
	return cached;
}

/** A frame of the film at `atSec`, as a JPEG; `null` if there is no such film or moment. */
export async function movieFrame(movieId: number, atSec: number, width: number) {
	const [film] = await db
		.select({ path: movie.path, durationSec: movie.durationSec, status: movie.status })
		.from(movie)
		.where(eq(movie.id, movieId));
	if (!film || film.status !== 'ready' || !film.durationSec || atSec > film.durationSec)
		return null;
	const file = movieFile(film.path);
	return inTurn(async () => frame(file, await cachedProbe(movieId, file), atSec, width));
}
