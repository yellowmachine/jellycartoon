import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { fold } from '#lib/music.ts';
import { musicRoot } from '#lib/server/library/paths.ts';
import { getAlbums } from '#lib/server/music/albums.ts';

export const load: PageServerLoad = async ({ params }) => {
	if (!musicRoot) error(404, 'No hay carpeta de música (MUSIC_DIR)');
	const key = fold(params.name);
	const all = await getAlbums();
	const albums = all.filter((a) => fold(a.artist) === key);
	// Their songs in other artists' albums, e.g. compilations («Varios artistas»).
	const appearsOn = all
		.filter((a) => fold(a.artist) !== key)
		.flatMap((a) => a.tracks.filter((t) => fold(t.artist) === key));
	if (!albums.length && !appearsOn.length) error(404, 'Artista no encontrado');
	return { name: albums[0]?.artist ?? appearsOn[0].artist, albums, appearsOn };
};
