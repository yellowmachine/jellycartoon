import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { ownDjClip } from '#lib/server/own-music-dj.ts';
import { isDjVoice } from 'comun/music.ts';

/** Modo DJ with a list of «Tu música» (#534): what the DJ says now, as a track of the queue. */
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await request.json().catch(() => null);
	const ids = (value: unknown) =>
		Array.isArray(value) ? value.filter((id) => Number.isInteger(id)).slice(-20) : [];
	if (!Number.isInteger(body?.playlistId)) error(400, 'Lista no válida');
	if (body.lang !== 'es' && body.lang !== 'en') error(400, 'Idioma no válido');
	try {
		return json(
			await ownDjClip(await kitchenOf(locals.user!.id), {
				playlistId: body.playlistId,
				played: ids(body.played),
				next: Number.isInteger(body.next) ? body.next : null,
				lang: body.lang,
				voice: isDjVoice(body.voice) ? body.voice : 'male',
				playlist: typeof body.playlist === 'string' ? body.playlist.slice(0, 120) : null
			})
		);
	} catch (err) {
		error(502, err instanceof Error ? err.message : String(err));
	}
};
