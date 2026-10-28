import type { PageServerLoad } from './$types';
import { HouseProblem } from '#lib/server/house.ts';
import { albums, musicPass, playlists } from '#lib/server/music.ts';
import { stationsInfo } from '#lib/server/radio.ts';

/**
 * The road mode (#253), for now only music, as jellycartoon's: the house's albums and playlists
 * (through its tunnel), and the radio. Without the house (off, or not connected), the radio still
 * plays.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const who = { id: locals.user!.id, email: locals.user!.email };
	const info = stationsInfo();
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
			info: await info
		};
	} catch (error) {
		if (!(error instanceof HouseProblem)) throw error;
		return { albums: [], playlists: [], pass: null, problem: error.message, info: await info };
	}
};
