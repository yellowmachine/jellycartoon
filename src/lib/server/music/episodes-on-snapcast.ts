import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import { AUDIO_LANG } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import { episode, episodeTitle, series, watchProgress } from '#lib/server/db/schema.ts';
import { seriesQueue } from '#lib/server/cinema/episode-actions.ts';
import { allowedEpisodes } from '#lib/server/kids.ts';
import { videoClosed } from '#lib/server/kid-time.ts';
import { hlsDir } from '#lib/server/library/paths.ts';
import { getSettings } from '#lib/server/settings.ts';
import { audioTrackFor, resumeFrom } from 'comun/episode-audio.ts';
import type { SnapcastWhere } from 'comun/music.ts';
import { concatInput } from './concat-input.ts';
import { stopDjOnSnapcast } from './dj.ts';
import { listenOnSnapcast, snapcastNow, soundOn } from './snapcast.ts';

/**
 * Episodes only listened to on Snapcast (#223), e.g. to fall asleep with a series: one and, with
 * «siguiente automático», the ones after it in its series, each from where it was left, in the
 * audio language of Ajustes. Their audio is one of their own HLS tracks (episode-audio.ts), which
 * mpv-music reads from the same /data.
 */

/** Its audio track as one file for mpv (concat-input.ts). */
async function audioInput(episodeId: number, track: number) {
	const dir = path.join(hlsDir(episodeId), `a${track}`);
	return concatInput(dir, await readFile(path.join(dir, 'index.m3u8'), 'utf8'));
}

/**
 * Plays `episodeId` and the ones after it on Snapcast, only `where`; from `startSec`, or from where
 * it was left. Its title, to say it; throws what went wrong.
 */
export async function episodesOnSnapcast(
	userId: string,
	episodeId: number,
	startSec: number | null,
	where: SnapcastWhere
) {
	const closed = await videoClosed(userId);
	if (closed) throw new Error(closed);
	const ids = await seriesQueue(userId, episodeId);
	const rows = await db
		.select({
			id: episode.id,
			season: episode.season,
			number: episode.number,
			title: episodeTitle,
			durationSec: episode.durationSec,
			audioTracks: episode.audioTracks,
			seriesId: episode.seriesId,
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
		);
	const byId = new Map(rows.map((r) => [r.id, r]));
	const episodes = ids.flatMap((id) => byId.get(id) ?? []);
	if (episodes[0]?.id !== episodeId) throw new Error('Ese capítulo no está listo para oírlo');

	const settings = await getSettings(userId);
	const lang = settings.audioLang ?? AUDIO_LANG ?? null;
	const items = await Promise.all(
		episodes.map(async (e, i) => ({
			episode: {
				id: e.id,
				title: e.title,
				subtitle: `${e.seriesTitle} · T${e.season} E${e.number}`,
				seriesId: e.seriesId,
				durationSec: e.durationSec
			},
			url: await audioInput(e.id, audioTrackFor(e.audioTracks, lang)),
			startSec: i === 0 && startSec !== null ? startSec : resumeFrom(e.positionSec, e.completed)
		}))
	);

	// Only there before it sounds, not everywhere for a moment.
	await soundOn(where);
	const speaker =
		where === 'house' ? null : snapcastNow().speakers?.find((s) => s.id === where.speakerId);
	stopDjOnSnapcast();
	await listenOnSnapcast(items, {
		userId,
		place: `Snapcast · ${speaker?.name ?? 'toda la casa'}`
	});
	return items[0].episode;
}
