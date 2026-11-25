import {
	browseMethods,
	emptyMethods,
	findArtist,
	type Method,
	type SubsonicUser
} from 'comun/server/subsonic/browse.ts';
import { fileResponse } from 'comun/server/file-response.ts';
import { albumCoverFile, musicFile } from '#lib/server/library/paths.ts';
import {
	createPlaylist,
	deletePlaylist,
	getPlaylist,
	listPlaylists,
	addToPlaylist,
	removeFromPlaylist,
	renamePlaylist,
	replacePlaylistTracks
} from '#lib/server/music/playlists.ts';
import { clearQueue, getQueue, saveQueue } from '#lib/server/music/queue.ts';
import { audioType } from '#lib/server/music/tags.ts';
import { stationsInfo } from '#lib/server/radio.ts';
import { STATIONS } from 'comun/radio.ts';
import { ERROR, failed, ok } from './protocol.ts';
import {
	JSON_OF,
	albumJson,
	ids,
	albumKey,
	artistJson,
	loadLibrary,
	parseId,
	playlistKey,
	radioKey,
	songJson,
	trackKey,
	type Library,
	type Stars
} from './library.ts';
import { getStars, star, unstar } from './stars.ts';

/**
 * The Subsonic methods of #27. Phase 1: logging in, browsing, searching and listening. Phase 2: the
 * house's playlists, each user's favourites, and valid answers for the rest of what Tempus asks.
 * The play queue is the web's own, to go on from one to the other.
 */

export type { SubsonicUser };

const notFound = (what: string) => failed(ERROR.notFound, `${what} no encontrado`);

/** What the user marked, still in the library: artists, albums and tracks. */
function starred(library: Library, stars: Stars) {
	const newest = (a: string, b: string) => stars.get(b)!.getTime() - stars.get(a)!.getTime();
	const keys = [...stars.keys()].sort(newest);
	return {
		artist: keys.flatMap((key) => {
			const id = parseId(key);
			const artist = id?.kind === 'artist' ? findArtist(library, id.name) : undefined;
			return artist ? [artistJson(artist, stars)] : [];
		}),
		album: keys.flatMap((key) => {
			const id = parseId(key);
			const album = id?.kind === 'album' ? library.albums.get(id.id) : undefined;
			return album ? [albumJson(album, stars)] : [];
		}),
		song: keys.flatMap((key) => {
			const id = parseId(key);
			const track = id?.kind === 'track' ? library.tracks.get(id.id) : undefined;
			return track ? [songJson(track, library.albums.get(track.albumId)!, stars)] : [];
		})
	};
}

/** A playlist as the protocol has it, with its tracks or without. The house's: nobody owns them. */
async function playlistJson(id: number, user: SubsonicUser, stars: Stars, withEntries: boolean) {
	const [playlist, library] = await Promise.all([getPlaylist(id), loadLibrary()]);
	if (!playlist) return null;
	const tracks = playlist.items.flatMap((i) => library.tracks.get(i.track.id) ?? []);
	const cover = tracks.map((t) => library.albums.get(t.albumId)!).find((a) => a.hasCover);
	return {
		id: playlistKey(playlist.id),
		name: playlist.name,
		owner: user.email,
		public: true,
		songCount: tracks.length,
		duration: Math.round(tracks.reduce((s, t) => s + (t.durationSec ?? 0), 0)),
		created: new Date(0).toISOString(),
		changed: new Date().toISOString(),
		coverArt: cover ? albumKey(cover.id) : undefined,
		entry: withEntries
			? tracks.map((t) => songJson(t, library.albums.get(t.albumId)!, stars))
			: undefined
	};
}

/** Every value of a repeated parameter that is a track of ours. */
const trackIds = (params: URLSearchParams, name: string) =>
	params.getAll(name).flatMap((value) => {
		const id = parseId(value);
		return id?.kind === 'track' ? [id.id] : [];
	});

