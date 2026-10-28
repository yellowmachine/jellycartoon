import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { setSubtitleStyle } from '#lib/server/subtitles.ts';

/** Their subtitles' style, chosen in Ajustes: `{ subtitleStyle }`, saved as it is clicked. */
export const PATCH: RequestHandler = async ({ request, locals }) => {
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object' || !('subtitleStyle' in body)) error(400, 'Bad request');
	await setSubtitleStyle(await kitchenOf(locals.user!.id), body.subtitleStyle);
	return json({ ok: true });
};
