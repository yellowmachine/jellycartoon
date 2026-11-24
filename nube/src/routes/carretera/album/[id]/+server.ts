import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { HouseProblem } from '#lib/server/house.ts';
import { isOwn, ownAlbumTracks } from '#lib/server/road-music.ts';
import { albumTracks } from '#lib/server/music.ts';

/** An album's tracks, in order, to play from the road mode (as jellycartoon's). */
export const GET: RequestHandler = async ({ params, locals, url }) => {
	if (isOwn(url)) return json(await ownAlbumTracks(locals.user!.id, Number(params.id)));
	const who = { id: locals.user!.id, email: locals.user!.email };
	try {
		return json(await albumTracks(who, Number(params.id)));
	} catch (err) {
		if (err instanceof HouseProblem) error(502, err.message);
		throw err;
	}
};
