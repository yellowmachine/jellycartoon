import { fileResponse } from '#lib/server/file-response.ts';
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
import { stationsInfo } from '#lib/server/radio.ts';
import { STATIONS } from '#lib/radio.ts';
import { ERROR, failed, ok } from './protocol.ts';
import {
	albumJson,
	albumKey,
	artistJson,
	artistKey,
	indexLetter,
	loadLibrary,
	matches,
	parseId,
	playlistKey,
	radioKey,
	songJson,
	sortedArtists,
	trackKey,
	type Album,
	type Artist,
	type Library,
	type Stars
} from './library.ts';
import { getStars, star, unstar } from './stars.ts';

/**
 * The Subsonic methods of #27. Phase 1: logging in, browsing, searching and listening. Phase 2: the
 * house's playlists, each user's favourites, and valid answers for the rest of what Tempus asks.
 * The play queue is the web's own, to go on from one to the other.
 */

export interface SubsonicUser {
	id: string;
	name: string;
	email: string;
}

type Method = (
	params: URLSearchParams,
	request: Request,
	user: SubsonicUser
) => Response | Promise<Response>;

const notFound = (what: string) => failed(ERROR.notFound, `${what} no encontrado`);

/** A number parameter within bounds; its default without it. */
function count(params: URLSearchParams, name: string, fallback: number, max = 500) {
	const n = Number(params.get(name) ?? fallback);
	return Number.isInteger(n) && n >= 0 ? Math.min(n, max) : fallback;
}

/** Random order, for the lists that ask for it (Fisher–Yates). */
function shuffled<T>(items: T[]) {
	const copy = [...items];
	for (let i = copy.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[copy[i], copy[j]] = [copy[j], copy[i]];
	}
	return copy;
}

const byName = (a: string, b: string) => a.localeCompare(b, 'es', { sensitivity: 'base' });
const findArtist = (library: Library, name: string) =>
	[...library.artists.values()].find((a) => a.name === name);

/** The artists, grouped by initial: what both getArtists and getIndexes return. */
function index(library: Library, artist: (a: Artist) => object) {
	const groups = new Map<string, object[]>();
	for (const a of sortedArtists(library)) {
		const letter = indexLetter(a.name);
		groups.set(letter, [...(groups.get(letter) ?? []), artist(a)]);
	}
	return [...groups].map(([name, artists]) => ({ name, artist: artists }));
}

/** getAlbumList2's `type`: the ones without data here (plays, ratings, years) give nothing. */
function albumList(library: Library, type: string, stars: Stars): Album[] {
	const albums = [...library.albums.values()];
	switch (type) {
		case 'random':
			return shuffled(albums);
		case 'newest':
			return albums.sort((a, b) => b.created.getTime() - a.created.getTime());
		case 'alphabeticalByName':
			return albums.sort((a, b) => byName(a.title, b.title));
		case 'alphabeticalByArtist':
			return albums.sort((a, b) => byName(a.artist, b.artist) || byName(a.title, b.title));
		case 'starred':
			return albums
				.filter((a) => stars.has(albumKey(a.id)))
				.sort(
					(a, b) => stars.get(albumKey(b.id))!.getTime() - stars.get(albumKey(a.id))!.getTime()
				);
		default:
			return [];
	}
}

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

/** The same answer under the older method's name for it (getAlbumList, search2). */
async function renamed(response: Response | Promise<Response>, from: string, to: string) {
	const body = await (await response).json();
	const r = body['subsonic-response'];
	if (from in r) {
		r[to] = r[from];
		delete r[from];
	}
	return Response.json(body);
}

/** Every value of a repeated parameter that is a track of ours. */
const trackIds = (params: URLSearchParams, name: string) =>
	params.getAll(name).flatMap((value) => {
		const id = parseId(value);
		return id?.kind === 'track' ? [id.id] : [];
	});

