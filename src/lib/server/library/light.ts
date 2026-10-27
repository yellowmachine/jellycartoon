import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { X264_PRESET } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import { episode, series } from '#lib/server/db/schema.ts';
import { log } from '#lib/server/log.ts';
import { probe, run, SEGMENT_SECONDS } from './ffmpeg.ts';
import { LIGHT_DIR, segmentsOf, withLight, withoutLight } from './light-master.ts';
import { hlsDir } from './paths.ts';

/**
 * The light version of an episode: its video again at 720p and about 2 Mbps, for the phone or the
 * tablet away from home, where 15 Mbps (Friends from Blu-ray) do not come through the house's
 * upload. Made from the converted HLS (the originals may be deleted), beside the original video
 * and with the same audio and subtitles, as one more variant of its master playlist: each device
 * chooses in the player (player-quality.svelte.ts). Asked for from a series' selection, or by
 * itself after converting when the video passes `AUTO_KBPS`. Made by the conversion worker
 * (worker.ts) when it has nothing to convert, one at a time and at its low priority.
 */

/** Above this, its video, the light version is made by itself after converting. */
export const AUTO_KBPS = 5000;
const HEIGHT = 720;

/** Its video's bitrate, as converted: its folder's size over its length. */
async function videoKbps(episodeId: number, durationSec: number) {
	const size = await directorySize(path.join(hlsDir(episodeId), 'video'));
	return (size * 8) / durationSec / 1000;
}

async function directorySize(dir: string): Promise<number> {
	const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
	const sizes = await Promise.all(
		entries.map((e) => {
			const full = path.join(dir, e.name);
			return e.isDirectory() ? directorySize(full) : stat(full).then((s) => s.size);
		})
	);
	return sizes.reduce((a, b) => a + b, 0);
}

/** Just converted (worker.ts): asked for if its video is heavy. Its output starts without one. */
export async function lightIfHeavy(episodeId: number, durationSec: number) {
	const kbps = durationSec > 0 ? await videoKbps(episodeId, durationSec) : 0;
	if (kbps <= AUTO_KBPS) return false;
	await db
		.update(episode)
		.set({ light: 'pending', lightError: null })
		.where(eq(episode.id, episodeId));
	log.info('worker', `Versión ligera pedida: su vídeo va a ${Math.round(kbps)} kbps`, {
		episodeId
	});
	return true;
}

/** Asked for these converted episodes that have none (or whose last one failed). */
export async function requestLight(ids: number[]) {
	if (!ids.length) return 0;
	const asked = await db
		.update(episode)
		.set({ light: 'pending', lightError: null })
		.where(
			and(
				inArray(episode.id, ids),
				eq(episode.status, 'ready'),
				or(isNull(episode.light), eq(episode.light, 'error'))
			)
		)
		.returning({ id: episode.id });
	return asked.length;
}

/**
 * Made next, after the one being made: with the conversion's priority (worker.ts `moveToFront`),
 * which the conversion only looks at while an episode waits to be converted.
 */
export async function lightToFront(id: number) {
	await db
		.update(episode)
		.set({ priority: sql`(select coalesce(max(${episode.priority}), 0) + 1 from ${episode})` })
		.where(and(eq(episode.id, id), eq(episode.light, 'pending')));
}

/**
 * For Gestión → Conversión: the one being made, those waiting in the order they will be made
 * (`makeNextLight`'s), their series, those that failed, and how many are made.
 */
