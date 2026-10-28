import { and, eq, inArray } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { episode, episodeTitle, series, watchProgress } from '#lib/server/db/schema.ts';
import { episodeOrder, episodesAfter } from '#lib/server/episode-order.ts';
import { getSettings } from '#lib/server/settings.ts';
import { getCandidates, suggestEpisodes } from '#lib/server/playlist.ts';
import { seriesTags } from '#lib/server/tags.ts';

/**
 * An episode to watch, for this person: its audios and subtitles, where they left it (or `startSec`
 * instead), the next one and others to go on with, and their choices. For the house's player and
 * the cloud's (#253, its /api/v1). Null if it is not ready.
 */
export async function watchPage(userId: string, id: number, startSec: number | null = null) {
	const [ep] = await db
		.select({
			id: episode.id,
			seriesId: episode.seriesId,
			season: episode.season,
			number: episode.number,
			title: episodeTitle,
			status: episode.status,
			durationSec: episode.durationSec,
			audioTracks: episode.audioTracks,
			subtitles: episode.subtitles,
			seriesTitle: series.title,
			positionSec: watchProgress.positionSec
		})
		.from(episode)
		.innerJoin(series, eq(series.id, episode.seriesId))
		.leftJoin(
			watchProgress,
			and(eq(watchProgress.episodeId, episode.id), eq(watchProgress.userId, userId))
		)
		.where(eq(episode.id, id));
	if (!ep || ep.status !== 'ready') return null;

	const [next] = await db
		.select({ id: episode.id })
		.from(episode)
		.where(
			and(
				eq(episode.seriesId, ep.seriesId),
				eq(episode.status, 'ready'),
				eq(episode.missing, false),
				episodesAfter(ep)
			)
		)
		.orderBy(...episodeOrder)
		.limit(1);

	if (startSec !== null) ep.positionSec = startSec;

	const [settings, suggested] = await Promise.all([
		getSettings(userId),
		suggestionsFor(userId, ep.seriesId)
	]);
	const cards = await episodeCards(userId, [...(next ? [next.id] : []), ...suggested]);
	return {
		episode: ep,
		nextId: next?.id ?? null,
		/** For its card: under the video, and over it with a countdown when this one ends. */
		next: next ? (cards.get(next.id) ?? null) : null,
		/** Without «siguiente automático»: other series' episodes to go on with. */
		suggestions: suggested.flatMap((id) => cards.get(id) ?? []),
		settings
	};
}

/** How many other series' episodes are suggested. */
const SUGGESTIONS = 3;

/**
 * Episodes of other series to go on with: the one that is each one's turn, from series sharing a
 * tag with this one first, then any (a child's, only what they may watch: see getCandidates).
 */
async function suggestionsFor(userId: string, seriesId: number) {
	const tags = (await seriesTags(seriesId)).map((t) => t.id);
	const sharing = tags.length ? await getCandidates(userId, { include: tags, exclude: [] }) : [];
	let picked = suggestEpisodes(sharing, seriesId, SUGGESTIONS);
	if (picked.length < SUGGESTIONS) {
		const taken = new Set(picked.map((e) => e.seriesId));
		const rest = (await getCandidates(userId)).filter((c) => !taken.has(c.seriesId));
		picked = [...picked, ...suggestEpisodes(rest, seriesId, SUGGESTIONS - picked.length)];
	}
	return picked.map((e) => e.id);
}

/** What an episode's card shows, as in its series' page: by id. */
async function episodeCards(userId: string, ids: number[]) {
	const rows = !ids.length
		? []
		: await db
				.select({
					id: episode.id,
					seriesId: series.id,
					seriesTitle: series.title,
					season: episode.season,
					number: episode.number,
					title: episodeTitle,
					durationSec: episode.durationSec,
					positionSec: watchProgress.positionSec,
					completed: watchProgress.completed
				})
				.from(episode)
				.innerJoin(series, eq(series.id, episode.seriesId))
				.leftJoin(
					watchProgress,
					and(eq(watchProgress.episodeId, episode.id), eq(watchProgress.userId, userId))
				)
				.where(inArray(episode.id, ids));
	return new Map(rows.map((r) => [r.id, r]));
}
