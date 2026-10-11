import { rm } from 'node:fs/promises';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { episode } from '#lib/server/db/schema.ts';
import { log } from '#lib/server/log.ts';
import { removeEpisodeOutput, sourceFile } from './paths.ts';
import { sidecarSubtitles } from './sources.ts';
import { cancelEpisodes } from './worker.ts';

/**
 * Deletes episodes for good: their original in MEDIA_DIR (and its subtitles next to it), what was
 * converted and the episode itself, with its progress and its place in lists and playlists. With
 * the original gone, scans do not bring it back. An episode whose original cannot be deleted
 * (e.g. MEDIA_DIR mounted read-only) is kept, or the next scan would add it again.
 */
export async function deleteEpisodes(seriesId: number, ids: number[]) {
	const episodes = await db
		.select({ id: episode.id, sourcePath: episode.sourcePath })
		.from(episode)
		.where(and(eq(episode.seriesId, seriesId), inArray(episode.id, ids)));
	cancelEpisodes(episodes.map((e) => e.id));

	const deleted: number[] = [];
	const failed: string[] = [];
	for (const ep of episodes) {
		const input = sourceFile(ep.sourcePath);
		try {
			for (const sub of await sidecarSubtitles(input)) await rm(sub.file, { force: true });
			// `force`: already gone, deleted after converting (DELETE_SOURCES) or by hand.
			await rm(input, { force: true });
		} catch (error) {
			failed.push(ep.sourcePath);
			log.error('series', `No se pudo borrar el original ${ep.sourcePath}`, {
				episodeId: ep.id,
				error
			});
			continue;
		}
		deleted.push(ep.id);
	}

	if (deleted.length) await db.delete(episode).where(inArray(episode.id, deleted));
	for (const id of deleted) await removeEpisodeOutput(id);
	if (deleted.length)
		log.info('series', `Borrados ${deleted.length} capítulos`, {
			seriesId,
			paths: episodes.filter((e) => deleted.includes(e.id)).map((e) => e.sourcePath)
		});
	return { deleted: deleted.length, failed };
}
