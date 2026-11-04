import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { and, asc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { isLrc, parseLyrics, type Lyrics } from 'comun/lyrics.ts';
import { db } from '#lib/server/db/index.ts';
import {
	album,
	albumTitle,
	track,
	trackArtist,
	trackLyrics,
	trackTitle
} from '#lib/server/db/schema.ts';
import { probe } from '#lib/server/library/ffmpeg.ts';
import { musicFile } from '#lib/server/library/paths.ts';
import { log } from '#lib/server/log.ts';
import { musicProgress } from './status.ts';
import { normalizeTags } from './tags.ts';

/**
 * Songs' lyrics, after the covers (catalog.ts), once each: what the file has (its LYRICS tag, or a
 * `.lrc` with its name beside it), else LRCLIB (https://lrclib.net/docs: open, no key, many with
 * the time of each line), by artist, title, album and duration. Not found, again after
 * `AGAIN_DAYS`, as people add lyrics there. LRCLIB not answering stops it until the next time,
 * without marking the rest as not found.
 */

const USER_AGENT = 'JellyCartoon/1.0 (https://github.com/yellowmachine/jellycartoon)';
/** Between two of LRCLIB's: it asks for none, but it is someone else's free service. */
const PAUSE_MS = 400;
const AGAIN_DAYS = 30;
/** Its duration and LRCLIB's, this far apart at most: another recording otherwise. */
const SAME_SECONDS = 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface LrclibTrack {
	trackName: string;
	artistName: string;
	duration: number;
	instrumental: boolean;
	plainLyrics: string | null;
	syncedLyrics: string | null;
}

/** LRCLIB's, or null if it has none; throws if it does not answer. */
async function lrclib(pathAndQuery: string): Promise<unknown> {
	const res = await fetch(`https://lrclib.net/api/${pathAndQuery}`, {
		headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
		signal: AbortSignal.timeout(15_000)
	});
	if (res.status === 404) return null;
	if (!res.ok) throw new Error(`LRCLIB respondió ${res.status}`);
	return res.json();
}

/** «Song (Official Video)», «Song [Remastered 2011]», «Song - Live»: the song's own name. */
export const plainTitle = (title: string) =>
	title
		.replace(/\s*[([][^)\]]*[)\]]/g, '')
		.replace(/\s+-\s+(live|remaster(ed)?|radio edit|en directo|versi[oó]n).*$/i, '')
		.trim();

const found = (t: LrclibTrack): Omit<Row, 'source'> =>
	t.instrumental
		? { kind: 'instrumental', text: null }
		: t.syncedLyrics?.trim()
			? { kind: 'synced', text: t.syncedLyrics }
			: t.plainLyrics?.trim()
				? { kind: 'plain', text: t.plainLyrics }
				: { kind: 'none', text: null };

interface Row {
	kind: 'synced' | 'plain' | 'instrumental' | 'none';
	text: string | null;
	source: string | null;
}

/** By its exact signature first; else searched, the first of about its duration. */
async function fromLrclib(song: {
	title: string;
	artist: string;
	album: string | null;
	durationSec: number | null;
}): Promise<Row | null> {
	const q = new URLSearchParams({ artist_name: song.artist, track_name: song.title });
	if (song.album) q.set('album_name', song.album);
	if (song.durationSec) q.set('duration', String(Math.round(song.durationSec)));
	const exact = (await lrclib(`get?${q}`)) as LrclibTrack | null;
	if (exact) return { ...found(exact), source: 'lrclib' };
	await sleep(PAUSE_MS);
	const results = (await lrclib(
		`search?${new URLSearchParams({ artist_name: song.artist, track_name: plainTitle(song.title) })}`
	)) as LrclibTrack[] | null;
	const near = (results ?? []).find(
		(t) => !song.durationSec || Math.abs(t.duration - song.durationSec) <= SAME_SECONDS
	);
	return near ? { ...found(near), source: 'lrclib' } : null;
}

