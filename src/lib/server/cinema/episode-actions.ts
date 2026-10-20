import { fail } from '@sveltejs/kit';
import { and, asc, eq, gt, inArray, or } from 'drizzle-orm';
import { AUDIO_LANG } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import { episode, episodeTitle, series, watchProgress } from '#lib/server/db/schema.ts';
import { formFile, isAutoFile } from '#lib/server/auto-subtitle-files.ts';
import { hlsDir, hostEpisodesReady, hostHlsFile, hostPlaylist } from '#lib/server/library/paths.ts';
import { allowedEpisodes } from '#lib/server/kids.ts';
import { videoClosed } from '#lib/server/kid-time.ts';
import { getSettings } from '#lib/server/settings.ts';
import { log } from '#lib/server/log.ts';
import { mpvEnabled, play as playOnHost } from './mpv.ts';

export { playlistQueue } from './queue.ts';

/** Episodes in the living room: one, the ones after it in its series, or a playlist. */

/**
 * Queues the episodes in mpv, in this order; each one from where it was left. `firstStartSec`
 * overrides that for the first one (e.g. 0: from the beginning).
 */
export async function playEpisodes(userId: string, ids: number[], firstStartSec?: number) {
	if (!mpvEnabled) return fail(400, { message: 'No hay mpv configurado (MPV_SOCKET)' });
	if (!hostEpisodesReady)
		return fail(400, {
			message: 'Para ver capítulos en el salón, HOST_DATA_DIR tiene que ser una ruta absoluta'
		});
	const closed = await videoClosed(userId);
	if (closed) return fail(403, { message: closed });

	const rows = ids.length
		? await db
				.select({
					id: episode.id,
					season: episode.season,
					number: episode.number,
					title: episodeTitle,
					durationSec: episode.durationSec,
					subtitles: episode.subtitles,
					seriesTitle: series.title,
					positionSec: watchProgress.positionSec,
					completed: watchProgress.completed
				})
				.from(episode)
				.innerJoin(series, eq(series.id, episode.seriesId))
				.leftJoin(
					watchProgress,
					and(eq(watchProgress.episodeId, episode.id), eq(watchProgress.userId, userId))
				)
				.where(
					and(
						inArray(episode.id, ids),
						eq(episode.status, 'ready'),
						eq(episode.missing, false),
						allowedEpisodes()
					)
				)
		: [];
	const byId = new Map(rows.map((r) => [r.id, r]));
	const episodes = ids.flatMap((id) => byId.get(id) ?? []);
	if (!episodes.length) return fail(400, { message: 'No hay capítulos listos para ver' });

	const settings = await getSettings(userId);
	// Whisper's in the form chosen in «⚙ Estilo» (#86): mpv reads them from disk, so a file each.
	const subtitlesOf = async (e: (typeof episodes)[number]) =>
		Promise.all(
			e.subtitles.map(async (s) => ({
				path: hostHlsFile(
					e.id,
					isAutoFile(s.file)
						? await formFile(hlsDir(e.id), s.file, settings.subtitleStyle.automatic).catch(
								() => s.file
							)
						: s.file
				)!,
				lang: s.lang,
				label: s.label
			}))
		);
	const subtitles = await Promise.all(episodes.map(subtitlesOf));
	try {
		await playOnHost({
			userId,
			items: episodes.map((e, i) => ({
				target: {
					episodeId: e.id,
					subtitles: subtitles[i]!
				},
				title: e.title,
				subtitle: `${e.seriesTitle} · T${e.season} E${e.number}`,
				hostPath: hostPlaylist(e.id)!,
				// The player ignores the first seconds too: it starts over below that.
				startSec:
					i === 0 && firstStartSec !== undefined
						? firstStartSec
						: !e.completed && e.positionSec && e.positionSec > 5
							? e.positionSec
							: 0,
				durationSec: e.durationSec
			})),
			audioLang: settings.audioLang ?? AUDIO_LANG,
			subtitleLang: settings.subtitleLang,
			subtitleStyle: settings.subtitleStyle,
			intro: null
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		log.error('mpv', 'No se pudieron reproducir los capítulos', { ids, error: err });
		return fail(500, { message });
	}
	return { playing: episodes[0].title };
}

/** The episode and, with «siguiente automático», the ones after it in its series. */
export async function seriesQueue(userId: string, episodeId: number) {
	const [ep] = await db
		.select({ seriesId: episode.seriesId, season: episode.season, number: episode.number })
		.from(episode)
		.where(eq(episode.id, episodeId));
	if (!ep || !(await getSettings(userId)).autoNext) return [episodeId];
	const after = await db
		.select({ id: episode.id })
		.from(episode)
		.where(
			and(
				eq(episode.seriesId, ep.seriesId),
				eq(episode.status, 'ready'),
				eq(episode.missing, false),
				or(
					gt(episode.season, ep.season),
					and(eq(episode.season, ep.season), gt(episode.number, ep.number))
				)
			)
		)
		.orderBy(asc(episode.season), asc(episode.number));
	return [episodeId, ...after.map((e) => e.id)];
}