export async function lightOverview() {
	const now = lightNow();
	const waiting = and(
		eq(episode.light, 'pending'),
		eq(episode.status, 'ready'),
		eq(episode.missing, false)
	);
	const [queue, queueSeries, errors, [made]] = await Promise.all([
		db
			.select({
				id: episode.id,
				sourcePath: episode.sourcePath,
				seriesId: episode.seriesId,
				durationSec: episode.durationSec
			})
			.from(episode)
			.innerJoin(series, eq(series.id, episode.seriesId))
			.where(waiting)
			.orderBy(
				desc(episode.priority),
				sql`${series.queueOrder} nulls last`,
				asc(episode.seriesId),
				asc(episode.season),
				asc(episode.number)
			),
		db
			.select({ id: series.id, title: series.title, count: sql<number>`count(*)::int` })
			.from(episode)
			.innerJoin(series, eq(series.id, episode.seriesId))
			.where(waiting)
			.groupBy(series.id)
			.orderBy(sql`${series.queueOrder} nulls last`, asc(series.id)),
		db
			.select({ id: episode.id, sourcePath: episode.sourcePath, error: episode.lightError })
			.from(episode)
			.where(and(eq(episode.light, 'error'), eq(episode.missing, false)))
			.orderBy(asc(episode.sourcePath)),
		db
			.select({ count: sql<number>`count(*)::int` })
			.from(episode)
			.where(and(eq(episode.light, 'ready'), eq(episode.missing, false)))
	]);
	const [making] = now
		? await db
				.select({ id: episode.id, sourcePath: episode.sourcePath })
				.from(episode)
				.where(eq(episode.id, now.id))
		: [];
	return {
		current: making && now ? { ...making, ratio: now.ratio } : null,
		queue,
		queueSeries,
		errors,
		made: made?.count ?? 0
	};
}

/** Taken out of these: the one being made stops, and the made ones are deleted. */
export async function removeLight(ids: number[]) {
	if (!ids.length) return;
	if (current && ids.includes(current.id)) current.abort.abort();
	const rows = await db
		.update(episode)
		.set({ light: null, lightError: null })
		.where(and(inArray(episode.id, ids), sql`${episode.light} is not null`))
		.returning({ id: episode.id });
	for (const { id } of rows) await deleteLight(id);
}

/** Out of its master playlist first, so that no player asks for it, and then its folder. */
async function deleteLight(episodeId: number) {
	const dir = hlsDir(episodeId);
	const master = path.join(dir, 'master.m3u8');
	const text = await readFile(master, 'utf8').catch(() => null);
	if (text !== null && text.includes(LIGHT_DIR)) await writeFile(master, withoutLight(text));
	await rm(path.join(dir, LIGHT_DIR), { recursive: true, force: true });
	await rm(path.join(dir, `${LIGHT_DIR}.part`), { recursive: true, force: true });
	await db
		.update(episode)
		.set({ outputSize: await directorySize(dir) })
		.where(eq(episode.id, episodeId));
}

/** The one being made, how far it goes, and how to stop it. */
let current: { id: number; abort: AbortController; ratio: number } | null = null;

export const lightNow = () => (current ? { id: current.id, ratio: current.ratio } : null);

/** Stopped with the worker (worker.ts): back to be made. */
export function stopLight() {
	current?.abort.abort();
}

/** From the server's start: one left half made goes back to be made. */
export async function resumeLight() {
	await db.update(episode).set({ light: 'pending' }).where(eq(episode.light, 'processing'));
}

