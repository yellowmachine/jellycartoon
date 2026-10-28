import { and, desc, eq, gt, inArray, notExists, sql } from 'drizzle-orm';
import {
	podcast,
	podcastEpisode,
	podcastProgress,
	podcastSubscription
} from '#lib/server/db/schema.ts';
import { houseKitchen, type Kitchen } from '#lib/server/fridge.ts';
import { DONE_BEFORE_END, type PodcastPlaying, type PodcastResult } from 'comun/podcasts.ts';
import { isWebUrl, parseFeed, type Feed } from './feed.ts';

/**
 * Public podcasts (#10), the family's since #253: found in Apple's directory or by their feed's URL,
 * followed by each of its people, their episodes read from the feed now and then, and where each
 * one is in each. The audio is played from the podcast's own servers: nothing is downloaded.
 */

/** Who asks: a person of the family (their own podcasts). */
function who(k: Kitchen) {
	if (!k.userId) throw new Error('Los podcasts son de cada persona');
	return k.userId;
}

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
		throw new Error(`No se pudo descargar el feed: ${err instanceof Error ? err.message : err}`, {
			cause: err
		});
	}
	if (!res.ok) throw new Error(`El servidor del feed respondió ${res.status}`);
	if (Number(res.headers.get('content-length') ?? 0) > MAX_FEED_BYTES)
		throw new Error('El feed es demasiado grande');
	const xml = await res.text();
	if (xml.length > MAX_FEED_BYTES) throw new Error('El feed es demasiado grande');
	return parseFeed(xml);
}

