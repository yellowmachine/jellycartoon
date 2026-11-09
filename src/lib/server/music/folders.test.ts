import { beforeAll, describe, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '#lib/server/db/schema.ts';
import { album, musicPlaylist, musicPlaylistItem, track, user } from '#lib/server/db/schema.ts';

/**
 * Música → Carpetas: the music as it is on disk, with the audios that have no album (a podcast
 * downloaded, a talk). On a real Postgres (PGlite, in memory) with the migrations as they are.
 */
const db = drizzle(new PGlite(), { schema });
mock.module('#lib/server/db/index.ts', () => ({ db }));
// Mocks last the whole run (Bun): the same as library/scan.test.ts's, which comes first.
mock.module('#lib/server/library/paths.ts', () => ({
	mediaRoot: '/',
	musicRoot: '/musica',
	musicFile: (relative: string) => `/musica/${relative}`
}));
mock.module('./catalog.ts', () => ({ wakeMusicCatalog: async () => {} }));
const { musicFolder, tracksById } = await import('./albums.ts');
const { getPlaylist } = await import('./playlists.ts');
const { getProgress, saveProgress } = await import('./progress.ts');

const file = (path: string, more: Partial<typeof track.$inferInsert> = {}) => ({
	path,
	size: 1,
	mtime: new Date(),
	status: 'ready' as const,
	title: path.split('/').at(-1)!,
	durationSec: 60,
	...more
});

let queen: number;
let talk: number;

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../../drizzle` });
	const [a] = await db
		.insert(album)
		.values({ folder: 'Queen/Greatest Hits', title: 'Greatest Hits', artist: 'Queen' })
		.returning();
	const rows = await db
		.insert(track)
		.values([
			file('Queen/Greatest Hits/02 - Another One.flac', {
				albumId: a!.id,
				number: 2,
				title: 'Another One'
			}),
			file('Queen/Greatest Hits/01 - Bohemian.flac', {
				albumId: a!.id,
				number: 1,
				title: 'Bohemian'
			}),
			file('Podcasts/Charlas/Episodio 10.mp3', { title: 'Episodio 10' }),
			file('Podcasts/Charlas/Episodio 9.mp3', { title: 'Episodio 9', artist: 'Ana' }),
			file('Podcasts/Suelto.opus', { title: 'Suelto' }),
			file('Podcasts/Charlas/Roto.mp3', { status: 'error' }),
			file('Podcasts/Charlas/Ido.mp3', { missing: true })
		])
		.returning();
	queen = rows[1]!.id;
	talk = rows[3]!.id;
});

describe('Carpetas', () => {
	test('the top: its folders, with what they have inside', async () => {
		const top = await musicFolder('');
		expect(top!.path).toBe('');
		expect(top!.folders).toEqual([
			{ path: 'Podcasts', name: 'Podcasts', tracks: 3, durationSec: 180 },
			{ path: 'Queen', name: 'Queen', tracks: 2, durationSec: 120 }
		]);
		expect(top!.tracks).toEqual([]);
	});

	test('a folder: its folders and its own audios, by name as a file browser would', async () => {
		const podcasts = await musicFolder('Podcasts');
		expect(podcasts!.folders.map((f) => f.name)).toEqual(['Charlas']);
		expect(podcasts!.tracks.map((t) => t.title)).toEqual(['Suelto']);
		const talks = await musicFolder('Podcasts/Charlas/');
		expect(talks!.name).toBe('Charlas');
		expect(talks!.tracks.map((t) => t.title)).toEqual(['Episodio 9', 'Episodio 10']);
		expect(talks!.tracks[0]).toMatchObject({
			albumId: 0,
			album: 'Charlas',
			artist: 'Ana',
			hasCover: false,
			folder: 'Podcasts/Charlas'
		});
	});

	test('an album: by its numbers, with its album', async () => {
		const hits = await musicFolder('Queen/Greatest Hits');
		expect(hits!.tracks.map((t) => t.title)).toEqual(['Bohemian', 'Another One']);
		expect(hits!.tracks[0]).toMatchObject({ album: 'Greatest Hits', artist: 'Queen' });
		expect(hits!.tracks[0]!.folder).toBeUndefined();
	});

	test('nothing to play, or out of the music: none', async () => {
		expect(await musicFolder('Nada')).toBeNull();
		expect((await musicFolder('../Podcasts'))!.path).toBe('Podcasts');
	});

	test('to play, and in a playlist: with and without an album', async () => {
		const played = await tracksById([talk, queen]);
		expect(played.map((p) => p.track.title)).toEqual(['Episodio 9', 'Bohemian']);
		expect(played[0]!.track.folder).toBe('Podcasts/Charlas');
		const [list] = await db.insert(musicPlaylist).values({ name: 'Mezcla' }).returning();
		await db.insert(musicPlaylistItem).values([
			{ playlistId: list!.id, trackId: talk, position: 0 },
			{ playlistId: list!.id, trackId: queen, position: 1 }
		]);
		const got = await getPlaylist(list!.id);
		expect(got!.items.map((i) => [i.track.title, i.track.albumId > 0])).toEqual([
			['Episodio 9', false],
			['Bohemian', true]
		]);
	});
});

describe('Where a long audio was left', () => {
	test('kept per person, moved on, and forgotten once heard', async () => {
		const now = new Date();
		await db.insert(user).values([
			{ id: 'ana', name: 'Ana', email: 'ana@casa', createdAt: now, updatedAt: now },
			{ id: 'leo', name: 'Leo', email: 'leo@casa', createdAt: now, updatedAt: now }
		]);
		expect(await saveProgress('ana', { trackId: talk, positionSec: 600 })).toBe(true);
		expect(await saveProgress('ana', { trackId: talk, positionSec: 1200.5 })).toBe(true);
		expect(await saveProgress('leo', { trackId: talk, positionSec: 30 })).toBe(true);
		expect(await getProgress('ana')).toEqual({ [talk]: 1200.5 });
		expect(await saveProgress('ana', { trackId: 999_999, positionSec: 10 })).toBe(false);
		await saveProgress('ana', { trackId: talk, positionSec: 0 });
		expect(await getProgress('ana')).toEqual({});
		expect(await getProgress('leo')).toEqual({ [talk]: 30 });
	});
});
