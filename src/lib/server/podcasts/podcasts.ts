import { and, desc, eq, gt, inArray, notExists, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	podcast,
	podcastEpisode,
	podcastProgress,
	podcastSubscription
} from '#lib/server/db/schema.ts';
import { log } from '#lib/server/log.ts';
import { DONE_BEFORE_END, type PodcastPlaying, type PodcastResult } from '#lib/podcasts.ts';
import { isWebUrl, parseFeed, type Feed } from './feed.ts';

/**
 * Public podcasts (#10): found in Apple's directory or by their feed's URL, followed by each user,
 * their episodes read from the feed now and then, and where each user is in each one. The audio is
 * played from the podcast's own servers: nothing is downloaded.
 */

const USER_AGENT = 'JellyCartoon/1.0 (https://github.com/yellowmachine/jellycartoon)';
/** Feeds of shows that have been on for years weigh several megabytes. */
const MAX_FEED_BYTES = 20 * 1024 * 1024;

/**
 * Apple's directory, through its public search API (no key needed):
 * https://performance-partners.apple.com/search-api
 */
export async function searchPodcasts(term: string): Promise<PodcastResult[]> {
	const url = new URL('https://itunes.apple.com/search');
	url.search = new URLSearchParams({
		media: 'podcast',
		country: 'es',
		limit: '20',
		term
	}).toString();
	const res = await fetch(url, {
		headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
		signal: AbortSignal.timeout(10_000)
	});
	if (!res.ok) throw new Error(`Apple respondió ${res.status}`);
	const { results } = (await res.json()) as {
		results: {
			feedUrl?: string;
			collectionName?: string;
			artistName?: string;
			artworkUrl600?: string;
		}[];
	};
	return results.flatMap((r) =>
		isWebUrl(r.feedUrl ?? null) && r.collectionName
			? [
					{
						feedUrl: r.feedUrl!,
						title: r.collectionName,
						author: r.artistName ?? null,
						imageUrl: r.artworkUrl600 ?? null
					}
				]
			: []
	);
}

/** The feed at `url`, read; why not, in Spanish, if it cannot be. */
async function fetchFeed(url: string): Promise<Feed> {
	if (!isWebUrl(url)) throw new Error('La dirección del feed tiene que empezar por http(s)://');
	let res;
	try {
		res = await fetch(url, {
			headers: {
				'User-Agent': USER_AGENT,
				Accept: 'application/rss+xml, application/xml, text/xml, */*'
			},
			signal: AbortSignal.timeout(30_000)
		});
	} catch (err) {
		throw new Error(`No se pudo descargar el feed: ${err instanceof Error ? err.message : err}`);
	}
	if (!res.ok) throw new Error(`El servidor del feed respondió ${res.status}`);
	if (Number(res.headers.get('content-length') ?? 0) > MAX_FEED_BYTES)
		throw new Error('El feed es demasiado grande');
	const xml = await res.text();
	if (xml.length > MAX_FEED_BYTES) throw new Error('El feed es demasiado grande');
	return parseFeed(xml);
}

/** The podcast's details and its new or changed episodes, from what was read. */
async function store(podcastId: number, feed: Feed) {
	await db.transaction(async (tx) => {
		await tx
			.update(podcast)
			.set({
				title: feed.title,
				author: feed.author,
				description: feed.description,
				imageUrl: feed.imageUrl,
				link: feed.link,
				checkedAt: new Date(),
				lastError: null
			})
			.where(eq(podcast.id, podcastId));
		// By the hundred: a long feed would go over Postgres' limit of parameters in one insert.
		for (let i = 0; i < feed.episodes.length; i += 100) {
			await tx
				.insert(podcastEpisode)
				.values(feed.episodes.slice(i, i + 100).map((e) => ({ podcastId, ...e })))
				.onConflictDoUpdate({
					target: [podcastEpisode.podcastId, podcastEpisode.guid],
					set: {
						title: sql`excluded.title`,
						description: sql`excluded.description`,
						audioUrl: sql`excluded.audio_url`,
						durationSec: sql`excluded.duration_sec`,
						publishedAt: sql`excluded.published_at`,
						imageUrl: sql`excluded.image_url`
					}
				});
		}
	});
}

/** Follows the podcast of that feed, read now if no one followed it yet. Its id. */
export async function subscribe(userId: string, feedUrl: string) {
	feedUrl = feedUrl.trim();
	let [found] = await db
		.select({ id: podcast.id })
		.from(podcast)
		.where(eq(podcast.feedUrl, feedUrl));
	if (!found) {
		const feed = await fetchFeed(feedUrl);
		[found] = await db
			.insert(podcast)
			.values({ feedUrl, title: feed.title })
			.onConflictDoUpdate({ target: podcast.feedUrl, set: { title: feed.title } })
			.returning({ id: podcast.id });
		await store(found!.id, feed);
		log.info('podcasts', `Nuevo podcast: ${feed.title}`, {
			feedUrl,
			episodes: feed.episodes.length
		});
	}
	await db
		.insert(podcastSubscription)
		.values({ userId, podcastId: found!.id })
		.onConflictDoNothing();
	return found!.id;
}