/** The podcast's details and its new or changed episodes, from what was read. */
async function store(k: Kitchen, podcastId: number, feed: Feed) {
	await k.run(async (tx) => {
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
				.values(
					feed.episodes.slice(i, i + 100).map((e) => ({ familyId: k.familyId, podcastId, ...e }))
				)
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

/** Follows the podcast of that feed, read now if no one of the family followed it yet. Its id. */
export async function subscribe(k: Kitchen, feedUrl: string) {
	const userId = who(k);
	feedUrl = feedUrl.trim();
	let [found] = await k.run((tx) =>
		tx.select({ id: podcast.id }).from(podcast).where(eq(podcast.feedUrl, feedUrl))
	);
	if (!found) {
		const feed = await fetchFeed(feedUrl);
		[found] = await k.run((tx) =>
			tx
				.insert(podcast)
				.values({ familyId: k.familyId, feedUrl, title: feed.title })
				.onConflictDoUpdate({
					target: [podcast.familyId, podcast.feedUrl],
					set: { title: feed.title }
				})
				.returning({ id: podcast.id })
		);
		await store(k, found!.id, feed);
		console.info(`[podcasts] Nuevo podcast: ${feed.title}`, {
			familyId: k.familyId,
			episodes: feed.episodes.length
		});
	}
	await k.run((tx) =>
		tx
			.insert(podcastSubscription)
			.values({ familyId: k.familyId, userId, podcastId: found!.id })
			.onConflictDoNothing()
	);
	return found!.id;
}

/** No longer followed; a podcast no one of the family follows goes, with its episodes. */
export async function unsubscribe(k: Kitchen, podcastId: number) {
	const userId = who(k);
	await k.run(async (tx) => {
		await tx
			.delete(podcastSubscription)
			.where(
				and(eq(podcastSubscription.userId, userId), eq(podcastSubscription.podcastId, podcastId))
			);
		await tx.delete(podcast).where(
			notExists(
				tx
					.select({ one: sql`1` })
					.from(podcastSubscription)
					.where(eq(podcastSubscription.podcastId, podcast.id))
			)
		);
	});
}

/** The ones this person follows, the one with the newest episode first. */
export async function userPodcasts(k: Kitchen) {
	const userId = who(k);
	return k.run((tx) => {
		const latest = tx
			.select({
				podcastId: podcastEpisode.podcastId,
				latestAt: sql<Date | null>`max(${podcastEpisode.publishedAt})`.as('latest_at'),
				episodes: sql<number>`count(*)::int`.as('episodes')
			})
			.from(podcastEpisode)
			.groupBy(podcastEpisode.podcastId)
			.as('latest');
		return tx
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
	});
}

/** Started and not finished by this person, the last one listened to first. */
export async function continueListening(k: Kitchen, limit = 6) {
	const userId = who(k);
	return k.run((tx) =>
		tx
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
			.limit(limit)
	);
}

/** A podcast and its episodes, with where this person is in each; null if it is not there. */
export async function podcastPage(k: Kitchen, podcastId: number) {
	const userId = who(k);
	return k.run(async (tx) => {
		const [found] = await tx
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
		const episodes = await tx
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
	});
}

/** An episode to play, from where this user left it (from the start if it was finished). */
export async function episodeToPlay(k: Kitchen, episodeId: number): Promise<PodcastPlaying | null> {
	const userId = who(k);
	const [found] = await k.run((tx) =>
		tx
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
			.where(eq(podcastEpisode.id, episodeId))
	);
	if (!found) return null;
	const { completed, positionSec, ...episode } = found;
	return { ...episode, positionSec: completed ? 0 : (positionSec ?? 0) };
}

/** Where this user is in it; listened to near the end, or when the player says it ended. */
export async function saveProgress(
	k: Kitchen,
	episodeId: number,
	positionSec: number,
	ended: boolean
) {
	const userId = who(k);
	const [found] = await k.run((tx) =>
		tx
			.select({ durationSec: podcastEpisode.durationSec })
			.from(podcastEpisode)
			.where(eq(podcastEpisode.id, episodeId))
	);
	if (!found) return false;
	const completed =
		ended || (found.durationSec !== null && positionSec >= found.durationSec - DONE_BEFORE_END);
	await keepProgress(k, userId, episodeId, { positionSec, completed });
	return true;
}

/** Marked as listened to, or not, by hand. */
export async function markListened(k: Kitchen, episodeId: number, completed: boolean) {
	await keepProgress(k, who(k), episodeId, { positionSec: 0, completed });
}

async function keepProgress(
	k: Kitchen,
	userId: string,
	episodeId: number,
	values: { positionSec: number; completed: boolean }
) {
	const row = { ...values, updatedAt: new Date() };
	await k.run((tx) =>
		tx
			.insert(podcastProgress)
			.values({ familyId: k.familyId, userId, episodeId, ...row })
			.onConflictDoUpdate({
				target: [podcastProgress.userId, podcastProgress.episodeId],
				set: row
			})
	);
}

/** One podcast's feed read again; the error kept with it, to show it, if it fails. */
export async function refreshPodcast(k: Kitchen, podcastId: number) {
	const [found] = await k.run((tx) =>
		tx
			.select({ feedUrl: podcast.feedUrl, title: podcast.title })
			.from(podcast)
			.where(eq(podcast.id, podcastId))
	);
	if (!found) return;
	try {
		await store(k, podcastId, await fetchFeed(found.feedUrl));
		return null;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		await k.run((tx) =>
			tx
				.update(podcast)
				.set({ checkedAt: new Date(), lastError: message })
				.where(eq(podcast.id, podcastId))
		);
		return message;
	}
}

/** Every few hours: new episodes come out daily or weekly. */
export const REFRESH_HOURS = 4;

/** A family's followed podcasts' feeds, one after the other (scheduler.ts); what failed, said. */
export async function refreshAll(familyId: string) {
	const k = houseKitchen(familyId);
	const all = await k.run((tx) =>
		tx
			.selectDistinct({ id: podcast.id, title: podcast.title })
			.from(podcast)
			.innerJoin(podcastSubscription, eq(podcastSubscription.podcastId, podcast.id))
	);
	const before = await countEpisodes(
		k,
		all.map((p) => p.id)
	);
	const failed: { title: string; error: string }[] = [];
	for (const p of all) {
		const error = await refreshPodcast(k, p.id);
		if (error) failed.push({ title: p.title, error });
	}
	const added =
		(await countEpisodes(
			k,
			all.map((p) => p.id)
		)) - before;
	if (failed.length)
		console.warn(
			`[podcasts] No se pudieron actualizar ${failed.length} de ${all.length} podcasts: ${failed.map((f) => f.title).join(', ')}`,
			{ familyId }
		);
	if (added > 0) console.info(`[podcasts] ${added} episodios nuevos`, { familyId });
}

async function countEpisodes(k: Kitchen, ids: number[]) {
	if (!ids.length) return 0;
	const [row] = await k.run((tx) =>
		tx
			.select({ n: sql<number>`count(*)::int` })
			.from(podcastEpisode)
			.where(inArray(podcastEpisode.podcastId, ids))
	);
	return row?.n ?? 0;
}

/**
 * The ones this person follows with each one's newest episode, and what they left halfway: for the
 * road mode's tab and the house's TV (/api/casa/podcasts).
 */
export async function podcastLists(k: Kitchen) {
	const [podcasts, inProgress] = await Promise.all([userPodcasts(k), continueListening(k)]);
	const latest = podcasts.length
		? await k.run((tx) =>
				tx
					.selectDistinctOn([podcastEpisode.podcastId], {
						podcastId: podcastEpisode.podcastId,
						id: podcastEpisode.id,
						title: podcastEpisode.title
					})
					.from(podcastEpisode)
					.where(
						inArray(
							podcastEpisode.podcastId,
							podcasts.map((p) => p.id)
						)
					)
					.orderBy(podcastEpisode.podcastId, sql`${podcastEpisode.publishedAt} desc nulls last`)
			)
		: [];
	return {
		podcasts: podcasts.map((p) => ({
			...p,
			latest: latest.find((e) => e.podcastId === p.id) ?? null
		})),
		inProgress
	};
}
