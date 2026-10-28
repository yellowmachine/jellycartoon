import type { AudioTrack } from './languages.ts';
import { normalizeLang } from './languages.ts';

/**
 * An episode of the library only listened to (#154): its audio in the music player, which goes on
 * with the phone's screen off, where Chrome pauses any video. Its audio is one of the episode's own
 * HLS tracks, `a<N>/index.m3u8` beside the video (ffmpeg.ts, in the order of its `audioTracks`):
 * nothing made for it.
 */
export interface EpisodeListening {
	id: number;
	/** «El de la boda». */
	title: string;
	/** «Friends · T1 E2», under it. */
	subtitle: string;
	audioUrl: string;
	imageUrl: string;
	durationSec: number | null;
	/** Where it goes, kept here as it plays (MusicBar), and saved as the episode's progress. */
	positionSec: number;
}

/** The HLS playlist of its audio track number `track`. */
export const episodeAudioUrl = (episodeId: number, track: number) =>
	`/api/hls/${episodeId}/a${track}/index.m3u8`;

/** The track in `lang` (the one chosen in Ajustes, or being heard), or else the first. */
export function audioTrackFor(tracks: AudioTrack[], lang: string | null) {
	if (!lang) return 0;
	return Math.max(
		tracks.findIndex((t) => t.lang === normalizeLang(lang)),
		0
	);
}

/** Over 5 seconds, from there; below it, from the start, as the player does. */
export const resumeFrom = (positionSec: number | null, completed: boolean | null) =>
	!completed && positionSec && positionSec > 5 ? positionSec : 0;
