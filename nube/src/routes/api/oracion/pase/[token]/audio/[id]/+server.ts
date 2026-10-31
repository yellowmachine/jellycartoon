import type { RequestHandler } from './$types';
import { passKitchen, prayerAudio } from '#lib/server/prayer-pages.ts';

/**
 * A text's recording (#339) with the family's pass in its path, without a session: for the house's
 * mpv, which plays it on Snapcast (prayer-pages.ts, `passAudioUrls`).
 */
export const GET: RequestHandler = async ({ params, request }) =>
	prayerAudio(await passKitchen(params.token), Number(params.id), request);
