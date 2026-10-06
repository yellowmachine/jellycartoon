import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { and, eq, notInArray, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { episode, series } from '#lib/server/db/schema.ts';
import { mediaRoot } from './paths.ts';
import { wakeWorker } from './worker.ts';

const VIDEO_EXTENSIONS = new Set([
	'.mkv',
	'.mp4',
	'.m4v',
	'.avi',
	'.mpg',
	'.mpeg',
	'.vob',
	'.ts',
	'.m2ts',
	'.webm',
	'.mov',
	'.ogv',
	'.wmv',
	'.flv'
]);

interface ParsedEpisode {
	season: number;
	number: number | null;
	title: string;
}

/**
 * Accepts `S01E02`, `1x02` or a `Temporada 1` / `Season 1` folder plus the first number in the
 * filename. Anything else ends up in season 1, numbered by file order.
 */
export function parseEpisode(relativeToSeries: string): ParsedEpisode {
	const name = path
		.basename(relativeToSeries, path.extname(relativeToSeries))
		// yt-dlp appends `[videoId]`, and YouTube titles look like `Episode | Show | Channel`.
		.replace(/\[[^\]]*\]/g, '')
		.split(/\s[|｜]\s/)[0];
	const dirs = path.dirname(relativeToSeries);

	const sxe = name.match(/s(\d{1,2})\s*e(\d{1,3})/i) ?? name.match(/\b(\d{1,2})x(\d{1,3})\b/i);
	if (sxe) {
		return {
			season: Number(sxe[1]),
			number: Number(sxe[2]),
			title: cleanTitle(name.slice(sxe.index! + sxe[0].length)) || `Episodio ${Number(sxe[2])}`
		};
	}

	const seasonDir = dirs.match(/(?:temporada|season|t|s)\s*(\d{1,2})/i);
	const num = name.match(/(\d{1,3})/);
	return {
		season: seasonDir ? Number(seasonDir[1]) : 1,
		number: num ? Number(num[1]) : null,
		title: cleanTitle(num ? name.slice(num.index! + num[0].length) : name) || cleanTitle(name)
	};
}

function cleanTitle(raw: string) {
	return raw
		.replace(/[._]+/g, ' ')
		.replace(/^[\s\-–:]+|[\s\-–:]+$/g, '')
		.trim();
}

async function walk(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		if (entry.name.startsWith('.')) continue;
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) files.push(...(await walk(full)));
		else if (VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(full);
	}
	return files;
}

export interface ScanResult {
	series: number;
	added: number;
	changed: number;
	missing: number;
}

let scanning: Promise<ScanResult> | null = null;

/** Scans MEDIA_DIR. Concurrent calls share the same run. */
export function scanLibrary() {
	scanning ??= runScan().finally(() => (scanning = null));
	return scanning;
}

async function runScan(): Promise<ScanResult> {
	const result: ScanResult = { series: 0, added: 0, changed: 0, missing: 0 };
	const seen: string[] = [];

	const folders = (await readdir(mediaRoot, { withFileTypes: true }))
		.filter((e) => e.isDirectory() && !e.name.startsWith('.'))
		.map((e) => e.name)
		.sort((a, b) => a.localeCompare(b));

	for (const folder of folders) {
		const files = (await walk(path.join(mediaRoot, folder))).sort((a, b) =>
			a.localeCompare(b, undefined, { numeric: true })
		);
		if (files.length === 0) continue;
		result.series++;

		const [s] = await db
			.insert(series)
			.values({ folder, title: cleanTitle(folder) })
			.onConflictDoUpdate({ target: series.folder, set: { folder } })
			.returning({ id: series.id });

		const nextNumber = new Map<number, number>();
		for (const file of files) {
			const relative = path.relative(mediaRoot, file);
			const parsed = parseEpisode(path.relative(path.join(mediaRoot, folder), file));
			const number = parsed.number ?? (nextNumber.get(parsed.season) ?? 0) + 1;
			nextNumber.set(parsed.season, Math.max(number, nextNumber.get(parsed.season) ?? 0));
			const info = await stat(file);
			seen.push(relative);

			const [existing] = await db
				.select({ id: episode.id, size: episode.sourceSize, mtime: episode.sourceMtime })
				.from(episode)
				.where(eq(episode.sourcePath, relative));

			if (!existing) {
				await db.insert(episode).values({
					seriesId: s.id,
					season: parsed.season,
					number,
					title: parsed.title,
					sourcePath: relative,
					sourceSize: info.size,
					sourceMtime: info.mtime
				});
				result.added++;
			} else if (existing.size !== info.size || existing.mtime.getTime() !== info.mtime.getTime()) {
				await db
					.update(episode)
					.set({
						sourceSize: info.size,
						sourceMtime: info.mtime,
						missing: false,
						status: 'pending',
						progress: 0,
						error: null
					})
					.where(eq(episode.id, existing.id));
				result.changed++;
			} else {
				await db.update(episode).set({ missing: false }).where(eq(episode.id, existing.id));
			}
		}
	}

	const gone = await db
		.update(episode)
		.set({ missing: true })
		.where(
			and(
				eq(episode.missing, false),
				seen.length ? notInArray(episode.sourcePath, seen) : sql`true`
			)
		)
		.returning({ id: episode.id });
	result.missing = gone.length;

	wakeWorker();
	return result;
}
