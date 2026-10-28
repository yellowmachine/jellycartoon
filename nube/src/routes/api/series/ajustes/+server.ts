import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { HouseProblem } from '#lib/server/house.ts';
import { savePlayerChoices } from '#lib/server/series.ts';
import { setSubtitleStyle } from '#lib/server/subtitles.ts';

/**
 * The player's choices (comun's Player, #253): the subtitles' style, the cloud's (as in Ajustes →
 * Para mí); the languages and what follows, the house's, the same as at home.
 */
export const PATCH: RequestHandler = async ({ request, locals }) => {
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') error(400, 'Bad request');
	const { subtitleStyle, ...rest } = body as Record<string, unknown>;
	if (subtitleStyle !== undefined)
		await setSubtitleStyle(await kitchenOf(locals.user!.id), subtitleStyle);
	const house = Object.fromEntries(
		Object.entries(rest).filter(([key]) => ['audioLang', 'subtitleLang', 'autoNext'].includes(key))
	);
	if (Object.keys(house).length)
		try {
			await savePlayerChoices({ id: locals.user!.id, email: locals.user!.email }, house);
		} catch (err) {
			if (err instanceof HouseProblem) error(502, err.message);
			throw err;
		}
	return json({ ok: true });
};
