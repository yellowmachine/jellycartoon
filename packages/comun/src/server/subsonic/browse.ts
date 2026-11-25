import {
	indexLetter,
	matches,
	sortedArtists,
	type Album,
	type Artist,
	type Ids,
	type Json,
	type Library,
	type Stars
} from './library.ts';
import { ERROR, type Answers } from './protocol.ts';

/**
 * The Subsonic methods that only look at a library: logging in, browsing and searching. The house's
 * and Seilide's add their own (listening, covers, lists…).
 */

export interface SubsonicUser {
	id: string;
	name: string;
	email: string;
}

export type Method = (
	params: URLSearchParams,
	request: Request,
	user: SubsonicUser
) => Response | Promise<Response>;

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
export const findArtist = (library: Library, name: string) =>
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
function albumList(library: Library, type: string, stars: Stars, ids: Ids): Album[] {
	const albums = [...library.albums.values()];
	switch (type) {
		case 'random':
			return shuffled(albums);
		case 'newest':
			return albums.sort((a, b) => b.created.getTime() - a.created.getTime() || b.id - a.id);
		case 'alphabeticalByName':
			return albums.sort((a, b) => byName(a.title, b.title));
		case 'alphabeticalByArtist':
			return albums.sort((a, b) => byName(a.artist, b.artist) || byName(a.title, b.title));
		case 'starred':
			return albums
				.filter((a) => stars.has(ids.album(a.id)))
				.sort(
					(a, b) => stars.get(ids.album(b.id))!.getTime() - stars.get(ids.album(a.id))!.getTime()
				);
		default:
			return [];
	}
}

/** The same answer under the older method's name for it (getAlbumList, search2). */
export async function renamed(response: Response | Promise<Response>, from: string, to: string) {
	const body = await (await response).json();
	const r = body['subsonic-response'];
	if (from in r) {
		r[to] = r[from];
		delete r[from];
	}
	return Response.json(body);
}

export interface Browse {
	answers: Answers;
	ids: Ids;
	toJson: Json;
	load: (user: SubsonicUser) => Promise<Library>;
	/** The user's favourites; none yet, an empty map. */
	stars: (user: SubsonicUser) => Promise<Stars>;
}

export function browseMethods({ answers, ids, toJson, load, stars }: Browse) {
	const { ok, failed } = answers;
	const notFound = (what: string) => failed(ERROR.notFound, `${what} no encontrado`);

	const METHODS: Record<string, Method> = {
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
			const [library, starred] = await Promise.all([load(user), stars(user)]);
			return ok({
				artists: { ignoredArticles: '', index: index(library, (a) => toJson.artist(a, starred)) }
			});
		},
		getIndexes: async (_, __, user) => {
			const library = await load(user);
			return ok({
				indexes: {
					lastModified: Date.now(),
					ignoredArticles: '',
					index: index(library, (a) => ({ id: ids.artist(a.name), name: a.name }))
				}
			});
		},
		/** Browsing by folders: the music folder has the artists, an artist its albums, an album its songs. */
		getMusicDirectory: async (params, _, user) => {
			const [library, starred] = await Promise.all([load(user), stars(user)]);
			const id = ids.parse(params.get('id'));
			if (id?.kind === 'artist') {
				const artist = findArtist(library, id.name);
				if (!artist) return notFound('Artista');
				return ok({
					directory: {
						id: ids.artist(artist.name),
						name: artist.name,
						child: artist.albums.map((a) => ({
							...toJson.album(a, starred),
							parent: ids.artist(artist.name)
						}))
					}
				});
			}
			if (id?.kind === 'album') {
				const album = library.albums.get(id.id);
				if (!album) return notFound('Álbum');
				return ok({
					directory: {
						id: ids.album(album.id),
						parent: ids.artist(album.artist),
						name: album.title,
						child: album.tracks.map((t) => toJson.song(t, album, starred))
					}
				});
			}
			return notFound('Carpeta');
		},
		getArtist: async (params, _, user) => {
			const id = ids.parse(params.get('id'));
			if (id?.kind !== 'artist') return notFound('Artista');
			const [library, starred] = await Promise.all([load(user), stars(user)]);
			const artist = findArtist(library, id.name);
			if (!artist) return notFound('Artista');
			return ok({
				artist: {
					...toJson.artist(artist, starred),
					album: artist.albums.map((a) => toJson.album(a, starred))
				}
			});
		},
		getAlbum: async (params, _, user) => {
			const id = ids.parse(params.get('id'));
			if (id?.kind !== 'album') return notFound('Álbum');
			const [library, starred] = await Promise.all([load(user), stars(user)]);
			const album = library.albums.get(id.id);
			if (!album) return notFound('Álbum');
			return ok({
				album: {
					...toJson.album(album, starred),
					song: album.tracks.map((t) => toJson.song(t, album, starred))
				}
			});
		},
		getSong: async (params, _, user) => {
			const id = ids.parse(params.get('id'));
			if (id?.kind !== 'track') return notFound('Canción');
			const [library, starred] = await Promise.all([load(user), stars(user)]);
			const track = library.tracks.get(id.id);
			if (!track) return notFound('Canción');
			return ok({ song: toJson.song(track, library.albums.get(track.albumId)!, starred) });
		},

		getAlbumList2: async (params, _, user) => {
			const type = params.get('type');
			if (!type) return failed(ERROR.missingParameter, 'Falta el parámetro type');
			const [library, starred] = await Promise.all([load(user), stars(user)]);
			const offset = count(params, 'offset', 0, Number.MAX_SAFE_INTEGER);
			const albums = albumList(library, type, starred, ids).slice(
				offset,
				offset + count(params, 'size', 10)
			);
			return ok({ albumList2: { album: albums.map((a) => toJson.album(a, starred)) } });
		},
		getAlbumList: (params, request, user) =>
			renamed(METHODS.getAlbumList2(params, request, user), 'albumList2', 'albumList'),
		getRandomSongs: async (params, _, user) => {
			const [library, starred] = await Promise.all([load(user), stars(user)]);
			const songs = shuffled([...library.tracks.values()]).slice(0, count(params, 'size', 10));
			return ok({
				randomSongs: {
					song: songs.map((t) => toJson.song(t, library.albums.get(t.albumId)!, starred))
				}
			});
		},

		/** With an empty query (`""` too), everything, page by page: how some apps sync the library. */
		search3: async (params, _, user) => {
			const [library, starred] = await Promise.all([load(user), stars(user)]);
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
					artist: page(artists, 'artist').map((a) => toJson.artist(a, starred)),
					album: page(albums, 'album').map((a) => toJson.album(a, starred)),
					song: page(songs, 'song').map((t) =>
						toJson.song(t, library.albums.get(t.albumId)!, starred)
					)
				}
			});
		},
		search2: (params, request, user) =>
			renamed(METHODS.search3(params, request, user), 'searchResult3', 'searchResult2')
	};
	return METHODS;
}

/** What Tempus asks for that neither server has: valid, empty answers, nothing is broken by asking. */
export const emptyMethods = ({ ok }: Answers): Record<string, Method> => ({
	scrobble: () => ok(),
	setRating: () => ok(),
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
	getPodcasts: () => ok({ podcasts: { channel: [] } }),
	getNewestPodcasts: () => ok({ newestPodcasts: { episode: [] } }),
	getScanStatus: () => ok({ scanStatus: { scanning: false } })
});