export const METHODS: Record<string, Method> = {
	...browseMethods({
		answers: { ok, failed },
		ids,
		toJson: JSON_OF,
		load: loadLibrary,
		stars: (user) => getStars(user.id)
	}),
	...emptyMethods({ ok, failed }),

	/** An album's cover, also by one of its tracks. The size asked for is ignored: they are 500 px. */
	getCoverArt: async (params, request) => {
		const id = parseId(params.get('id'));
		const library = await loadLibrary();
		const albumId =
			id?.kind === 'album'
				? id.id
				: id?.kind === 'track'
					? library.tracks.get(id.id)?.albumId
					: undefined;
		const album = albumId === undefined ? undefined : library.albums.get(albumId);
		if (!album?.hasCover) return new Response('Sin portada', { status: 404 });
		return fileResponse(request, albumCoverFile(album.id), 'image/jpeg', 'private, max-age=86400');
	},
	/** The file as it is (FLAC or Opus), with Range so the app can seek. */
	stream: async (params, request) => {
		const id = parseId(params.get('id'));
		const track = id?.kind === 'track' ? (await loadLibrary()).tracks.get(id.id) : undefined;
		if (!track) return new Response('Canción no encontrada', { status: 404 });
		return fileResponse(
			request,
			musicFile(track.path),
			audioType(track.path),
			'private, max-age=86400'
		);
	},
	download: (params, request, user) => METHODS.stream(params, request, user),

	// Favourites, each user's: `id` (tracks), `albumId` and `artistId`, each one repeated.
	star: async (params, _, user) => {
		await star(
			user.id,
			[...params.getAll('id'), ...params.getAll('albumId'), ...params.getAll('artistId')].filter(
				(id) => parseId(id)
			)
		);
		return ok();
	},
	unstar: async (params, _, user) => {
		await unstar(user.id, [
			...params.getAll('id'),
			...params.getAll('albumId'),
			...params.getAll('artistId')
		]);
		return ok();
	},
	getStarred2: async (_, __, user) => {
		const [library, stars] = await Promise.all([loadLibrary(), getStars(user.id)]);
		return ok({ starred2: starred(library, stars) });
	},
	getStarred: async (_, __, user) => {
		const [library, stars] = await Promise.all([loadLibrary(), getStars(user.id)]);
		return ok({ starred: starred(library, stars) });
	},

	// The house's playlists, the same as on the Música pages.
	getPlaylists: async (_, __, user) => {
		const stars = await getStars(user.id);
		const lists = await listPlaylists();
		const playlists = await Promise.all(lists.map((p) => playlistJson(p.id, user, stars, false)));
		return ok({ playlists: { playlist: playlists.filter(Boolean) } });
	},
	getPlaylist: async (params, _, user) => {
		const id = parseId(params.get('id'));
		if (id?.kind !== 'playlist') return notFound('Lista');
		const playlist = await playlistJson(id.id, user, await getStars(user.id), true);
		return playlist ? ok({ playlist }) : notFound('Lista');
	},
	/** A new one with `name`, or, with `playlistId`, that one with exactly these tracks. */
	createPlaylist: async (params, _, user) => {
		const songs = trackIds(params, 'songId');
		const existing = parseId(params.get('playlistId'));
		let id: number;
		if (existing?.kind === 'playlist') {
			if (!(await getPlaylist(existing.id))) return notFound('Lista');
			id = existing.id;
			const name = params.get('name')?.trim();
			if (name) await renamePlaylist(id, name);
		} else {
			const name = params.get('name')?.trim();
			if (!name) return failed(ERROR.missingParameter, 'Falta el nombre de la lista (name)');
			id = await createPlaylist(name);
		}
		await replacePlaylistTracks(id, songs);
		return ok({ playlist: await playlistJson(id, user, await getStars(user.id), true) });
	},
	/** Rename, add at the end (`songIdToAdd`) and remove by position (`songIndexToRemove`). */
	updatePlaylist: async (params) => {
		const id = parseId(params.get('playlistId'));
		const playlist = id?.kind === 'playlist' ? await getPlaylist(id.id) : null;
		if (!playlist) return notFound('Lista');
		const name = params.get('name')?.trim();
		if (name) await renamePlaylist(playlist.id, name);
		// The positions are those of the tracks the app saw: highest first, so the rest stay put.
		const remove = params
			.getAll('songIndexToRemove')
			.map(Number)
			.filter((i) => Number.isInteger(i) && i >= 0 && i < playlist.items.length)
			.sort((a, b) => b - a);
		for (const i of new Set(remove))
			await removeFromPlaylist(playlist.id, playlist.items[i].itemId);
		for (const trackId of trackIds(params, 'songIdToAdd'))
			await addToPlaylist(playlist.id, trackId);
		return ok();
	},
	deletePlaylist: async (params) => {
		const id = parseId(params.get('id'));
		if (id?.kind !== 'playlist' || !(await getPlaylist(id.id))) return notFound('Lista');
		await deletePlaylist(id.id);
		return ok();
	},

	// The same queue as the web's: what was playing in the browser goes on in the app, and back.
	savePlayQueue: async (params, _, user) => {
		const ids = trackIds(params, 'id');
		if (!ids.length) {
			await clearQueue(user.id);
			return ok();
		}
		const current = parseId(params.get('current'));
		const index = current?.kind === 'track' ? Math.max(ids.indexOf(current.id), 0) : 0;
		const position = Number(params.get('position') ?? 0);
		await saveQueue(user.id, {
			trackIds: ids,
			index,
			positionSec: Number.isFinite(position) && position > 0 ? position / 1000 : 0,
			shuffle: false,
			repeat: false,
			single: false,
			radio: null,
			podcast: null,
			changedBy: params.get('c')?.trim().slice(0, 50) || 'una app'
		});
		return ok();
	},
	getPlayQueue: async (_, __, user) => {
		const queue = await getQueue(user.id);
		// A station or a podcast is not something a play queue can hold.
		if (!queue || queue.radioUuid || queue.podcastEpisodeId) return ok();
		const [library, stars] = await Promise.all([loadLibrary(), getStars(user.id)]);
		const entry = queue.trackIds.flatMap((id) => {
			const t = library.tracks.get(id);
			return t ? [songJson(t, library.albums.get(t.albumId)!, stars)] : [];
		});
		if (!entry.length) return ok();
		const currentId = queue.trackIds[queue.currentIndex];
		return ok({
			playQueue: {
				current: library.tracks.has(currentId) ? trackKey(currentId) : entry[0].id,
				position: Math.round(queue.positionSec * 1000),
				username: user.email,
				changed: queue.updatedAt.toISOString(),
				changedBy: queue.changedBy,
				entry
			}
		});
	},
	/**
	 * JellyCartoon's stations, each at /rest/radio/<uuid> with the same login as this request: where
	 * it streams is looked up when it is played, so a station that moves keeps working. The HLS ones
	 * end in `.m3u8`, which is how Tempus knows to open them as HLS.
	 */
	getInternetRadioStations: async (params, request) => {
		const info = await stationsInfo();
		const login = new URLSearchParams();
		for (const key of ['u', 't', 's', 'p', 'v', 'c'])
			if (params.get(key)) login.set(key, params.get(key)!);
		return ok({
			internetRadioStations: {
				internetRadioStation: STATIONS.map((s) => {
					const file = `${s.uuid}${info?.[s.uuid]?.hls ? '.m3u8' : ''}`;
					const url = new URL(`/rest/radio/${file}?${login}`, request.url);
					return { id: radioKey(s.uuid), name: s.name, streamUrl: url.href };
				})
			}
		});
	}
};