/** The next one asked for, made; false if there is none. */
export async function makeNextLight() {
	const [claimed] = await db.execute<{ id: number }>(sql`
		update ${episode} set light = 'processing', light_error = null
		where id = (
			select e.id from ${episode} e
			join ${series} s on s.id = e.series_id
			where e.light = 'pending' and e.status = 'ready' and not e.missing
			order by e.priority desc, s.queue_order nulls last, e.series_id, e.season, e.number
			limit 1
			for update of e skip locked
		)
		returning id
	`);
	if (!claimed) return false;
	const id = claimed.id;
	const abort = new AbortController();
	current = { id, abort, ratio: 0 };
	const dir = hlsDir(id);
	const partial = path.join(dir, `${LIGHT_DIR}.part`);
	const started = Date.now();
	try {
		const [row] = await db
			.select({ durationSec: episode.durationSec })
			.from(episode)
			.where(eq(episode.id, id));
		const duration = row?.durationSec ?? 0;
		await rm(partial, { recursive: true, force: true });
		await mkdir(partial, { recursive: true });
		await run('ffmpeg', lightArgs(path.join(dir, 'video', 'index.m3u8')), {
			cwd: partial,
			signal: abort.signal,
			onStdout: (chunk) => {
				const match = chunk.match(/out_time_us=(\d+)/g)?.at(-1);
				if (match && duration > 0 && current?.id === id)
					current.ratio = Math.min(1, Number(match.split('=')[1]) / 1e6 / duration);
			}
		});
		abort.signal.throwIfAborted();
		const light = await measure(partial);
		await rm(path.join(dir, LIGHT_DIR), { recursive: true, force: true });
		await rename(partial, path.join(dir, LIGHT_DIR));
		const master = path.join(dir, 'master.m3u8');
		await writeFile(master, withLight(await readFile(master, 'utf8'), light));
		const [updated] = await db
			.update(episode)
			.set({ light: 'ready', outputSize: await directorySize(dir) })
			.where(and(eq(episode.id, id), eq(episode.light, 'processing')))
			.returning({ id: episode.id });
		// Taken out (or the episode converted again) meanwhile.
		if (!updated) await deleteLight(id);
		log.info(
			'worker',
			`Versión ligera hecha: ${light.width}x${light.height}, ${Math.round(light.averageBandwidth / 1000)} kbps`,
			{ episodeId: id, seconds: Math.round((Date.now() - started) / 1000) }
		);
	} catch (error) {
		await rm(partial, { recursive: true, force: true });
		if (abort.signal.aborted) {
			// Stopped with the worker: made again later. Taken out: it is null already.
			await db
				.update(episode)
				.set({ light: 'pending' })
				.where(and(eq(episode.id, id), eq(episode.light, 'processing')));
			log.info('worker', 'Versión ligera parada a medias', { episodeId: id });
		} else {
			const message = error instanceof Error ? error.message : String(error);
			await db
				.update(episode)
				.set({ light: 'error', lightError: message })
				.where(eq(episode.id, id));
			log.error('worker', 'No se pudo hacer la versión ligera', { episodeId: id, error });
		}
	} finally {
		current = null;
	}
	return true;
}

/**
 * ffmpeg's arguments: the original video, without audio (it plays with the original's), at 720p
 * or less, capped near 2.5 Mbps; High profile and level 4.0, as the master playlist says
 * (light-master.ts). Keyframes every segment, as in the conversion.
 */
function lightArgs(video: string) {
	return [
		'-hide_banner',
		'-nostats',
		'-y',
		'-i',
		video,
		'-map',
		'0:v:0',
		'-an',
		'-sn',
		'-dn',
		'-map_metadata',
		'-1',
		'-vf',
		`scale=-2:'min(${HEIGHT},ih)'`,
		'-c:v',
		'libx264',
		'-preset',
		X264_PRESET,
		'-crf',
		'23',
		'-maxrate',
		'2500k',
		'-bufsize',
		'5000k',
		'-profile:v',
		'high',
		'-level',
		'4.0',
		'-pix_fmt',
		'yuv420p',
		'-force_key_frames',
		`expr:gte(t,n_forced*${SEGMENT_SECONDS})`,
		'-f',
		'hls',
		'-hls_time',
		String(SEGMENT_SECONDS),
		'-hls_playlist_type',
		'vod',
		'-hls_segment_type',
		'fmp4',
		'-hls_fmp4_init_filename',
		'init.mp4',
		'-hls_segment_filename',
		'seg_%05d.m4s',
		'-progress',
		'pipe:1',
		'index.m3u8'
	];
}

/** Its size and bitrates, for the master playlist: the peak, of its heaviest segment. */
async function measure(dir: string) {
	const segments = segmentsOf(await readFile(path.join(dir, 'index.m3u8'), 'utf8'));
	const sized = await Promise.all(
		segments.map(async (s) => ({ ...s, bytes: (await stat(path.join(dir, s.file))).size }))
	);
	const seconds = sized.reduce((a, s) => a + s.seconds, 0);
	const bytes = sized.reduce((a, s) => a + s.bytes, 0);
	const peak = Math.max(...sized.map((s) => (s.bytes * 8) / (s.seconds || 1)));
	const info = await probe(path.join(dir, 'index.m3u8'), undefined, false);
	const video = info.streams.find((s) => s.codec_type === 'video');
	// The audio comes on top: a stereo AAC track, as converted.
	const AUDIO = 160_000;
	return {
		bandwidth: peak + AUDIO,
		averageBandwidth: (bytes * 8) / (seconds || 1) + AUDIO,
		width: video?.width ?? 1280,
		height: video?.height ?? HEIGHT
	};
}
