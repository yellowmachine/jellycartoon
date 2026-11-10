import { access } from 'node:fs/promises';
import path from 'node:path';
import type { PageServerLoad } from './$types';
import { MAP_DIR } from '$app/env/private';
import { askHouse, HouseProblem } from '#lib/server/house.ts';
import { albums, djInfo, musicPass, playlists } from '#lib/server/music.ts';
import { stationsInfo } from '#lib/server/radio.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import { podcastLists } from '#lib/server/podcasts/podcasts.ts';
import { listSavedPlaces, listSavedRoutes } from '#lib/server/trips/places.ts';
import { recordsTrips } from '#lib/server/trips/trips.ts';
import { KEPT_SOURCE } from '#lib/offline-pages.ts';
import { calls } from '#lib/server/calls.ts';

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
 *
 * `?guardada`: as the service worker keeps it, to open with no network (offline-pages.ts): only
 * what works without, the lists this device carries, the map (along the routes it keeps), the
 * places and routes. Nothing of the house's, nor the radio's or the podcasts'.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const who = { id: locals.user!.id, email: locals.user!.email };
	const k = await kitchenOf(locals.user!.id);
	if (url.searchParams.has(KEPT_SOURCE)) {
		const [map, places, routes, recordTrips] = await Promise.all([
			hasMap(),
			listSavedPlaces(k),
			listSavedRoutes(k),
			recordsTrips(k)
		]);
		return {
			albums: [],
			playlists: [],
			pass: null,
			dj: false,
			djPresets: [],
			telegram: false,
			problem: null,
			info: null,
			map,
			places,
			routes,
			recordTrips,
			podcasts: [],
			inProgress: [],
			callable: []
		};
	}
	const [info, map, lists, places, routes, recordTrips, callable] = await Promise.all([
		stationsInfo(),
		hasMap(),
		podcastLists(k),
		listSavedPlaces(k),
		listSavedRoutes(k),
		recordsTrips(k),
		// Who of the family to call from the car (#330).
		calls.callable(locals.user!.id)
	]);
	const kept = {
		places,
		routes,
		recordTrips,
		callable,
		podcasts: lists.podcasts.flatMap((p) => (p.latest ? [{ ...p, latest: p.latest }] : [])),
		inProgress: lists.inProgress
	};
	try {
		const [albumList, playlistList, pass, dj, telegram] = await Promise.all([
			albums(who),
			playlists(who),
			musicPass(who),
			// Modo DJ, the house's, with this person's saved setups.
			djInfo(who),
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
			dj: dj.enabled,
			djPresets: dj.presets,
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
			dj: false,
			djPresets: [],
			telegram: false,
			problem: error.message,
			info,
			map,
			...kept
		};
	}
};
