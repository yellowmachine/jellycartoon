import { error, json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '#lib/server/db/index.ts';
import { episode } from '#lib/server/db/schema.ts';
import { cloudViewer, grantLinks, kidMayWatch } from '#lib/server/media-api.ts';
import { watchPage } from '#lib/server/watch-page.ts';

/**
 * The video API (#253): a link to watch an episode, for this person, and what its page needs, as
 * the house's (watch-page.ts): its audios and subtitles, where it was left (`{ "inicio": 0 }`, from
 * there instead), the next one and others, and their choices. The 720p version by default (the
 * house's upload is the limit); `{ "calidad": "original" }` for the other. Without a 720p one, the
 * original.
 */
export const POST: RequestHandler = async ({ request, params }) => {
	const person = await cloudViewer(request);
	const id = Number(params.id);
	await kidMayWatch(person, id);
	const body = await request.json().catch(() => ({}));
	const start = typeof body?.inicio === 'number' && body.inicio >= 0 ? body.inicio : null;
	const [[e], watch] = await Promise.all([
		db
			.select({ light: episode.light })
			.from(episode)
			.where(and(eq(episode.id, id), eq(episode.missing, false))),
		watchPage(person.id, id, start)
	]);
	if (!e || !watch) error(404, 'Capítulo no encontrado');
	const quality = body?.calidad !== 'original' && e.light === 'ready' ? 'light' : 'original';
	return json({
		...grantLinks(person.id, id, quality),
		quality,
		positionSec: watch.episode.positionSec ?? 0,
		...watch
	});
};