export const METHODS: Record<string, Method> = {
	ping: () => ok(),
	getLicense: () => ok({ license: { valid: true } }),
	getOpenSubsonicExtensions: () => ok({ openSubsonicExtensions: [] }),
	getMusicFolders: () => ok({ musicFolders: { musicFolder: [{ id: 1, name: 'Música' }] } }),
	getUser: (_, __, user) =>
		ok({
			user: {
				username: user.email,
				email: user.email,
				scrobblingEnabled: false,
				adminRole: false,
				settingsRole: false,
				downloadRole: true,
				uploadRole: false,
				playlistRole: true,
				coverArtRole: false,
				commentRole: false,
				podcastRole: false,
				streamRole: true,
				jukeboxRole: false,
				shareRole: false,
				videoConversionRole: false,
				folder: [1]
			}
		}),

	getArtists: async (_, __, user) => {
		const [library, stars] = await Promise.all([loadLibrary(), getStars(user.id)]);
		return ok({
			artists: { ignoredArticles: '', index: index(library, (a) => artistJson(a, stars)) }
		});
	},
	getIndexes: async () => {
		const library = await loadLibrary();
		return ok({
			indexes: {
				lastModified: Date.now(),
				ignoredArticles: '',
				index: index(library, (a) => ({ id: artistKey(a.name), name: a.name }))
			}
		});
	},
	/** Browsing by folders: the music folder has the artists, an artist its albums, an album its songs. */
	getMusicDirectory: async (params, _, user) => {
		const [library, stars] = await Promise.all([loadLibrary(), getStars(user.id)]);
		const id = parseId(params.get('id'));
		if (id?.kind === 'artist') {
			const artist = findArtist(library, id.name);
			if (!artist) return notFound('Artista');
			return ok({
				directory: {
					id: artistKey(artist.name),
					name: artist.name,
					child: artist.albums.map((a) => ({
						...albumJson(a, stars),
						parent: artistKey(artist.name)
					}))
				}
			});
		}
		if (id?.kind === 'album') {
			const album = library.albums.get(id.id);
			if (!album) return notFound('Álbum');
			return ok({
				directory: {
					id: albumKey(album.id),
					parent: artistKey(album.artist),
					name: album.title,
					child: album.tracks.map((t) => songJson(t, album, stars))
				}
			});
		}
		return notFound('Carpeta');
	},
	getArtist: async (params, _, user) => {
		const id = parseId(params.get('id'));
		if (id?.kind !== 'artist') return notFound('Artista');
		const [library, stars] = await Promise.all([loadLibrary(), getStars(user.id)]);
		const artist = findArtist(library, id.name);
		if (!artist) return notFound('Artista');
		return ok({
			artist: { ...artistJson(artist, stars), album: artist.albums.map((a) => albumJson(a, stars)) }
		});
	},
	getAlbum: async (params, _, user) => {
		const id = parseId(params.get('id'));
		if (id?.kind !== 'album') return notFound('Álbum');
		const [library, stars] = await Promise.all([loadLibrary(), getStars(user.id)]);
		const album = library.albums.get(id.id);
		if (!album) return notFound('Álbum');
		return ok({
			album: {
				...albumJson(album, stars),
				song: album.tracks.map((t) => songJson(t, album, stars))
			}
		});
	},
	getSong: async (params, _, user) => {
		const id = parseId(params.get('id'));
		if (id?.kind !== 'track') return notFound('Canción');
		const [library, stars] = await Promise.all([loadLibrary(), getStars(user.id)]);
		const track = library.tracks.get(id.id);
		if (!track) return notFound('Canción');
		return ok({ song: songJson(track, library.albums.get(track.albumId)!, stars) });
	},

	getAlbumList2: async (params, _, user) => {
		const type = params.get('type');
		if (!type) return failed(ERROR.missingParameter, 'Falta el parámetro type');
		const [library, stars] = await Promise.all([loadLibrary(), getStars(user.id)]);
		const offset = count(params, 'offset', 0, Number.MAX_SAFE_INTEGER);
		const albums = albumList(library, type, stars).slice(
			offset,
			offset + count(params, 'size', 10)
		);
		return ok({ albumList2: { album: albums.map((a) => albumJson(a, stars)) } });
	},
	getAlbumList: (params, request, user) =>
		renamed(METHODS.getAlbumList2(params, request, user), 'albumList2', 'albumList'),
	getRandomSongs: async (params, _, user) => {
		const [library, stars] = await Promise.all([loadLibrary(), getStars(user.id)]);
		const songs = shuffled([...library.tracks.values()]).slice(0, count(params, 'size', 10));
		return ok({
			randomSongs: { song: songs.map((t) => songJson(t, library.albums.get(t.albumId)!, stars)) }
		});
	},

	/** With an empty query (`""` too), everything, page by page: how some apps sync the library. */
	search3: async (params, _, user) => {
		const [library, stars] = await Promise.all([loadLibrary(), getStars(user.id)]);
		const query = (params.get('query') ?? '').replace(/^"+|"+$/g, '').trim();
		const page = <T>(items: T[], name: string, fallback = 20) => {
			const offset = count(params, `${name}Offset`, 0, Number.MAX_SAFE_INTEGER);
			return items.slice(offset, offset + count(params, `${name}Count`, fallback));
		};
		const artists = sortedArtists(library).filter((a) => !query || matches(a.name, query));
		const albums = [...library.albums.values()].filter(
			(a) => !query || matches(`${a.title} ${a.artist}`, query)
		);
		const songs = [...library.tracks.values()].filter((t) => {
			if (!query) return true;
			const a = library.albums.get(t.albumId)!;
			return matches(`${t.title} ${t.artist} ${a.title}`, query);
		});
		return ok({
			searchResult3: {
				artist: page(artists, 'artist').map((a) => artistJson(a, stars)),
				album: page(albums, 'album').map((a) => albumJson(a, stars)),
				song: page(songs, 'song').map((t) => songJson(t, library.albums.get(t.albumId)!, stars))
			}
		});
	},
	search2: (params, request, user) =>
		renamed(METHODS.search3(params, request, user), 'searchResult3', 'searchResult2'),

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
	/** The FLAC as it is, with Range so the app can seek. */
	stream: async (params, request) => {
		const id = parseId(params.get('id'));
		const track = id?.kind === 'track' ? (await loadLibrary()).tracks.get(id.id) : undefined;
		if (!track) return new Response('Canción no encontrada', { status: 404 });
		return fileResponse(request, musicFile(track.path), 'audio/flac', 'private, max-age=86400');
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

	// Valid answers without data behind them yet: nothing is broken by asking.
	scrobble: () => ok(),
	setRating: () => ok(),
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
	getNowPlaying: () => ok({ nowPlaying: { entry: [] } }),
	getGenres: () => ok({ genres: { genre: [] } }),
	getSongsByGenre: () => ok({ songsByGenre: { song: [] } }),
	getTopSongs: () => ok({ topSongs: { song: [] } }),
	getSimilarSongs: () => ok({ similarSongs: { song: [] } }),
	getSimilarSongs2: () => ok({ similarSongs2: { song: [] } }),
	getArtistInfo: () => ok({ artistInfo: {} }),
	getArtistInfo2: () => ok({ artistInfo2: {} }),
	getAlbumInfo: () => ok({ albumInfo: {} }),
	getAlbumInfo2: () => ok({ albumInfo: {} }),
	getLyrics: () => ok({ lyrics: {} }),
	getBookmarks: () => ok({ bookmarks: { bookmark: [] } }),
	getShares: () => ok({ shares: { share: [] } }),
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
	},
	getPodcasts: () => ok({ podcasts: { channel: [] } }),
	getNewestPodcasts: () => ok({ newestPodcasts: { episode: [] } }),
	getScanStatus: () => ok({ scanStatus: { scanning: false } })
};
