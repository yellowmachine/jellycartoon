import { and, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { episode, episodeQuotes, series, watchProgress } from '#lib/server/db/schema.ts';
import { openRouterConfig } from '#lib/server/app-settings.ts';
import { completeJson } from '#lib/server/openrouter.ts';
import { log } from '#lib/server/log.ts';
import { allowedEpisodes } from '#lib/server/kids.ts';
import { isAutoFile, readCues } from '#lib/server/auto-subtitle-files.ts';
import { hlsDir } from '#lib/server/library/paths.ts';
import { goodLine, subtitleLines, wordCount, type OpeningQuote } from '#lib/quotes.ts';
import type { SubtitleTrack } from '#lib/languages.ts';

const random = <T>(items: T[]) => items[Math.floor(Math.random() * items.length)];

/**
 * The subtitles to take lines from: the language the account watches with, or the first; never
 * Whisper's, which mishear more.
 */
function subtitleFile(tracks: SubtitleTrack[], lang: string | null) {
	const own = tracks.filter((t) => !isAutoFile(t.file));
	return (own.find((t) => t.lang === lang) ?? own[0])?.file ?? null;
}

const playable = and(eq(episode.status, 'ready'), eq(episode.missing, false));

/** Lines from the series the account watched last come first. */
async function lastSeries(userId: string) {
	const [row] = await db
		.select({ seriesId: episode.seriesId })
		.from(watchProgress)
		.innerJoin(episode, eq(episode.id, watchProgress.episodeId))
		.where(eq(watchProgress.userId, userId))
		.orderBy(desc(watchProgress.updatedAt))
		.limit(1);
	return row?.seriesId ?? null;
}

const preferSeries = (seriesId: number | null) =>
	seriesId === null ? sql`random()` : sql`${episode.seriesId} = ${seriesId} desc, random()`;

/**
 * A line for the opening title card: one the AI chose, or, until it has looked at any, one that
 * passes `goodLine`. Null when the library has no subtitles yet. Looking at one more episode is
 * left running behind, so the card does not wait for the AI.
 */
export async function openingQuote(userId: string, lang: string | null) {
	// Never at the cost of opening the app.
	return pickQuote(userId, lang).catch((error) => {
		log.warn('rotulo', 'No se pudo elegir la frase del rótulo de inicio', { error: String(error) });
		return null;
	});
}

async function pickQuote(userId: string, lang: string | null): Promise<OpeningQuote | null> {
	const seriesId = await lastSeries(userId);
	void chooseNext(seriesId, lang);

	const where = (cond: SQL) => and(playable, allowedEpisodes(), cond);
	const columns = {
		series: series.title,
		season: episode.season,
		number: episode.number
	};
	const [chosen] = await db
		.select({ ...columns, quotes: episodeQuotes.quotes })
		.from(episodeQuotes)
		.innerJoin(episode, eq(episode.id, episodeQuotes.episodeId))
		.innerJoin(series, eq(series.id, episode.seriesId))
		.where(where(sql`jsonb_array_length(${episodeQuotes.quotes}) > 0`))
		.orderBy(preferSeries(seriesId))
		.limit(1);
	if (chosen) {
		const { quotes, ...from } = chosen;
		return { text: random(quotes)!, ...from };
	}

	// A few, as some have only Whisper's subtitles or no line good enough.
	const candidates = await db
		.select({ ...columns, id: episode.id, subtitles: episode.subtitles })
		.from(episode)
		.innerJoin(series, eq(series.id, episode.seriesId))
		.where(where(sql`jsonb_array_length(${episode.subtitles}) > 0`))
		.orderBy(preferSeries(seriesId))
		.limit(5);
	for (const { id, subtitles, ...from } of candidates) {
		const file = subtitleFile(subtitles, lang);
		if (!file) continue;
		const lines = await readCues(hlsDir(id), file)
			.then((cues) => subtitleLines(cues).filter(goodLine))
			.catch(() => []);
		if (lines.length) return { text: random(lines)!, ...from };
	}
	return null;
}

/** One episode at a time; after a failure (no credit, OpenRouter down), not again for a while. */
let choosing = false;
let pausedUntil = 0;
const PAUSE_AFTER_FAILURE_MS = 60 * 60_000;

/**
 * Asks the AI for the wittiest lines of an episode no one has looked at yet, the series watched
 * last first. Only with OpenRouter set up; each episode once.
 */
async function chooseNext(seriesId: number | null, lang: string | null) {
	if (choosing || Date.now() < pausedUntil) return;
	choosing = true;
	try {
		if (!(await openRouterConfig()).apiKey) return;
		const next = await db
			.select({
				id: episode.id,
				subtitles: episode.subtitles,
				series: series.title,
				season: episode.season,
				number: episode.number
			})
			.from(episode)
			.innerJoin(series, eq(series.id, episode.seriesId))
			.leftJoin(episodeQuotes, eq(episodeQuotes.episodeId, episode.id))
			.where(
				and(
					playable,
					isNull(episodeQuotes.episodeId),
					sql`jsonb_array_length(${episode.subtitles}) > 0`
				)
			)
			.orderBy(preferSeries(seriesId))
			.limit(5);
		const ep = next.find((e) => subtitleFile(e.subtitles, lang));
		if (!ep) return;
		const file = subtitleFile(ep.subtitles, lang)!;
		const lines = subtitleLines(await readCues(hlsDir(ep.id), file)).filter((l) => {
			const words = wordCount(l);
			return words >= 4 && words <= 30;
		});
		const quotes = lines.length < 3 ? [] : await askAi(lines, ep);
		await db.insert(episodeQuotes).values({ episodeId: ep.id, file, quotes }).onConflictDoNothing();
	} catch (error) {
		pausedUntil = Date.now() + PAUSE_AFTER_FAILURE_MS;
		log.warn('rotulo', 'No se pudieron elegir frases para el rótulo de inicio', {
			error: String(error)
		});
	} finally {
		choosing = false;
	}
}

async function askAi(
	lines: string[],
	ep: { id: number; series: string; season: number; number: number }
): Promise<string[]> {
	const { lines: picked } = await completeJson<{ lines: number[] }>({
		system:
			'You choose lines from TV subtitles for a title card shown on a black screen when an app ' +
			'opens, in the style of the title cards of the sitcom Frasier. Choose up to 5 of the ' +
			'wittiest, cleverest or funniest lines that make sense on their own, without the scene ' +
			'around them. Leave out lines that need context, are plain small talk, or name a character ' +
			'only the scene explains. Fewer is better than weak ones; none if none is good.',
		prompt: `Lines from «${ep.series}», season ${ep.season}, episode ${ep.number}, numbered:\n\n${lines
			.map((l, i) => `${i}. ${l}`)
			.join('\n')}`,
		name: 'title_card_lines',
		label: `Frases para el rótulo de «${ep.series}» T${ep.season} E${ep.number}`,
		details: { episodeId: ep.id },
		schema: {
			type: 'object',
			properties: {
				lines: {
					type: 'array',
					description: 'The numbers of the lines chosen, at most 5.',
					items: { type: 'integer' }
				}
			},
			required: ['lines'],
			additionalProperties: false
		}
	});
	return [...new Set(picked)]
		.map((i) => lines[i])
		.filter((l): l is string => l !== undefined)
		.slice(0, 5);
}
