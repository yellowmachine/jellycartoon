/** Public podcasts (#10), shared by the pages and the player. */

/** A podcast found in Apple's directory, to follow it. */
export interface PodcastResult {
	feedUrl: string;
	title: string;
	author: string | null;
	imageUrl: string | null;
}

/** An episode as the player gets it: where this user left it, to go on from there. */
export interface PodcastPlaying {
	id: number;
	podcastId: number;
	podcastTitle: string;
	title: string;
	audioUrl: string;
	imageUrl: string | null;
	durationSec: number | null;
	positionSec: number;
}

/** For talk, a little faster is still easy to follow. */
export const SPEEDS = [1, 1.25, 1.5] as const;
export type Speed = (typeof SPEEDS)[number];

/** Back a little to hear something again; forward past an ad. */
export const SKIP_BACK = 15;
export const SKIP_FORWARD = 30;

/** Closer to the end than this, an episode is listened to. */
export const DONE_BEFORE_END = 30;
