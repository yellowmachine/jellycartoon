import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openRouterConfig } from '#lib/server/app-settings.ts';
import { cloudPerson } from '#lib/server/media-api.ts';
import { djEnabled } from '#lib/server/music/dj.ts';
import { presetsOf } from '#lib/server/music/dj-presets.ts';

/**
 * The music API (#253): Modo DJ, the house's, for the cloud's Música and road mode. Whether there
 * is a voice for it, whether a man's or a woman's can be chosen (only OpenRouter's has both), and
 * this person's saved setups.
 */
export const GET: RequestHandler = async ({ request }) => {
	const person = await cloudPerson(request);
	const enabled = await djEnabled();
	return json({
		enabled,
		voices: enabled && Boolean((await openRouterConfig()).apiKey),
		presets: enabled ? await presetsOf(person.id) : []
	});
};
