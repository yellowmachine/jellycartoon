import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { vistaOf, vistaPhotos } from '#lib/server/vista.ts';

/**
 * The Vista's cards (#525), for its resting screen, asked again every few minutes; with `?fotos`
 * (this device chose them), its walks' photos for the background.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	const userId = locals.user!.id;
	const { weather, ...rest } = await vistaOf(userId);
	return json({
		...rest,
		weather: await weather,
		photos: url.searchParams.has('fotos') ? await vistaPhotos(userId) : []
	});
};