/** No longer followed; a podcast no one follows goes, with its episodes. */
export async function unsubscribe(userId: string, podcastId: number) {
	await db
		.delete(podcastSubscription)
		.where(
			and(eq(podcastSubscription.userId, userId), eq(podcastSubscription.podcastId, podcastId))
		);
	await deleteUnfollowed();
}

async function deleteUnfollowed() {
	await db.delete(podcast).where(
		notExists(
			db
				.select({ one: sql`1` })
				.from(podcastSubscription)
				.where(eq(podcastSubscription.podcastId, podcast.id))
		)
	);
}

/** The ones this user follows, the one with the newest episode first. */
export async function userPodcasts(userId: string) {
	const latest = db
		.select({
			podcastId: podcastEpisode.podcastId,
			latestAt: sql<Date | null>`max(${podcastEpisode.publishedAt})`.as('latest_at'),
			episodes: sql<number>`count(*)::int`.as('episodes')
		})
		.from(podcastEpisode)
		.groupBy(podcastEpisode.podcastId)
		.as('latest');
	return db
		.select({
			id: podcast.id,
			feedUrl: podcast.feedUrl,
			title: podcast.title,
			author: podcast.author,
			imageUrl: podcast.imageUrl,
			lastError: podcast.lastError,
			latestAt: latest.latestAt,
			episodes: sql<number>`coalesce(${latest.episodes}, 0)`
		})
		.from(podcastSubscription)
		.innerJoin(podcast, eq(podcast.id, podcastSubscription.podcastId))
		.leftJoin(latest, eq(latest.podcastId, podcast.id))
		.where(eq(podcastSubscription.userId, userId))
		.orderBy(sql`${latest.latestAt} desc nulls last`, podcast.title);
}

/** Started and not finished by this user, the last one listened to first. */
export async function continueListening(userId: string, limit = 6) {
	return db
		.select({
			id: podcastEpisode.id,
			title: podcastEpisode.title,
			durationSec: podcastEpisode.durationSec,
			positionSec: podcastProgress.positionSec,
			podcastId: podcast.id,
			podcastTitle: podcast.title,
			imageUrl: sql<string | null>`coalesce(${podcastEpisode.imageUrl}, ${podcast.imageUrl})`
		})
		.from(podcastProgress)
		.innerJoin(podcastEpisode, eq(podcastEpisode.id, podcastProgress.episodeId))
		.innerJoin(podcast, eq(podcast.id, podcastEpisode.podcastId))
		.innerJoin(
			podcastSubscription,
			and(eq(podcastSubscription.podcastId, podcast.id), eq(podcastSubscription.userId, userId))
		)
		.where(
			and(
				eq(podcastProgress.userId, userId),
				eq(podcastProgress.completed, false),
				gt(podcastProgress.positionSec, 5)
			)
		)
		.orderBy(desc(podcastProgress.updatedAt))
		.limit(limit);
}

/** A podcast and its episodes, with where this user is in each; null if it is not there. */
export async function podcastPage(userId: string, podcastId: number) {
	const [found] = await db
		.select({
			id: podcast.id,
			title: podcast.title,
			author: podcast.author,
			description: podcast.description,
			imageUrl: podcast.imageUrl,
			link: podcast.link,
			feedUrl: podcast.feedUrl,
			checkedAt: podcast.checkedAt,
			lastError: podcast.lastError,
			subscribed: sql<boolean>`${podcastSubscription.userId} is not null`
		})
		.from(podcast)
		.leftJoin(
			podcastSubscription,
			and(eq(podcastSubscription.podcastId, podcast.id), eq(podcastSubscription.userId, userId))
		)
		.where(eq(podcast.id, podcastId));
	if (!found) return null;
	const episodes = await db
		.select({
			id: podcastEpisode.id,
			title: podcastEpisode.title,
			description: podcastEpisode.description,
			durationSec: podcastEpisode.durationSec,
			publishedAt: podcastEpisode.publishedAt,
			positionSec: podcastProgress.positionSec,
			completed: podcastProgress.completed
		})
		.from(podcastEpisode)
		.leftJoin(
			podcastProgress,
			and(eq(podcastProgress.episodeId, podcastEpisode.id), eq(podcastProgress.userId, userId))
		)
		.where(eq(podcastEpisode.podcastId, podcastId))
		.orderBy(sql`${podcastEpisode.publishedAt} desc nulls last`, desc(podcastEpisode.id));
	return { ...found, episodes };
}

