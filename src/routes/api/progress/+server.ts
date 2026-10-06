import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { playlist, playlistItem, watchProgress } from '#lib/server/db/schema.ts';
import { today } from '#lib/server/playlist.ts';

export const POST: RequestHandler = async ({ request, locals }) => {
	const { episodeId, positionSec, durationSec } = await request.json();
	if (!Number.isInteger(episodeId) || typeof positionSec !== 'number') error(400, 'Bad request');

	// Past 92% (end credits) counts as watched, and the next visit starts from zero.
	const completed =
		typeof durationSec === 'number' && durationSec > 0 && positionSec / durationSec > 0.92;
	const values = {
		userId: locals.user!.id,
		episodeId,
		positionSec: completed ? 0 : positionSec,
		completed,
		updatedAt: new Date()
	};

	await db
		.insert(watchProgress)
		.values(values)
		.onConflictDoUpdate({ target: [watchProgress.userId, watchProgress.episodeId], set: values });

	if (completed) {
		// Ticks it off today's playlist. Attributed to the playlist owner, which is also who will
		// get the credit when a playlist is played on another device.
		await db
			.update(playlistItem)
			.set({ watched: true })
			.where(
				and(
					eq(playlistItem.episodeId, episodeId),
					inArray(
						playlistItem.playlistId,
						db
							.select({ id: playlist.id })
							.from(playlist)
							.where(and(eq(playlist.userId, locals.user!.id), eq(playlist.day, today())))
					)
				)
			);
	}

	return json({ ok: true, completed });
};
