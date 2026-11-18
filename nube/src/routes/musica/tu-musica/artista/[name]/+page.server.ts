import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { withFamily } from '#lib/server/family.ts';
import { ownCatalog } from '#lib/server/own-music.ts';
import { ownPlaylists } from '#lib/server/own-music-lists.ts';
import { fold } from 'comun/music.ts';

/** An artist of «Tu música» (#534): their albums, and their songs in others', as the house's. */
export const load: PageServerLoad = async ({ params, locals }) => {
	const familyId = await withFamily(locals.user!.id, async (_, m) => m.familyId);
	const key = fold(params.name);
	const all = await ownCatalog(familyId);
	const albums = all.filter((a) => fold(a.artist) === key);
	// Their songs in other artists' albums, e.g. compilations («Varios artistas»).
	const appearsOn = all
		.filter((a) => fold(a.artist) !== key && a.tracks.some((t) => fold(t.artist) === key))
		.map((a) => ({ ...a, tracks: a.tracks.filter((t) => fold(t.artist) === key) }));
	if (!albums.length && !appearsOn.length) error(404, 'Artista no encontrado');
	return {
		name: albums[0]?.artist ?? appearsOn[0]!.tracks[0]!.artist,
		albums,
		appearsOn,
		ownLists: (await ownPlaylists(familyId)).map(({ id, name }) => ({ id, name }))
	};
};
