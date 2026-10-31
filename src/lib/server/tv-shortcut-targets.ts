import { and, asc, eq, exists, inArray, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	album,
	albumArtistName,
	albumTitle,
	episode,
	movie,
	movieTag,
	movieTitle,
	musicPlaylist,
	series,
	seriesTag,
	tag
} from '#lib/server/db/schema.ts';
import { KIDS_TAG } from '#lib/kids-tag.ts';
import { BIG_PICTURE, type Candidate, type ShortcutKind } from '#lib/tv-shortcut-kinds.ts';
import { stationsInfo } from '#lib/server/radio.ts';
import { podcastLists } from '#lib/server/podcasts.ts';
import { allGames, findGame, systemCovers } from '#lib/server/games.ts';
import { steamGames, steamLaunchEnabled, steamPictureUrl } from '#lib/server/steam.ts';
import { CHANNELS, channelsFor } from 'comun/channels.ts';
import { STATIONS } from 'comun/radio.ts';

/**
 * What a TV shortcut of the TV view's own opens (#343): a series, a channel, a station… named by its
 * `target`. Shown only if it is still there and the one watching may have it: for a child, what
 * the destination allows (a series or film tagged «infantil», the children's channels; no podcasts
 * nor games yet, #58 and #176), with no tag on the shortcut. Not here: kids.ts's checks, which
 * read the request; these are asked for a list at once.
 */

export interface Destination {
	/** Its own name, as the TV view shows it elsewhere. */
	name: string;
	icon: string | null;
	/** Its page in the TV view; null, it starts on its tile (a channel, a station, Steam). */
	href: string | null;
}

export interface Viewer {
	userId: string;
	kid: boolean;
}

type Target = { kind: Exclude<ShortcutKind, 'url'>; target: string };

const isId = (text: string) => /^[1-9]\d{0,9}$/.test(text);

/**
 * What was written or chosen → the target as kept; throws if it cannot be one. Whether it is there
 * is `destinations`'.
 */
export function shortcutTarget(kind: Target['kind'], text: string) {
	const target = text.trim();
	const valid =
		kind === 'serie' ||
		kind === 'pelicula' ||
		kind === 'podcast' ||
		kind === 'album' ||
		kind === 'lista'
			? isId(target)
			: kind === 'juego'
				? /^[^/]+\/[^/]+$/.test(target)
				: kind === 'steam'
					? target === BIG_PICTURE || isId(target)
					: target.length > 0;
	if (!valid) throw new Error('Elige qué abre');
	return target;
}

/** A `where` condition: tagged «infantil», through one of the tag tables. */
const kidsTagged = (
	table: typeof seriesTag | typeof movieTag,
	column: typeof seriesTag.seriesId | typeof movieTag.movieId,
	id: typeof series.id | typeof movie.id
) =>
	exists(
		db
			.select({ one: sql`1` })
			.from(table)
			.innerJoin(tag, eq(tag.id, table.tagId))
			.where(and(eq(column, id), eq(tag.name, KIDS_TAG)))
	);

const ids = (targets: Target[], kind: Target['kind']) => [
	...new Set(targets.filter((t) => t.kind === kind).map((t) => Number(t.target)))
];

/** Each kind's, by target: each source read once, only for the kinds asked for. */
type Found = Partial<Record<Target['kind'], Map<string, Destination>>>;

async function seriesOf(wanted: number[], kid: boolean) {
	const rows = await db
		.select({
			id: series.id,
			title: series.title,
			cover: sql<number | null>`(select ${episode.id} from ${episode}
				where ${episode.seriesId} = ${series.id} and ${episode.status} = 'ready' and not ${episode.missing}
				order by ${episode.season} = 0, ${episode.season}, ${episode.number} limit 1)`
		})
		.from(series)
		.where(
			and(
				inArray(series.id, wanted),
				kid ? kidsTagged(seriesTag, seriesTag.seriesId, series.id) : undefined
			)
		);
	return new Map(
		rows.map((r): [string, Destination] => [
			String(r.id),
			{
				name: r.title,
				icon: r.cover ? `/api/thumb/${r.cover}` : null,
				href: `/tv/series/${r.id}`
			}
		])
	);
}

async function filmsOf(wanted: number[], kid: boolean) {
	const rows = await db
		.select({ id: movie.id, title: movieTitle })
		.from(movie)
		.where(
			and(
				inArray(movie.id, wanted),
				eq(movie.status, 'ready'),
				eq(movie.missing, false),
				kid ? kidsTagged(movieTag, movieTag.movieId, movie.id) : undefined
			)
		);
	return new Map(
		rows.map((r): [string, Destination] => [
			String(r.id),
			{ name: r.title, icon: `/api/movie-thumb/${r.id}`, href: `/tv/cine/${r.id}` }
		])
	);
}

async function albumsOf(wanted: number[]) {
	const rows = await db
		.select({ id: album.id, title: albumTitle, cover: album.coverStatus })
		.from(album)
		.where(inArray(album.id, wanted));
	return new Map(
		rows.map((r): [string, Destination] => [
			String(r.id),
			{
				name: r.title,
				icon: r.cover === 'found' ? `/api/music/cover/${r.id}` : null,
				href: `/tv/musica/${r.id}`
			}
		])
	);
}

