import { error } from '@sveltejs/kit';
import { and, eq, gt, inArray, or, asc } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { db } from '#lib/server/db/index.ts';
import { episode, episodeTitle, series, watchProgress } from '#lib/server/db/schema.ts';
import { getSettings } from '#lib/server/settings.ts';
import { getCandidates, suggestEpisodes } from '#lib/server/playlist.ts';
import { seriesTags } from '#lib/server/tags.ts';
import { askEvery } from '#lib/server/still-there.ts';

export const load: PageServerLoad = async ({ params, url, locals }) => {
	const id = Number(params.id);
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
			and(eq(watchProgress.episodeId, episode.id), eq(watchProgress.userId, locals.user!.id))
		)
		.where(eq(episode.id, id));
	if (!ep || ep.status !== 'ready') error(404, 'Episodio no disponible');

	const [next] = await db
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
		.orderBy(asc(episode.season), asc(episode.number))
		.limit(1);

	// `?t=0` starts from there instead of where it was left.
	const t = url.searchParams.get('t');
	if (t !== null) ep.positionSec = Number(t) || 0;

	const userId = locals.user!.id;
	const [settings, suggested, ask] = await Promise.all([
		getSettings(userId),
		suggestionsFor(userId, ep.seriesId),
		askEvery(userId)
	]);
	const cards = await episodeCards(userId, [...(next ? [next.id] : []), ...suggested]);
	return {
		episode: ep,
		nextId: next?.id ?? null,
		/** For its card: under the video, and over it with a countdown when this one ends. */
		next: next ? (cards.get(next.id) ?? null) : null,
		/** Without «siguiente automático»: other series' episodes to go on with. */
		suggestions: suggested.flatMap((id) => cards.get(id) ?? []),
		settings,
		/** «¿Sigues ahí?» after this many started by themselves (#77); null, never. */
		askEvery: ask
	};
};

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
