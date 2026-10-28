import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { HouseProblem } from '#lib/server/house.ts';
import { catalog } from '#lib/server/music.ts';
import { fold } from 'comun/music.ts';

/** An artist's albums, and their songs in others' (#253), from the house's catalog. */
export const load: PageServerLoad = async ({ params, locals }) => {
	const key = fold(params.name);
	let all;
	try {
		all = await catalog({ id: locals.user!.id, email: locals.user!.email });
	} catch (err) {
		if (err instanceof HouseProblem) error(404, err.message);
		throw err;
	}
	const albums = all.filter((a) => fold(a.artist) === key);
	// Their songs in other artists' albums, e.g. compilations («Varios artistas»).
	const appearsOn = all
		.filter((a) => fold(a.artist) !== key)
		.flatMap((a) => a.tracks.filter((t) => fold(t.artist) === key));
	if (!albums.length && !appearsOn.length) error(404, 'Artista no encontrado');
	return { name: albums[0]?.artist ?? appearsOn[0]!.artist, albums, appearsOn };
};
