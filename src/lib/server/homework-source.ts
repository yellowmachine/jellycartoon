import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { episode, series, watchProgress } from '#lib/server/db/schema.ts';
import { readCues } from '#lib/server/auto-subtitle-files.ts';
import { forKids } from '#lib/server/kids.ts';
import { hlsDir } from '#lib/server/library/paths.ts';
import { subtitleFile } from '#lib/server/opening-quote.ts';
import { transcript } from 'comun/homework.ts';

/**
 * What only the house has for homework (#142): what each child watched, the episodes with dialogue
 * to choose from, and that dialogue, from their subtitles. The homework itself is Seilide's (it
 * asks for these by the video API, api/v1/deberes); while it moves there, the house's own too.
 */

/** All the dialogue of the episodes chosen, at most: a few episodes of cartoons fit well. */
const MAX_TRANSCRIPT = 60_000;

/** An episode the AI can read: its dialogue, and its name to say which it is. */
export interface Readable {
	id: number;
	name: string;
	dialogue: string;
}

/** The episodes' dialogue, from their subtitles; those without any are left out. */
export async function readable(ids: number[], lang: string | null): Promise<Readable[]> {
	const rows = await db
		.select({
			id: episode.id,
			season: episode.season,
			number: episode.number,
			title: episode.title,
			customTitle: episode.customTitle,
			series: series.title,
			subtitles: episode.subtitles
		})
		.from(episode)
		.innerJoin(series, eq(series.id, episode.seriesId))
		.where(inArray(episode.id, ids));
	const perEpisode = Math.floor(MAX_TRANSCRIPT / Math.max(rows.length, 1));
	const read: Readable[] = [];
	for (const row of rows) {
		const file = subtitleFile(row.subtitles, lang);
		if (!file) continue;
		const cues = await readCues(hlsDir(row.id), file).catch(() => []);
		const dialogue = transcript(cues, perEpisode);
		if (!dialogue) continue;
		read.push({
			id: row.id,
			name: `«${row.series}», T${row.season} E${row.number} «${row.customTitle ?? row.title}»`,
			dialogue
		});
	}
	return read;
}

/** An episode a child watched, to choose for homework: with or without dialogue to read. */
export interface Watched {
	id: number;
	series: string;
	season: number;
	number: number;
	title: string;
	watchedAt: Date;
	completed: boolean;
	hasDialogue: boolean;
}

/** What `kidId` watched lately, newest first: the episodes homework can be about. */
export async function watchedBy(kidId: string, limit = 40): Promise<Watched[]> {
	const rows = await db
		.select({
			id: episode.id,
			series: series.title,
			season: episode.season,
			number: episode.number,
			title: episode.title,
			customTitle: episode.customTitle,
			watchedAt: watchProgress.updatedAt,
			completed: watchProgress.completed,
			subtitles: episode.subtitles
		})
		.from(watchProgress)
		.innerJoin(episode, eq(episode.id, watchProgress.episodeId))
		.innerJoin(series, eq(series.id, episode.seriesId))
		.where(eq(watchProgress.userId, kidId))
		.orderBy(desc(watchProgress.updatedAt))
		.limit(limit);
	return rows.map(({ customTitle, subtitles, ...r }) => ({
		...r,
		title: customTitle ?? r.title,
		hasDialogue: subtitles.length > 0
	}));
}

/** Episodes with dialogue of the children's series (tagged «infantil»), by series or title. */
export async function searchEpisodes(query: string, limit = 30) {
	const like = `%${query.trim()}%`;
	const rows = await db
		.select({
			id: episode.id,
			series: series.title,
			season: episode.season,
			number: episode.number,
			title: episode.title,
			customTitle: episode.customTitle
		})
		.from(episode)
		.innerJoin(series, eq(series.id, episode.seriesId))
		.where(
			and(
				forKids(episode.seriesId),
				sql`jsonb_array_length(${episode.subtitles}) > 0`,
				query.trim()
					? or(
							ilike(series.title, like),
							ilike(episode.title, like),
							ilike(episode.customTitle, like)
						)
					: undefined
			)
		)
		.orderBy(asc(series.title), asc(episode.season), asc(episode.number))
		.limit(limit);
	return rows.map(({ customTitle, ...r }) => ({ ...r, title: customTitle ?? r.title }));
}

/** «Dexter's Laboratory · T1 E1», or the series and how many, for the homework's title. */
export async function titleFor(episodeIds: number[]) {
	const rows = await db
		.select({ series: series.title, season: episode.season, number: episode.number })
		.from(episode)
		.innerJoin(series, eq(series.id, episode.seriesId))
		.where(inArray(episode.id, episodeIds))
		.orderBy(asc(episode.season), asc(episode.number));
	const [first] = rows;
	if (!first) return 'Deberes';
	if (rows.length === 1) return `${first.series} · T${first.season} E${first.number}`;
	const sameSeries = rows.every((r) => r.series === first.series);
	return sameSeries ? `${first.series} · ${rows.length} capítulos` : `${rows.length} capítulos`;
}
