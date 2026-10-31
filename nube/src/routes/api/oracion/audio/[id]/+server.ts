import type { RequestHandler } from './$types';
import { prayerAudio, prayerKitchen } from '#lib/server/prayer-pages.ts';

/** A text's recording (#339), for its family's pages (prayer-pages.ts). */
export const GET: RequestHandler = async ({ params, locals, request }) =>
	prayerAudio(await prayerKitchen(locals), Number(params.id), request);
