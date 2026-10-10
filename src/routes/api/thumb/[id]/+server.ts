import { error, json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '#lib/server/db/index.ts';
import { episode } from '#lib/server/db/schema.ts';
import { fileResponse } from '#lib/server/file-response.ts';
import { takeThumbnail } from '#lib/server/library/thumbnail.ts';
import { thumbFile } from '#lib/server/library/paths.ts';

// Revalidated every time (a 304 when unchanged), so a new thumbnail shows up everywhere at once.
export const GET: RequestHandler = ({ params, request }) =>
	fileResponse(request, thumbFile(Number(params.id)), 'image/jpeg', 'private, no-cache');

/** The frame at `atSec` becomes the episode's thumbnail. */
export const POST: RequestHandler = async ({ params, request }) => {
	const { atSec } = await request.json();
	const [ep] = await db
		.select({ durationSec: episode.durationSec })
		.from(episode)
		.where(and(eq(episode.id, Number(params.id)), eq(episode.status, 'ready')));
	if (!ep) error(404, 'Episodio no disponible');
	if (typeof atSec !== 'number' || atSec < 0 || (ep.durationSec && atSec > ep.durationSec))
		error(400, 'Momento no válido');

	await takeThumbnail(Number(params.id), atSec);
	return json({ ok: true });
};
