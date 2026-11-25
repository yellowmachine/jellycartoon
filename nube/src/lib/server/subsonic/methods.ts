import { browseMethods, emptyMethods, type Method } from 'comun/server/subsonic/browse.ts';
import { answers } from 'comun/server/subsonic/protocol.ts';
import { asFamily } from '../family.ts';
import { coverOf, trackAddress } from '../own-music.ts';
import { fileResponse } from '../storage.ts';
import { ids, libraries, readLibrary, toJson } from './library.ts';
import type { AppUser } from './auth.ts';

/**
 * Seilide's Subsonic methods (#625), for the family's bucket («Tu música»). Phase 1: logging in,
 * browsing, searching and listening. Everything, the asking person's family's: what an id points to
 * is looked for inside it (RLS).
 */

/** Seilide does not say its version to whoever asks. */
export const { ok, failed } = answers('seilide', '1');

export const libraryOf = libraries((familyId) => asFamily(familyId, readLibrary));
const familyOf = (user: object) => (user as AppUser).familyId;

/** To the bucket, by an address signed now: never kept, or it would be used once expired. */
const toBucket = (url: string) =>
	new Response(null, { status: 302, headers: { location: url, 'cache-control': 'no-store' } });

const METHODS: Record<string, Method> = {
	...browseMethods({
		answers: { ok, failed },
		ids,
		toJson,
		load: async (user) =>
			(await libraryOf(familyOf(user))) ?? {
				albums: new Map(),
				tracks: new Map(),
				artists: new Map()
			},
		// Favourites and lists, in phase 2.
		stars: async () => new Map()
	}),
	...emptyMethods({ ok, failed }),
	getStarred: () => ok({ starred: {} }),
	getStarred2: () => ok({ starred2: {} }),
	getPlaylists: () => ok({ playlists: { playlist: [] } }),
	getPlayQueue: () => ok(),
	savePlayQueue: () => ok(),
	getInternetRadioStations: () => ok({ internetRadioStations: { internetRadioStation: [] } }),

	/** An album's cover, also by one of its tracks, whatever the size asked for. */
	getCoverArt: async (params, _, user) => {
		const familyId = familyOf(user);
		const id = ids.parse(params.get('id'));
		const albumId =
			id?.kind === 'album'
				? id.id
				: id?.kind === 'track'
					? (await libraryOf(familyId))?.tracks.get(id.id)?.albumId
					: undefined;
		const cover = albumId === undefined ? null : await coverOf(familyId, albumId);
		if (!cover) return new Response('Sin portada', { status: 404 });
		if (cover.url !== undefined) return toBucket(cover.url);
		return fileResponse(familyId, cover.area, cover.file, cover.type);
	},
	/** The file as it is, from the bucket; whatever format or bit rate is asked for. */
	stream: async (params, _, user) => {
		const id = ids.parse(params.get('id'));
		const url = id?.kind === 'track' ? await trackAddress(familyOf(user), id.id) : null;
		return url ? toBucket(url) : new Response('Canción no encontrada', { status: 404 });
	},
	download: (params, request, user) => METHODS.stream!(params, request, user)
};

export const methodOf = (name: string): Method | undefined =>
	Object.hasOwn(METHODS, name) ? METHODS[name] : undefined;
