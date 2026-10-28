import type { PodcastPlaying } from 'comun/podcasts.ts';
import { askCloud, CloudProblem, linked } from '#lib/server/kitchen.ts';

/**
 * The podcasts are each person's, in the family's cloud (#253; #10 before): the house's TV and road
 * mode ask for them there (its /api/casa/podcasts), in that person's name. Following new ones is in
 * the cloud's Radio.
 */

export interface FollowedPodcast {
	id: number;
	title: string;
	author: string | null;
	imageUrl: string | null;
	lastError: string | null;
	feedUrl: string;
	/** When its newest episode came out, as JSON gives it. */
	latestAt: string | null;
	episodes: number;
	/** Its newest episode, to put on with one touch. */
	latest: { id: number; title: string } | null;
}

export interface HalfListened {
	id: number;
	title: string;
	durationSec: number | null;
	positionSec: number;
	podcastId: number;
	podcastTitle: string;
	imageUrl: string | null;
}

/** Theirs, and what they left halfway; without the cloud, none (a TV's page should not fail). */
export async function podcastLists(
	userId: string
): Promise<{ podcasts: FollowedPodcast[]; inProgress: HalfListened[] }> {
	try {
		return await askCloud(await linked(), '/podcasts', { userId });
	} catch (error) {
		if (!(error instanceof CloudProblem)) throw error;
		return { podcasts: [], inProgress: [] };
	}
}

/** One podcast and its episodes, with where they are in each; null if it is not there. */
export async function podcastPage(userId: string, id: number) {
	try {
		return (
			await askCloud<{ podcast: CloudPodcastPage }>(await linked(), `/podcasts/${id}`, { userId })
		).podcast;
	} catch (error) {
		if (error instanceof CloudProblem) return null;
		throw error;
	}
}

export interface CloudPodcastPage {
	id: number;
	title: string;
	author: string | null;
	description: string | null;
	imageUrl: string | null;
	link: string | null;
	feedUrl: string;
	checkedAt: string | null;
	lastError: string | null;
	subscribed: boolean;
	episodes: {
		id: number;
		title: string;
		description: string | null;
		durationSec: number | null;
		publishedAt: string | null;
		positionSec: number | null;
		completed: boolean | null;
	}[];
}

/** An episode to play, from where they left it; null if it is not there. */
export async function episodeToPlay(userId: string, id: number) {
	try {
		return await askCloud<PodcastPlaying>(await linked(), `/podcasts/episodios/${id}`, { userId });
	} catch (error) {
		if (error instanceof CloudProblem) return null;
		throw error;
	}
}

/** Where they are in it; false if the cloud did not take it. */
export async function saveProgress(
	userId: string,
	id: number,
	positionSec: number,
	ended: boolean
) {
	try {
		await askCloud(await linked(), `/podcasts/episodios/${id}`, {
			userId,
			body: { positionSec, ended }
		});
		return true;
	} catch (error) {
		if (error instanceof CloudProblem) return false;
		throw error;
	}
}