async function playlistsOf(wanted: number[]) {
	const rows = await db
		.select({ id: musicPlaylist.id, name: musicPlaylist.name })
		.from(musicPlaylist)
		.where(inArray(musicPlaylist.id, wanted));
	return new Map(
		rows.map((r): [string, Destination] => [
			String(r.id),
			{ name: r.name, icon: null, href: `/tv/musica/listas/${r.id}` }
		])
	);
}

function channelsOf(kid: boolean) {
	return new Map(
		channelsFor(kid).map((c): [string, Destination] => [
			c.id,
			{ name: c.name, icon: null, href: null }
		])
	);
}

async function stationsOf() {
	const info = await stationsInfo();
	return new Map(
		STATIONS.map((s): [string, Destination] => [
			s.uuid,
			{ name: s.name, icon: info?.[s.uuid]?.favicon ?? null, href: null }
		])
	);
}

/** Each person's, in the cloud: only those this one follows. */
async function podcastsOf(userId: string) {
	const { podcasts } = await podcastLists(userId);
	return new Map(
		podcasts.map((p): [string, Destination] => [
			String(p.id),
			{ name: p.title, icon: p.imageUrl, href: `/tv/podcasts/${p.id}` }
		])
	);
}

async function gamesOf(targets: string[]) {
	const found = new Map<string, Destination>();
	for (const target of new Set(targets)) {
		const [system, file] = target.split('/');
		const game = await findGame(system, file);
		if (!game) continue;
		// Only the box already fetched: the console's page fetches those missing.
		const covers = await systemCovers(system, [game], false);
		found.set(target, {
			name: game.title,
			icon: covers[file] ?? null,
			href: `/tv/juegos/${encodeURIComponent(system)}/${encodeURIComponent(file)}`
		});
	}
	return found;
}

/** Only with Steam's service on the living room's PC, which is what opens them. */
async function steamOf() {
	const found = new Map<string, Destination>();
	if (!steamLaunchEnabled) return found;
	found.set(BIG_PICTURE, { name: 'Steam', icon: null, href: null });
	for (const g of await steamGames())
		found.set(String(g.appid), {
			name: g.name,
			icon: steamPictureUrl(g.appid, 'caratula'),
			href: null
		});
	return found;
}

/** Each target's destination, in order; null, gone or not for this viewer. */
export async function destinations(
	targets: Target[],
	{ userId, kid }: Viewer
): Promise<(Destination | null)[]> {
	const asked = new Set(targets.map((t) => t.kind));
	const found: Found = {};
	const load = async (kind: Target['kind'], read: () => Promise<Map<string, Destination>>) => {
		if (asked.has(kind)) found[kind] = await read();
	};
	await Promise.all([
		load('serie', () => seriesOf(ids(targets, 'serie'), kid)),
		load('pelicula', () => filmsOf(ids(targets, 'pelicula'), kid)),
		load('album', () => albumsOf(ids(targets, 'album'))),
		load('lista', () => playlistsOf(ids(targets, 'lista'))),
		load('canal', async () => channelsOf(kid)),
		load('radio', stationsOf),
		// Not for children yet (#58, #176).
		kid ? null : load('podcast', () => podcastsOf(userId)),
		kid
			? null
			: load('juego', () =>
					gamesOf(targets.filter((t) => t.kind === 'juego').map((t) => t.target))
				),
		kid ? null : load('steam', steamOf)
	]);
	return targets.map((t) => found[t.kind]?.get(t.target) ?? null);
}

/**
 * What a kind's shortcut can open, as an adult (`userId`) sees it, for Ajustes to choose from: in
 * the order the TV view lists them.
 */
export async function candidates(kind: Target['kind'], userId: string): Promise<Candidate[]> {
	const plain = (target: string | number, name: string, detail: string | null = null) => ({
		target: String(target),
		name,
		detail
	});
	switch (kind) {
		case 'serie':
			return (
				await db
					.select({ id: series.id, title: series.title })
					.from(series)
					.orderBy(asc(series.title))
			).map((r) => plain(r.id, r.title));
		case 'pelicula':
			return (
				await db
					.select({ id: movie.id, title: movieTitle, year: movie.year })
					.from(movie)
					.where(and(eq(movie.status, 'ready'), eq(movie.missing, false)))
					.orderBy(asc(movieTitle))
			).map((r) => plain(r.id, r.title, r.year ? String(r.year) : null));
		case 'album':
			return (
				await db
					.select({ id: album.id, title: albumTitle, artist: albumArtistName })
					.from(album)
					.orderBy(asc(albumArtistName), asc(albumTitle))
			).map((r) => plain(r.id, r.title, r.artist));
		case 'lista':
			return (
				await db
					.select({ id: musicPlaylist.id, name: musicPlaylist.name })
					.from(musicPlaylist)
					.orderBy(asc(musicPlaylist.name))
			).map((r) => plain(r.id, r.name));
		case 'canal':
			return CHANNELS.map((c) => plain(c.id, c.name, c.kids ? 'También peques' : null));
		case 'radio':
			return STATIONS.map((s) => plain(s.uuid, s.name, s.description));
		case 'podcast':
			return (await podcastLists(userId)).podcasts.map((p) => plain(p.id, p.title, p.author));
		case 'juego':
			return (await allGames()).flatMap((system) =>
				system.games.map((g) => plain(`${g.system}/${g.file}`, g.title, system.name))
			);
		case 'steam':
			if (!steamLaunchEnabled) return [];
			return [
				plain(BIG_PICTURE, 'Steam', 'Big Picture, con toda la biblioteca'),
				...(await steamGames()).map((g) => plain(g.appid, g.name))
			];
	}
}
