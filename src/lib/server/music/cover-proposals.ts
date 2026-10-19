import { and, asc, eq, ne } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { album, albumArtistName, albumTitle, track, trackTitle } from '#lib/server/db/schema.ts';
import { openRouterConfig } from '#lib/server/app-settings.ts';
import { albumCoverFile } from '#lib/server/library/paths.ts';
import { log } from '#lib/server/log.ts';
import { completeJson } from '#lib/server/openrouter.ts';
import { downloadFront, musicBrainz, quote, words, type Release } from './covers.ts';
import { renameAlbum } from './albums.ts';
import { albumOfDisc, discNumber, searchTitles, titlesMatch, VARIOUS_ARTISTS } from './tags.ts';

/**
 * Covers to choose from for an album the automatic search did not find one for (covers.ts): its
 * name is often dirty («… CD1», «Lauper, Cyndi», «AC, DC»), so the AI (with a key) says what album
 * it is, from its name, folder and songs, and MusicBrainz and the Cover Art Archive give the
 * covers of the editions found. The chosen one is downloaded, as the automatic ones.
 */

export interface CoverProposal {
	/** A release group: every edition of the album, with the cover the Cover Art Archive picks. */
	releaseGroupId: string;
	title: string;
	artist: string;
	year: string | null;
	/** A small one, to choose: shown from the Cover Art Archive, not saved. */
	thumbUrl: string;
}

/** As many as fit at a glance. */
const MAX_PROPOSALS = 4;
/** Release groups whose cover is checked: the best of the search. */
const MAX_CHECKED = 10;
/** Songs for the AI to tell the album and edition by. */
const MAX_TRACKS = 25;

const caaUrl = (releaseGroupId: string, size: 250 | 500) =>
	`https://coverartarchive.org/release-group/${releaseGroupId}/front-${size}`;

/** Whether the Cover Art Archive has a front cover for it: a redirect to the image, or a 404. */
async function hasFront(releaseGroupId: string) {
	const res = await fetch(caaUrl(releaseGroupId, 250), {
		method: 'HEAD',
		redirect: 'manual',
		signal: AbortSignal.timeout(15_000)
	}).catch(() => null);
	return res !== null && res.status >= 200 && res.status < 400;
}

interface Search {
	title: string;
	artist: string | null;
}

/** What album it is, for the AI; without a key, or if it fails, its name as it is. */
async function searches(albumId: number): Promise<Search[]> {
	const [a] = await db
		.select({ title: albumTitle, artist: albumArtistName, folder: album.folder })
		.from(album)
		.where(eq(album.id, albumId));
	if (!a) throw new Error('Álbum no encontrado');
	const artist = a.artist === VARIOUS_ARTISTS ? null : a.artist;
	const plain = searchTitles(a.title).map((title) => ({ title, artist }));
	if (!(await openRouterConfig()).apiKey) return plain;

	const songs = await db
		.select({ title: trackTitle })
		.from(track)
		.where(and(eq(track.albumId, albumId), eq(track.missing, false)))
		.orderBy(asc(track.number), asc(track.path))
		.limit(MAX_TRACKS);
	try {
		const answer = await completeJson<{ known: boolean; albums: Search[] }>({
			system:
				'Eres un experto en discos. Identificas álbumes de una colección doméstica española a partir de su carpeta, del título y el artista de sus etiquetas y de sus canciones, para buscarlos en MusicBrainz. ' +
				'Los nombres pueden venir sucios: con el número de disco (CD1, disco 2), el artista al revés («Lauper, Cyndi») o mal escrito («AC, DC» es AC/DC), restos del programa que copió el CD o de la edición. ' +
				'Da el título y el artista como se publicó el disco, sin número de disco. Si puede ser más de uno (otra edición, otro título con el que se conoce), varios, el más probable primero. ' +
				'Si no lo reconoces con seguridad, responde known=false: es mejor no saberlo que inventarlo.',
			prompt: [
				`Carpeta: ${a.folder}`,
				`Título: ${a.title}`,
				`Artista: ${a.artist}`,
				'Canciones:',
				...songs.map((s, i) => `${i + 1}. ${s.title}`),
				'¿Qué álbum es?'
			].join('\n'),
			name: 'album',
			label: `Identificar el álbum «${a.title}»`,
			details: { albumId },
			schema: {
				type: 'object',
				properties: {
					known: { type: 'boolean' },
					albums: {
						type: 'array',
						items: {
							type: 'object',
							properties: {
								title: { type: 'string' },
								artist: { type: ['string', 'null'] }
							},
							required: ['title', 'artist'],
							additionalProperties: false
						}
					}
				},
				required: ['known', 'albums'],
				additionalProperties: false
			}
		});
		const guessed = answer.known ? answer.albums.filter((s) => s.title.trim()).slice(0, 3) : [];
		return [...guessed, ...plain];
	} catch (error) {
		log.warn('música', `La IA no pudo identificar el álbum «${a.title}»`, { albumId, error });
		return plain;
	}
}

