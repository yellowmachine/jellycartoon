import { rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { probe, thumbnail } from './ffmpeg.ts';
import { hlsDir, thumbFile } from './paths.ts';

/**
 * A new thumbnail from a random moment, for when the one taken while converting is black or a
 * spoiler. Taken from the converted video: the original may have been deleted (DELETE_SOURCES).
 */
export async function regenerateThumbnail(episodeId: number, durationSec: number) {
	const input = path.join(hlsDir(episodeId), 'master.m3u8');
	const output = thumbFile(episodeId);
	// Written aside and then renamed, so the page never gets half an image.
	const partial = output.replace(/\.jpg$/, '.part.jpg');
	try {
		const info = await probe(input);
		await thumbnail(input, partial, info, durationSec * (0.1 + Math.random() * 0.7));
		await rename(partial, output);
	} finally {
		await rm(partial, { force: true });
	}
}
