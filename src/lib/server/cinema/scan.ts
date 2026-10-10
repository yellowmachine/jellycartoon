import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { and, eq, notInArray } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { movie } from '#lib/server/db/schema.ts';
import { VIDEO_EXTENSIONS } from '#lib/server/library/scan.ts';
import { cinemaRoot } from '#lib/server/library/paths.ts';
import { log } from '#lib/server/log.ts';
import { wakeCatalog } from './catalog.ts';
import { wakeInfo } from './info.ts';
import { parseMovieName } from './title.ts';

/** Disc structures copied as is: hundreds of pieces that are not films on their own. */
const DISC_FOLDERS = new Set(['BDMV', 'VIDEO_TS', 'CERTIFICATE', 'AACS']);

/** Modified less than a minute ago: probably still being copied. */
const SETTLE_MS = 60_000;

export interface CinemaScanResult {
	added: number;
	changed: number;
	missing: number;
	waiting: number;
	/** Folders with a disc structure (BDMV, VIDEO_TS), which are skipped. */
	discs: string[];
}

async function walk(dir: string, found: { files: string[]; discs: string[] }) {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		if (entry.name.startsWith('.')) continue;
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (DISC_FOLDERS.has(entry.name.toUpperCase())) {
				found.discs.push(path.relative(cinemaRoot!, dir));
				continue;
			}
			await walk(full, found);
		} else if (VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
			found.files.push(path.relative(cinemaRoot!, full));
		}
	}
}

/**
 * The name a film is catalogued under: its folder's when it is the only video in a folder of its
 * own (`Mickey's Christmas Carol/title_t00.mkv`), otherwise the file's.
 */
function nameFor(file: string, videosPerFolder: Map<string, number>) {
	const folder = file.split(path.sep)[0];
	const inOwnFolder = folder !== file && videosPerFolder.get(folder) === 1;
	return inOwnFolder ? folder : path.parse(file).name;
}

let scanning: Promise<CinemaScanResult> | null = null;

/** Scans CINEMA_DIR. Concurrent calls share the same run. */
export function scanCinema() {
	scanning ??= runScan().finally(() => (scanning = null));
	return scanning;
}

async function runScan(): Promise<CinemaScanResult> {
	const result: CinemaScanResult = { added: 0, changed: 0, missing: 0, waiting: 0, discs: [] };
	const found = { files: [] as string[], discs: result.discs };
	await walk(cinemaRoot!, found);

	const videosPerFolder = new Map<string, number>();
	for (const file of found.files) {
		const folder = file.split(path.sep)[0];
		videosPerFolder.set(folder, (videosPerFolder.get(folder) ?? 0) + 1);
	}

	const known = new Map(
		(
			await db
				.select({
					id: movie.id,
					path: movie.path,
					size: movie.size,
					mtime: movie.mtime,
					missing: movie.missing
				})
				.from(movie)
		).map((m) => [m.path, m])
	);
	const seen: string[] = [];

	for (const file of found.files) {
		const info = await stat(path.join(cinemaRoot!, file));
		const existing = known.get(file);
		if (!existing && Date.now() - info.mtime.getTime() < SETTLE_MS) {
			result.waiting++;
			continue;
		}
		seen.push(file);
		const { title, year } = parseMovieName(nameFor(file, videosPerFolder));
		const fileFields = { title, year, size: info.size, mtime: info.mtime, missing: false };

		if (!existing) {
			await db.insert(movie).values({ path: file, ...fileFields });
			result.added++;
		} else if (existing.size !== info.size || existing.mtime.getTime() !== info.mtime.getTime()) {
			// A different file under the same name: probe it and take its thumbnail again.
			await db
				.update(movie)
				.set({ ...fileFields, status: 'pending', error: null })
				.where(eq(movie.id, existing.id));
			result.changed++;
		} else {
			await db.update(movie).set({ title, year, missing: false }).where(eq(movie.id, existing.id));
		}
	}

	const gone = await db
		.update(movie)
		.set({ missing: true })
		.where(and(eq(movie.missing, false), seen.length ? notInArray(movie.path, seen) : undefined))
		.returning({ id: movie.id });
	result.missing = gone.length;

	log.info(
		'cine',
		`Escaneo de películas: ${result.added} nuevas, ${result.changed} cambiadas, ${result.missing} desaparecidas, ${result.waiting} copiándose`,
		{ ...result }
	);
	if (result.discs.length)
		log.warn('cine', `Carpetas de disco sin catalogar: ${result.discs.join(', ')}`, {
			discs: result.discs
		});

	// Then the info of the films without it, new or not: the runtime helps to identify them.
	void wakeCatalog().then(wakeInfo);
	return result;
}
