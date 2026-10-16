import { fileResponse } from '#lib/server/file-response.ts';
import { albumCoverFile, musicFile } from '#lib/server/library/paths.ts';
import { ERROR, failed, ok } from './protocol.ts';
import {
	albumJson,
	artistJson,
	indexLetter,
	loadLibrary,
	matches,
	parseId,
	songJson,
	sortedArtists,
	type Album,
	type Library
} from './library.ts';

/** The phase 1 of #27: logging in, browsing, searching and listening. */

type Method = (params: URLSearchParams, request: Request) => Response | Promise<Response>;

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

const songsOf = (library: Library) =>
	[...library.tracks.values()].map((t) => songJson(t, library.albums.get(t.albumId)!));

/** The artists, grouped by initial: what both getArtists and getIndexes return. */
function index(library: Library, artist: (a: ReturnType<typeof sortedArtists>[number]) => object) {
	const groups = new Map<string, object[]>();
	for (const a of sortedArtists(library)) {
		const letter = indexLetter(a.name);
		groups.set(letter, [...(groups.get(letter) ?? []), artist(a)]);
	}
	return [...groups].map(([name, artists]) => ({ name, artist: artists }));
}

/** getAlbumList2's `type`: the ones without data here (plays, ratings, years) give nothing. */
function albumList(library: Library, type: string): Album[] {
	const albums = [...library.albums.values()];
	const by = (a: string, b: string) => a.localeCompare(b, 'es', { sensitivity: 'base' });
	switch (type) {
		case 'random':
			return shuffled(albums);
		case 'newest':
			return albums.sort((a, b) => b.created.getTime() - a.created.getTime());
		case 'alphabeticalByName':
			return albums.sort((a, b) => by(a.title, b.title));
		case 'alphabeticalByArtist':
			return albums.sort((a, b) => by(a.artist, b.artist) || by(a.title, b.title));
		default:
			return [];
	}
}

export const METHODS: Record<string, Method> = {
	ping: () => ok(),
	getLicense: () => ok({ license: { valid: true } }),
	getOpenSubsonicExtensions: () => ok({ openSubsonicExtensions: [] }),
	getMusicFolders: () => ok({ musicFolders: { musicFolder: [{ id: 1, name: 'Música' }] } }),

	getArtists: async () => {
		const library = await loadLibrary();
		return ok({ artists: { ignoredArticles: '', index: index(library, artistJson) } });
	},
	getIndexes: async () => {
		const library = await loadLibrary();
		return ok({
			indexes: {
				lastModified: Date.now(),
				ignoredArticles: '',
				index: index(library, (a) => ({ id: artistJson(a).id, name: a.name }))
			}
		});
	},
	getArtist: async (params) => {
		const id = parseId(params.get('id'));
		if (id?.kind !== 'artist') return notFound('Artista');
		const library = await loadLibrary();
		const artist = [...library.artists.values()].find((a) => a.name === id.name);
		if (!artist) return notFound('Artista');
		return ok({ artist: { ...artistJson(artist), album: artist.albums.map(albumJson) } });
	},
	getAlbum: async (params) => {
		const id = parseId(params.get('id'));
		if (id?.kind !== 'album') return notFound('Álbum');
		const album = (await loadLibrary()).albums.get(id.id);
		if (!album) return notFound('Álbum');
		return ok({
			album: { ...albumJson(album), song: album.tracks.map((t) => songJson(t, album)) }
		});
	},
	getSong: async (params) => {
		const id = parseId(params.get('id'));
		if (id?.kind !== 'track') return notFound('Canción');
		const library = await loadLibrary();
		const track = library.tracks.get(id.id);
		if (!track) return notFound('Canción');
		return ok({ song: songJson(track, library.albums.get(track.albumId)!) });
	},

	getAlbumList2: async (params) => {
		const type = params.get('type');
		if (!type) return failed(ERROR.missingParameter, 'Falta el parámetro type');
		const library = await loadLibrary();
		const offset = count(params, 'offset', 0, Number.MAX_SAFE_INTEGER);
		const albums = albumList(library, type).slice(offset, offset + count(params, 'size', 10));
		return ok({ albumList2: { album: albums.map(albumJson) } });
	},
	getRandomSongs: async (params) => {
		const songs = shuffled(songsOf(await loadLibrary())).slice(0, count(params, 'size', 10));
		return ok({ randomSongs: { song: songs } });
	},

	/** With an empty query (`""` too), everything, page by page: how some apps sync the library. */
	search3: async (params) => {
		const library = await loadLibrary();
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
				artist: page(artists, 'artist').map(artistJson),
				album: page(albums, 'album').map(albumJson),
				song: page(songs, 'song').map((t) => songJson(t, library.albums.get(t.albumId)!))
			}
		});
	},

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
	/** The FLAC as it is, with Range so the app can seek; converting it comes in phase 3. */
	stream: async (params, request) => {
		const id = parseId(params.get('id'));
		const track = id?.kind === 'track' ? (await loadLibrary()).tracks.get(id.id) : undefined;
		if (!track) return new Response('Canción no encontrada', { status: 404 });
		return fileResponse(request, musicFile(track.path), 'audio/flac', 'private, max-age=86400');
	},
	download: (params, request) => METHODS.stream(params, request),

	// What apps ask for on starting, and comes later (phase 2): valid, and empty.
	getStarred: () => ok({ starred: {} }),
	getStarred2: () => ok({ starred2: {} }),
	getGenres: () => ok({ genres: { genre: [] } }),
	getPlaylists: () => ok({ playlists: { playlist: [] } }),
	getNowPlaying: () => ok({ nowPlaying: { entry: [] } }),
	getPlayQueue: () => ok(),
	getInternetRadioStations: () => ok({ internetRadioStations: { internetRadioStation: [] } }),
	getPodcasts: () => ok({ podcasts: { channel: [] } }),
	getNewestPodcasts: () => ok({ newestPodcasts: { episode: [] } }),
	getScanStatus: () => ok({ scanStatus: { scanning: false } })
};
