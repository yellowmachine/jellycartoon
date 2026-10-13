import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { and, eq, notInArray } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { track } from '#lib/server/db/schema.ts';
import { musicRoot } from '#lib/server/library/paths.ts';
import { log } from '#lib/server/log.ts';
import { wakeMusicCatalog } from './catalog.ts';
import { musicProgress } from './status.ts';
import { isDownload } from './tags.ts';

/** Modified less than a minute ago: probably still being copied. */
const SETTLE_MS = 60_000;

export interface MusicScanResult {
	added: number;
	changed: number;
	missing: number;
	waiting: number;
}

/** FLAC files only, and not downloads: CD rips are FLAC, downloads keep the video id. */
async function walk(dir: string, files: string[]) {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		if (entry.name.startsWith('.')) continue;
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) await walk(full, files);
		else if (path.extname(entry.name).toLowerCase() === '.flac' && !isDownload(entry.name)) {
			files.push(path.relative(musicRoot!, full));
			musicProgress.found = files.length;
		}
	}
}

let scanning: Promise<MusicScanResult> | null = null;

/** Scans MUSIC_DIR; the tags are read afterwards, in the background. Concurrent calls share it. */
export function scanMusic() {
	scanning ??= runScan()
		.then((result) => {
			Object.assign(musicProgress, { lastScan: { at: Date.now(), ...result }, lastError: null });
			return result;
		})
		.catch((error) => {
			musicProgress.lastError = error instanceof Error ? error.message : String(error);
			log.error('música', 'No se pudo escanear la carpeta de música', { error });
			throw error;
		})
		.finally(() => {
			scanning = null;
			if (musicProgress.phase === 'scanning') musicProgress.phase = 'idle';
		});
	return scanning;
}

async function runScan(): Promise<MusicScanResult> {
	const result: MusicScanResult = { added: 0, changed: 0, missing: 0, waiting: 0 };
	Object.assign(musicProgress, { phase: 'scanning', found: 0 });
	const files: string[] = [];
	await walk(musicRoot!, files);

	const known = new Map(
		(
			await db
				.select({ id: track.id, path: track.path, size: track.size, mtime: track.mtime })
				.from(track)
		).map((t) => [t.path, t])
	);
	const seen: string[] = [];

	for (const file of files) {
		const info = await stat(path.join(musicRoot!, file));
		const existing = known.get(file);
		if (!existing && Date.now() - info.mtime.getTime() < SETTLE_MS) {
			result.waiting++;
			continue;
		}
		seen.push(file);
		const fileFields = { size: info.size, mtime: info.mtime, missing: false };
		if (!existing) {
			await db.insert(track).values({ path: file, title: path.parse(file).name, ...fileFields });
			result.added++;
		} else if (existing.size !== info.size || existing.mtime.getTime() !== info.mtime.getTime()) {
			// Retagged or replaced: its tags are read again.
			await db
				.update(track)
				.set({ ...fileFields, status: 'pending', error: null })
				.where(eq(track.id, existing.id));
			result.changed++;
		} else {
			await db.update(track).set({ missing: false }).where(eq(track.id, existing.id));
		}
	}

	const gone = await db
		.update(track)
		.set({ missing: true })
		.where(and(eq(track.missing, false), seen.length ? notInArray(track.path, seen) : undefined))
		.returning({ id: track.id });
	result.missing = gone.length;

	log.info(
		'música',
		`Escaneo de música: ${result.added} nuevas, ${result.changed} cambiadas, ${result.missing} desaparecidas, ${result.waiting} copiándose`,
		{ ...result }
	);
	void wakeMusicCatalog();
	return result;
}