/** What the file itself has: its LYRICS (or UNSYNCEDLYRICS) tag, or a `.lrc` beside it. */
async function fromFile(file: string): Promise<Row | null> {
	const full = musicFile(file);
	const lrc = await readFile(
		path.join(path.dirname(full), `${path.parse(full).name}.lrc`),
		'utf8'
	).catch(() => null);
	if (lrc?.trim()) return { kind: isLrc(lrc) ? 'synced' : 'plain', text: lrc, source: 'lrc' };
	const info = await probe(full, undefined, false).catch(() => null);
	const audio = info?.streams.find((s) => s.codec_type === 'audio');
	const tags = normalizeTags({ ...audio?.tags, ...info?.format.tags });
	const text = Object.entries(tags).find(([k]) => /^(unsynced)?lyrics/.test(k))?.[1];
	return text?.trim() ? { kind: isLrc(text) ? 'synced' : 'plain', text, source: 'etiqueta' } : null;
}

/** Every song still to look for (or not found a while ago), one at a time; resolves when done. */
export async function findLyrics() {
	musicProgress.phase = 'lyrics';
	const tally = { synced: 0, plain: 0, instrumental: 0, none: 0 };
	try {
		for (;;) {
			const [next] = await db
				.select({
					id: track.id,
					path: track.path,
					title: trackTitle,
					artist: trackArtist,
					album: albumTitle,
					durationSec: track.durationSec
				})
				.from(track)
				.innerJoin(album, eq(album.id, track.albumId))
				.leftJoin(trackLyrics, eq(trackLyrics.trackId, track.id))
				.where(
					and(
						eq(track.status, 'ready'),
						eq(track.missing, false),
						or(
							isNull(trackLyrics.trackId),
							and(
								eq(trackLyrics.kind, 'none'),
								lt(trackLyrics.checkedAt, sql`now() - make_interval(days => ${AGAIN_DAYS})`)
							)
						)
					)
				)
				.orderBy(asc(track.id))
				.limit(1);
			if (!next) return;
			let row = await fromFile(next.path);
			if (!row && next.artist) {
				try {
					row = await fromLrclib({ ...next, artist: next.artist });
				} catch (error) {
					// Down, or asked too much: the rest another time, still to look for.
					log.warn('música', 'LRCLIB no contesta: las letras, otra vez', { error });
					return;
				}
				await sleep(PAUSE_MS);
			}
			const values = { ...(row ?? { kind: 'none' as const, text: null, source: null }) };
			tally[values.kind]++;
			await db
				.insert(trackLyrics)
				.values({ trackId: next.id, ...values, checkedAt: new Date() })
				.onConflictDoUpdate({
					target: trackLyrics.trackId,
					set: { ...values, checkedAt: new Date() }
				});
		}
	} finally {
		const looked = tally.synced + tally.plain + tally.instrumental + tally.none;
		if (looked)
			log.info(
				'música',
				`Letras de ${looked} canciones: ${tally.synced} con tiempos, ${tally.plain} sin, ${tally.instrumental} instrumentales, ${tally.none} sin encontrar`,
				{ ...tally }
			);
	}
}

/** A song's lyrics, if it has some: null if not looked for yet, not found, or not a song. */
export async function lyricsOf(trackId: number): Promise<Lyrics | null> {
	const [row] = await db
		.select({ kind: trackLyrics.kind, text: trackLyrics.text })
		.from(trackLyrics)
		.where(eq(trackLyrics.trackId, trackId));
	if (!row || row.kind === 'none') return null;
	if (row.kind === 'instrumental') return { kind: 'instrumental', lines: [] };
	const lines = parseLyrics(row.text ?? '');
	if (!lines.length) return null;
	return { kind: lines.some((l) => l.at !== null) ? 'synced' : 'plain', lines };
}

/** Its file changed: its lyrics looked for again. */
export async function forgetLyrics(trackId: number) {
	await db.delete(trackLyrics).where(eq(trackLyrics.trackId, trackId));
}