/** An episode to play, from where this user left it (from the start if it was finished). */
export async function episodeToPlay(
	userId: string,
	episodeId: number
): Promise<PodcastPlaying | null> {
	const [found] = await db
		.select({
			id: podcastEpisode.id,
			podcastId: podcast.id,
			podcastTitle: podcast.title,
			title: podcastEpisode.title,
			audioUrl: podcastEpisode.audioUrl,
			imageUrl: sql<string | null>`coalesce(${podcastEpisode.imageUrl}, ${podcast.imageUrl})`,
			durationSec: podcastEpisode.durationSec,
			positionSec: podcastProgress.positionSec,
			completed: podcastProgress.completed
		})
		.from(podcastEpisode)
		.innerJoin(podcast, eq(podcast.id, podcastEpisode.podcastId))
		.leftJoin(
			podcastProgress,
			and(eq(podcastProgress.episodeId, podcastEpisode.id), eq(podcastProgress.userId, userId))
		)
		.where(eq(podcastEpisode.id, episodeId));
	if (!found) return null;
	const { completed, positionSec, ...episode } = found;
	return { ...episode, positionSec: completed ? 0 : (positionSec ?? 0) };
}

/** Where this user is in it; listened to near the end, or when the player says it ended. */
export async function saveProgress(
	userId: string,
	episodeId: number,
	positionSec: number,
	ended: boolean
) {
	const [found] = await db
		.select({ durationSec: podcastEpisode.durationSec })
		.from(podcastEpisode)
		.where(eq(podcastEpisode.id, episodeId));
	if (!found) return false;
	const completed =
		ended || (found.durationSec !== null && positionSec >= found.durationSec - DONE_BEFORE_END);
	const row = { positionSec, completed, updatedAt: new Date() };
	await db
		.insert(podcastProgress)
		.values({ userId, episodeId, ...row })
		.onConflictDoUpdate({ target: [podcastProgress.userId, podcastProgress.episodeId], set: row });
	return true;
}

/** Marked as listened to, or not, by hand. */
export async function markListened(userId: string, episodeId: number, completed: boolean) {
	const row = { positionSec: 0, completed, updatedAt: new Date() };
	await db
		.insert(podcastProgress)
		.values({ userId, episodeId, ...row })
		.onConflictDoUpdate({ target: [podcastProgress.userId, podcastProgress.episodeId], set: row });
}

/** One podcast's feed read again; the error kept with it, to show it, if it fails. */
export async function refreshPodcast(podcastId: number) {
	const [found] = await db
		.select({ feedUrl: podcast.feedUrl, title: podcast.title })
		.from(podcast)
		.where(eq(podcast.id, podcastId));
	if (!found) return;
	try {
		await store(podcastId, await fetchFeed(found.feedUrl));
		return null;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		await db
			.update(podcast)
			.set({ checkedAt: new Date(), lastError: message })
			.where(eq(podcast.id, podcastId));
		return message;
	}
}

/** Every few hours: new episodes come out daily or weekly. */
export const REFRESH_HOURS = 4;

/** All the followed podcasts' feeds, one after the other; what failed, in the Registro. */
export async function refreshAll() {
	const all = await db
		.selectDistinct({ id: podcast.id, title: podcast.title })
		.from(podcast)
		.innerJoin(podcastSubscription, eq(podcastSubscription.podcastId, podcast.id));
	const before = await countEpisodes(all.map((p) => p.id));
	const failed: { title: string; error: string }[] = [];
	for (const p of all) {
		const error = await refreshPodcast(p.id);
		if (error) failed.push({ title: p.title, error });
	}
	const added = (await countEpisodes(all.map((p) => p.id))) - before;
	if (failed.length)
		log.warn(
			'podcasts',
			`No se pudieron actualizar ${failed.length} de ${all.length} podcasts: ${failed.map((f) => f.title).join(', ')}`,
			{ failed }
		);
	if (added > 0)
		log.info('podcasts', `${added} ${added === 1 ? 'episodio nuevo' : 'episodios nuevos'}`, {
			podcasts: all.length
		});
}

async function countEpisodes(ids: number[]) {
	if (!ids.length) return 0;
	const [row] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(podcastEpisode)
		.where(inArray(podcastEpisode.podcastId, ids));
	return row?.n ?? 0;
}

/** At startup, a few minutes after (not to add to its load), and then every REFRESH_HOURS. */
export function startPodcastRefresh() {
	const run = () =>
		refreshAll().catch((error) =>
			log.error('podcasts', 'Falló la actualización de los podcasts', { error })
		);
	setTimeout(run, 5 * 60 * 1000).unref();
	setInterval(run, REFRESH_HOURS * 60 * 60 * 1000).unref();
}