const creditOf = (release: Release) =>
	release['artist-credit']?.map((c) => c.name + (c.joinphrase ?? '')).join('') ?? '';

/**
 * The releases for a search, best first: its title as a phrase, then by its words (MusicBrainz
 * may have them in another order, «The Best of Dire Straits & Mark Knopfler: Private
 * Investigations»), then by words without the artist (credited otherwise, «Mark Knopfler»). By
 * words, only those with (almost) all of them: they score unrelated albums high too.
 */
async function releasesFor(search: Search) {
	const artist = search.artist ? ` AND artist:${quote(search.artist)}` : '';
	const queries = [
		{ query: `release:${quote(search.title)}${artist}`, byWords: false },
		{ query: `release:${words(search.title)}${artist}`, byWords: true },
		...(artist ? [{ query: `release:${words(search.title)}`, byWords: true }] : [])
	];
	for (const { query, byWords } of queries) {
		const found = await musicBrainz(`release?limit=25&query=${encodeURIComponent(query)}`);
		const good = (found?.releases ?? []).filter(
			(r) => (r.score ?? 0) >= 80 && (!byWords || titlesMatch(search.title, r.title))
		);
		if (good.length) return good;
	}
	return [];
}

/**
 * Up to MAX_PROPOSALS covers, the most likely album first. The first search that finds the
 * album is enough: its editions are the proposals, and each search is up to three requests to
 * MusicBrainz, which allows one a second.
 */
export async function proposeCovers(albumId: number): Promise<CoverProposal[]> {
	const groups = new Map<string, CoverProposal>();
	const tried = await searches(albumId);
	for (const search of tried) {
		for (const release of await releasesFor(search)) {
			const id = release['release-group']?.id;
			if (!id || groups.has(id)) continue;
			groups.set(id, {
				releaseGroupId: id,
				title: release.title,
				artist: creditOf(release),
				year: release.date?.slice(0, 4) || null,
				thumbUrl: caaUrl(id, 250)
			});
			if (groups.size >= MAX_CHECKED) break;
		}
		if (groups.size) break;
	}
	const checked = [...groups.values()];
	const withCover = await Promise.all(checked.map((p) => hasFront(p.releaseGroupId)));
	const proposals = checked.filter((_, i) => withCover[i]).slice(0, MAX_PROPOSALS);
	log.info('música', `Portadas propuestas para el álbum ${albumId}: ${proposals.length}`, {
		albumId,
		searches: tried,
		releaseGroups: proposals.map((p) => p.releaseGroupId)
	});
	return proposals;
}

/**
 * The chosen cover, saved for the album and for the other discs of the same album (same artist,
 * same title but for the disc number) that have none. With `name`, the edition's, they are renamed
 * too, each keeping its disc number. Returns the titles those others had.
 */
export async function chooseCover(
	albumId: number,
	releaseGroupId: string,
	name?: { title: string; artist: string }
) {
	const [a] = await db
		.select({ title: albumTitle, artist: albumArtistName })
		.from(album)
		.where(eq(album.id, albumId));
	if (!a) throw new Error('Álbum no encontrado');
	const of = albumOfDisc(a.title);
	const siblings = of
		? (
				await db
					.select({ id: album.id, title: albumTitle })
					.from(album)
					.where(
						and(
							eq(albumArtistName, a.artist),
							ne(album.id, albumId),
							ne(album.coverStatus, 'found')
						)
					)
			).filter((s) => albumOfDisc(s.title) === of)
		: [];

	const source = `release-group/${releaseGroupId}`;
	for (const { id, title } of [{ id: albumId, title: a.title }, ...siblings]) {
		if (!(await downloadFront('release-group', releaseGroupId, albumCoverFile(id))))
			throw new Error('El Cover Art Archive ya no tiene esa portada');
		await db
			.update(album)
			.set({ coverStatus: 'found', coverSource: source })
			.where(eq(album.id, id));
		if (!name) continue;
		// As the user would by hand: kept across scans, and undone by emptying it.
		const disc = discNumber(title);
		await renameAlbum(id, 'title', disc ? `${name.title} (CD ${disc})` : name.title);
		if (name.artist) await renameAlbum(id, 'artist', name.artist);
	}
	log.info('música', `Portada elegida para «${a.title}»`, {
		albumId,
		source,
		renamedTo: name,
		alsoFor: siblings.map((s) => s.id)
	});
	return siblings.map((s) => s.title);
}
