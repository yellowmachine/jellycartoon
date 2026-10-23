import { access, rm } from 'node:fs/promises';
import path from 'node:path';
import { dev } from '$app/env';
import {
	CINEMA_DIR,
	DATA_DIR,
	HOST_CINEMA_DIR,
	HOST_DATA_DIR,
	MEDIA_DIR,
	MUSIC_DIR
} from '$app/env/private';

export const mediaRoot = path.resolve(MEDIA_DIR);
export const dataRoot = path.resolve(DATA_DIR);

export const sourceFile = (relative: string) => path.join(mediaRoot, relative);
/** HLS output: master.m3u8, one folder per stream and the subtitle .vtt files. */
export const hlsDir = (episodeId: number) => path.join(dataRoot, 'hls', String(episodeId));
export const thumbFile = (episodeId: number) => path.join(dataRoot, 'thumb', `${episodeId}.jpg`);
/** Output of earlier versions (single MP4); removed when an episode is converted again. */
export const legacyVideoFile = (episodeId: number) =>
	path.join(dataRoot, 'video', `${episodeId}.mp4`);

/** Where DATA_DIR is on this PC: DATA_DIR itself in development, HOST_DATA_DIR in the container. */
const hostDataRoot = dev ? dataRoot : HOST_DATA_DIR;

/** A file of the episode's HLS output as a path on the host, e.g. its subtitles. */
export const hostHlsFile = (episodeId: number, file: string) =>
	hostDataRoot && path.join(hostDataRoot, 'hls', String(episodeId), file);

/** The episode's HLS playlist as a path on the host, to open with mpv or another native player. */
export const hostPlaylist = (episodeId: number) => hostHlsFile(episodeId, 'master.m3u8');

/** mpv on the host can open episodes: it needs to know where DATA_DIR is there. */
export const hostEpisodesReady = Boolean(hostDataRoot && path.isAbsolute(hostDataRoot));

/** The Cine Club intro played before films in the living room; put there by hand, never in git. */
export const introFile = path.join(dataRoot, 'cortinilla.mp4');
export const hostIntroFile = hostDataRoot ? path.join(hostDataRoot, 'cortinilla.mp4') : null;
/** Looked up each time: it can be added or removed without restarting the app. */
export const hasIntro = () =>
	access(introFile).then(
		() => Boolean(hostIntroFile),
		() => false
	);

/** Films folder; null when there is no Cine section. */
export const cinemaRoot = CINEMA_DIR ? path.resolve(CINEMA_DIR) : null;
export const movieFile = (relative: string) => path.join(cinemaRoot!, relative);
export const movieThumbFile = (movieId: number) =>
	path.join(dataRoot, 'movie-thumb', `${movieId}.jpg`);

/** Clips of films to watch in the browser, made when asked for; only the last ones are kept. */
export const movieClipDir = path.join(dataRoot, 'movie-clip');
/** Subtitles made by Whisper for a film (its own are inside its file). */
export const movieSubsDir = (movieId: number) => path.join(dataRoot, 'movie-subs', String(movieId));
/** One of them as a path on the host, for mpv. */
export const hostMovieSubFile = (movieId: number, file: string) =>
	hostDataRoot && path.join(hostDataRoot, 'movie-subs', String(movieId), file);

/** CINEMA_DIR as the host sees it, which is how mpv names the files. */
export const hostCinemaRoot = dev ? cinemaRoot : (HOST_CINEMA_DIR ?? null);

/** The film as a path on the host, which is what mpv there needs. */
export const hostMoviePath = (relative: string) =>
	hostCinemaRoot ? path.join(hostCinemaRoot, relative) : null;

/** Music folder; null when there is no Música section. */
export const musicRoot = MUSIC_DIR ? path.resolve(MUSIC_DIR) : null;
export const musicFile = (relative: string) => path.join(musicRoot!, relative);
/** A track's Opus copy (#64), by its id: the FLAC in MUSIC_DIR is never touched. */
export const opusFile = (trackId: number) => path.join(dataRoot, 'music-opus', `${trackId}.opus`);
/** What the DJ says between songs (dj.ts), as Opus: kept a few hours. */
export const djDir = path.join(dataRoot, 'dj');
/** Front covers from the Cover Art Archive. */
/**
 * The road mode's map (#78), as scripts/mapa.sh leaves it: `espana.pmtiles`, and the `fonts` and
 * `sprites` of its style.
 */
export const mapDir = path.join(dataRoot, 'mapa');
export const mapFile = path.join(mapDir, 'espana.pmtiles');

/** A road mode's photo (#81), by its id in trip_photo. */
export const photoFile = (photoId: number) => path.join(dataRoot, 'fotos', `${photoId}.jpg`);

export const albumCoverFile = (albumId: number) =>
	path.join(dataRoot, 'album-cover', `${albumId}.jpg`);

/** Everything converted for an episode; the original in MEDIA_DIR is left alone. */
export async function removeEpisodeOutput(episodeId: number) {
	await Promise.all(
		[
			hlsDir(episodeId),
			`${hlsDir(episodeId)}.part`,
			thumbFile(episodeId),
			legacyVideoFile(episodeId)
		].map((file) => rm(file, { recursive: true, force: true }))
	);
}
