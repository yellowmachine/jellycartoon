import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { and, eq, notInArray, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { episode, series } from '#lib/server/db/schema.ts';
import { probeDuration } from './ffmpeg.ts';
import { mediaRoot } from './paths.ts';
import { wakeWorker } from './worker.ts';
import { log } from '#lib/server/log.ts';

export const VIDEO_EXTENSIONS = new Set([
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

/** yt-dlp turns `|` and `:` into their full-width forms; titles look like `Episode | Show | Channel`. */
const SEGMENT_SEPARATOR = /\s*[|｜：]\s*/;

const baseName = (file: string) =>
	path
		.basename(file, path.extname(file))
		// yt-dlp appends `[videoId]`.
		.replace(/\[[^\]]*\]/g, '');

const normalize = (segment: string) => cleanTitle(segment).toLowerCase();

/**
 * Title segments repeated across many files of a series (the show's name, the channel,
 * "FULL EPISODE"…) are noise, not episode titles.
 */
export function noiseSegments(files: string[]) {
	const counts = new Map<string, number>();
	for (const file of files) {
		const title = baseName(file)
			// Only the title part counts, not the `S01E07 - ` / `07 - ` prefix.
			.replace(/^.*?(?:s\d{1,2}\s*e\d{1,3}|\b\d{1,2}x\d{1,3}\b)/i, '')
			.replace(/^\s*\d{1,3}\b/, '');
		const segments = new Set(title.split(SEGMENT_SEPARATOR).map(normalize));
		for (const segment of segments) counts.set(segment, (counts.get(segment) ?? 0) + 1);
	}
	const threshold = Math.max(3, files.length * 0.3);
	return new Set([...counts].filter(([, count]) => count >= threshold).map(([segment]) => segment));
}

function pickTitle(raw: string, noise: Set<string>) {
	const segments = raw.split(SEGMENT_SEPARATOR).map(cleanTitle).filter(Boolean);
	return segments.find((s) => !noise.has(s.toLowerCase())) ?? segments[0] ?? '';
}

/**
 * Accepts `S01E02` or `1x02` anywhere in the name. Otherwise the season comes from a
 * `Temporada 1` / `Season 1` folder and the episode from a leading number (`03 - Title`);
 * files without one are numbered by file order.
 */
export function parseEpisode(relativeToSeries: string, noise = new Set<string>()): ParsedEpisode {
	const name = baseName(relativeToSeries);
	const dirs = path.dirname(relativeToSeries);

	const sxe = name.match(/s(\d{1,2})\s*e(\d{1,3})/i) ?? name.match(/\b(\d{1,2})x(\d{1,3})\b/i);
	if (sxe) {
		const number = Number(sxe[2]);
		return {
			season: Number(sxe[1]),
			number,
			title: pickTitle(name.slice(sxe.index! + sxe[0].length), noise) || `Episodio ${number}`
		};
	}

	const seasonDir = dirs.match(/\b(?:temporada|season|t|s)\s*(\d{1,2})\b/i);
	const leading = name.match(/^\s*(\d{1,3})\b/);
	return {
		season: seasonDir ? Number(seasonDir[1]) : 1,
		number: leading ? Number(leading[1]) : null,
		title: pickTitle(leading ? name.slice(leading[0].length) : name, noise) || cleanTitle(name)
	};
}

/** Characters yt-dlp replaces because they are not allowed in file names. */
const FULL_WIDTH: Record<string, string> = {
	'？': '?',
	'＂': '"',
	'⧸': '/',
	'＊': '*',
	'＜': '<',
	'＞': '>'
};

function cleanTitle(raw: string) {
	return raw
		.replace(/[？＂⧸＊＜＞]/g, (c) => FULL_WIDTH[c])
		.replace(/_+|\.(?=\S)/g, ' ')
		.replace(/\s+/g, ' ')
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
	/** Modified less than a minute ago (probably still being copied); picked up by a later scan. */
	waiting: number;
}

const SETTLE_MS = 60_000;

let scanning: Promise<ScanResult> | null = null;

/** Scans MEDIA_DIR. Concurrent calls share the same run. */
export function scanLibrary() {
	scanning ??= runScan().finally(() => (scanning = null));
	return scanning;
}

async function runScan(): Promise<ScanResult> {
	const result: ScanResult = { series: 0, added: 0, changed: 0, missing: 0, waiting: 0 };
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

		const known = await db
			.select({
				id: episode.id,
				sourcePath: episode.sourcePath,
				size: episode.sourceSize,
				mtime: episode.sourceMtime,
				season: episode.season,
				number: episode.number,
				manualNumbering: episode.manualNumbering,
				durationSec: episode.durationSec
			})
			.from(episode)
			.where(eq(episode.seriesId, s.id));
		const byPath = new Map(known.map((e) => [e.sourcePath, e]));

		// Originals deleted after converting still count, so titles and numbering stay consistent.
		const relativeFiles = files.map((f) => path.relative(mediaRoot, f));
		const noise = noiseSegments([...new Set([...relativeFiles, ...byPath.keys()])]);
		const lastNumber = new Map<number, number>();
		for (const e of known)
			lastNumber.set(e.season, Math.max(e.number, lastNumber.get(e.season) ?? 0));

		for (const [i, file] of files.entries()) {
			const relative = relativeFiles[i];
			seen.push(relative);
			const info = await stat(file);
			if (Date.now() - info.mtime.getTime() < SETTLE_MS) {
				result.waiting++;
				continue;
			}

			const existing = byPath.get(relative);
			const parsed = parseEpisode(path.relative(path.join(mediaRoot, folder), file), noise);
			// Files without a number keep the one they got; new ones continue after the last.
			const number =
				parsed.number ??
				(existing && existing.season === parsed.season
					? existing.number
					: (lastNumber.get(parsed.season) ?? 0) + 1);
			if (!existing?.manualNumbering)
				lastNumber.set(parsed.season, Math.max(number, lastNumber.get(parsed.season) ?? 0));

			// Naming is always re-derived so parser improvements apply to existing episodes too,
			// except a season and number set by hand.
			const naming = {
				...(existing?.manualNumbering ? {} : { season: parsed.season, number }),
				title: parsed.title,
				missing: false,
				sourceRemoved: false
			};

			const changed =
				existing &&
				(existing.size !== info.size || existing.mtime.getTime() !== info.mtime.getTime());
			// Known before converting, to estimate how long the queue takes.
			const durationSec =
				!existing || changed || existing.durationSec === null
					? await probeDuration(file).catch(() => null)
					: existing.durationSec;

			if (!existing) {
				await db.insert(episode).values({
					...naming,
					season: parsed.season,
					number,
					seriesId: s.id,
					sourcePath: relative,
					sourceSize: info.size,
					sourceMtime: info.mtime,
					durationSec
				});
				result.added++;
			} else if (changed) {
				await db
					.update(episode)
					.set({
						...naming,
						sourceSize: info.size,
						sourceMtime: info.mtime,
						durationSec,
						status: 'pending',
						progress: 0,
						error: null
					})
					.where(eq(episode.id, existing.id));
				result.changed++;
			} else {
				await db
					.update(episode)
					.set({ ...naming, durationSec })
					.where(eq(episode.id, existing.id));
			}
		}
	}

	const gone = await db
		.update(episode)
		.set({ missing: true })
		.where(
			and(
				eq(episode.missing, false),
				eq(episode.sourceRemoved, false),
				seen.length ? notInArray(episode.sourcePath, seen) : sql`true`
			)
		)
		.returning({ id: episode.id });
	result.missing = gone.length;

	wakeWorker();
	log.info(
		'scan',
		`Escaneo: ${result.added} nuevos, ${result.changed} cambiados, ${result.missing} desaparecidos, ${result.waiting} copiándose`,
		{ ...result }
	);
	return result;
}
