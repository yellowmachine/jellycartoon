import { access } from 'node:fs/promises';
import path from 'node:path';
import type { PageServerLoad } from './$types';
import { MAP_DIR } from '$app/env/private';
import { askHouse, HouseProblem } from '#lib/server/house.ts';
import { albums, musicPass, playlists } from '#lib/server/music.ts';
import { stationsInfo } from '#lib/server/radio.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import { podcastLists } from '#lib/server/podcasts/podcasts.ts';
import { listSavedPlaces, listSavedRoutes } from '#lib/server/trips/places.ts';
import { recordsTrips } from '#lib/server/trips/trips.ts';

/** Whether there is a map (scripts/mapa.sh, in MAP_DIR): shown beside, with the screen wide enough. */
const hasMap = () =>
	access(path.join(MAP_DIR, 'espana.pmtiles')).then(
		() => true,
		() => false
	);

/**
 * The road mode (#253), as jellycartoon's: the house's albums and playlists (through its tunnel),
 * the radio, the family's podcasts (each with its newest episode), and the map. Without the house
 * (off, or not connected), the radio, the podcasts and the map still work. And Viajes': the
 * places and routes kept with a name, and whether this trip is kept (#81).
 */
export const load: PageServerLoad = async ({ locals }) => {
	const who = { id: locals.user!.id, email: locals.user!.email };
	const k = await kitchenOf(locals.user!.id);
	const [info, map, lists, places, routes, recordTrips] = await Promise.all([
		stationsInfo(),
		hasMap(),
		podcastLists(k),
		listSavedPlaces(k),
		listSavedRoutes(k),
		recordsTrips(k)
	]);
	const kept = {
		places,
		routes,
		recordTrips,
		podcasts: lists.podcasts.flatMap((p) => (p.latest ? [{ ...p, latest: p.latest }] : [])),
		inProgress: lists.inProgress
	};
	try {
		const [albumList, playlistList, pass, telegram] = await Promise.all([
			albums(who),
			playlists(who),
			musicPass(who),
			// Their own Telegram, the house's (#243): its messages read aloud here.
			askHouse<{ connected: boolean }>(who.id, who.email, '/telegram').then(
				(t) => t.connected,
				() => false
			)
		]);
		return {
			albums: albumList,
			playlists: playlistList,
			pass,
			telegram,
			problem: null,
			info,
			map,
			...kept
		};
	} catch (error) {
		if (!(error instanceof HouseProblem)) throw error;
		return {
			albums: [],
			playlists: [],
			pass: null,
			telegram: false,
			problem: error.message,
			info,
			map,
			...kept
		};
	}
};
