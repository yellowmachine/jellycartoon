import { error, json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '#lib/server/db/index.ts';
import { episode, watchProgress } from '#lib/server/db/schema.ts';
import { cloudPerson, grantLinks } from '#lib/server/media-api.ts';

/**
 * The video API (#253): a link to watch an episode, for this person, and where it was left. The
 * 720p version by default (the house's upload is the limit); `{ "calidad": "original" }` for the
 * other. Without a 720p one, the original.
 */
export const POST: RequestHandler = async ({ request, params }) => {
	const person = await cloudPerson(request);
	const id = Number(params.id);
	const body = await request.json().catch(() => ({}));
	const [e] = await db
		.select({ light: episode.light, positionSec: watchProgress.positionSec })
		.from(episode)
		.leftJoin(
			watchProgress,
			and(eq(watchProgress.episodeId, episode.id), eq(watchProgress.userId, person.id))
		)
		.where(and(eq(episode.id, id), eq(episode.status, 'ready'), eq(episode.missing, false)));
	if (!e) error(404, 'Capítulo no encontrado');
	const quality = body?.calidad !== 'original' && e.light === 'ready' ? 'light' : 'original';
	return json({
		...grantLinks(person.id, id, quality),
		quality,
		positionSec: e.positionSec ?? 0
	});
};
