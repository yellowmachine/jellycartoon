import { rm } from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR, MEDIA_DIR } from '$app/env/private';

export const mediaRoot = path.resolve(MEDIA_DIR);
export const dataRoot = path.resolve(DATA_DIR);

export const sourceFile = (relative: string) => path.join(mediaRoot, relative);
/** HLS output: master.m3u8, one folder per stream and the subtitle .vtt files. */
export const hlsDir = (episodeId: number) => path.join(dataRoot, 'hls', String(episodeId));
export const thumbFile = (episodeId: number) => path.join(dataRoot, 'thumb', `${episodeId}.jpg`);
/** Output of earlier versions (single MP4); removed when an episode is converted again. */
export const legacyVideoFile = (episodeId: number) =>
	path.join(dataRoot, 'video', `${episodeId}.mp4`);

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
