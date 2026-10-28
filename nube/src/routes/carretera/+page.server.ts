import { access } from 'node:fs/promises';
import path from 'node:path';
import type { PageServerLoad } from './$types';
import { MAP_DIR } from '$app/env/private';
import type { SavedPlace, SavedRoute } from 'comun/saved-places.ts';
import { HouseProblem } from '#lib/server/house.ts';
import { albums, musicPass, playlists } from '#lib/server/music.ts';
import { stationsInfo } from '#lib/server/radio.ts';

/** Whether there is a map (scripts/mapa.sh, in MAP_DIR): shown beside, with the screen wide enough. */
const hasMap = () =>
	access(path.join(MAP_DIR, 'espana.pmtiles')).then(
		() => true,
		() => false
	);

/**
 * The road mode (#253), as jellycartoon's: the house's albums and playlists (through its tunnel),
 * the radio, and the map. Without the house (off, or not connected), the radio and the map still
 * work. The places and routes kept, with Viajes (later).
 */
export const load: PageServerLoad = async ({ locals }) => {
	const who = { id: locals.user!.id, email: locals.user!.email };
	const [info, map] = await Promise.all([stationsInfo(), hasMap()]);
	const kept = { places: [] as SavedPlace[], routes: [] as SavedRoute[] };
	try {
		const [albumList, playlistList, pass] = await Promise.all([
			albums(who),
			playlists(who),
			musicPass(who)
		]);
		return {
			albums: albumList,
			playlists: playlistList,
			pass,
			problem: null,
			info,
			map,
			...kept
		};
	} catch (error) {
		if (!(error instanceof HouseProblem)) throw error;
		return { albums: [], playlists: [], pass: null, problem: error.message, info, map, ...kept };
	}
};
