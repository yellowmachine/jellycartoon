import { rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { probe, thumbnail } from './ffmpeg.ts';
import { hlsDir, thumbFile } from './paths.ts';

/**
 * A new thumbnail from the frame at `atSec`, for when the one taken while converting is black or a
 * spoiler. Taken from the converted video: the original may have been deleted (DELETE_SOURCES).
 */
export async function takeThumbnail(episodeId: number, atSec: number) {
	const input = path.join(hlsDir(episodeId), 'master.m3u8');
	const output = thumbFile(episodeId);
	// Written aside and then renamed, so the page never gets half an image.
	const partial = output.replace(/\.jpg$/, '.part.jpg');
	try {
		// Not the worker's: it must not freeze when the queue is paused.
		const info = await probe(input, undefined, false);
		await thumbnail(input, partial, info, atSec, { fromStart: true, pausable: false });
		await rename(partial, output);
	} finally {
		await rm(partial, { force: true });
	}
}
