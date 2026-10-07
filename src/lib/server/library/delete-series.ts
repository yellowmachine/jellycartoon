import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { episode, series } from '#lib/server/db/schema.ts';
import { removeEpisodeOutput } from './paths.ts';
import { cancelEpisodes } from './worker.ts';

/**
 * Removes a series from the catalog (episodes, watch progress, playlist items) and its converted
 * files from DATA_DIR. Originals in MEDIA_DIR are not touched: if they are still there, the next
 * scan adds the series again.
 */
export async function deleteSeries(id: number) {
	const episodes = await db.transaction(async (tx) => {
		const deleted = await tx
			.delete(episode)
			.where(eq(episode.seriesId, id))
			.returning({ id: episode.id });
		await tx.delete(series).where(eq(series.id, id));
		return deleted;
	});

	const ids = episodes.map((e) => e.id);
	cancelEpisodes(ids);
	for (const episodeId of ids) await removeEpisodeOutput(episodeId);
	return ids.length;
}
