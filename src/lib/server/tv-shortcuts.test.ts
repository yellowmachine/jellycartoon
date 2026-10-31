import { beforeAll, describe, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '#lib/server/db/schema.ts';
import {
	album,
	movie,
	movieTag,
	musicPlaylist,
	series,
	seriesTag,
	tag
} from '#lib/server/db/schema.ts';
import { STATIONS } from 'comun/radio.ts';

/**
 * The TV view's shortcuts (#327): a child sees only the sites tagged «infantil», and their tags are
 * the series' and films' ones; the TV view's own (#343), if their destination is for it. On a real
 * Postgres (PGlite, in memory) with the migrations as they are.
 */
const db = drizzle(new PGlite(), { schema });
mock.module('#lib/server/db/index.ts', () => ({ db }));
// Mocks last the whole run (Bun): no other test uses these modules. Ana follows one podcast.
const station = STATIONS[0];
mock.module('#lib/server/radio.ts', () => ({
	stationsInfo: async () => ({ [station.uuid]: { favicon: 'https://radio/logo.png' } })
}));
mock.module('#lib/server/podcasts.ts', () => ({
	podcastLists: async (userId: string) => ({
		podcasts:
			userId === 'ana' ? [{ id: 7, title: 'Nadie sabe nada', imageUrl: 'https://p/7.jpg' }] : [],
		inProgress: []
	})
}));
mock.module('#lib/server/games.ts', () => ({
	findGame: async (system: string, file: string) =>
		system === 'snes' && file === 'Mario World.sfc' ? { system, file, title: 'Mario World' } : null,
	allGames: async () => [
		{
			id: 'snes',
			name: 'Super Nintendo',
			games: [{ system: 'snes', file: 'Mario World.sfc', title: 'Mario World' }]
		}
	],
	systemCovers: async () => ({})
}));
mock.module('#lib/server/steam.ts', () => ({
	steamLaunchEnabled: true,
	steamGames: async () => [{ appid: 220, name: 'Half-Life 2', pictures: {} }],
	steamPictureUrl: (appid: number, kind: string) => `/api/juegos/steam/${appid}/${kind}`
}));
const {
	tvShortcuts,
	tvShortcutTiles,
	settingsShortcuts,
	openableShortcut,
	saveTvShortcut,
	deleteTvShortcut,
	parseTags,
	shortcutUrl
} = await import('./tv-shortcuts.ts');
const { candidates, shortcutTarget } = await import('./tv-shortcut-targets.ts');

const save = (s: Parameters<typeof saveTvShortcut>[0]) => saveTvShortcut(s, 'ana');

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../drizzle` });
});

describe('shortcuts', () => {
	test('a child sees only the children’s', async () => {
		const nbaSaved = await save({
			name: 'NBA',
			url: 'https://www.nba.com/watch',
			tags: 'Deportes'
		});
		expect(nbaSaved.findIcon).toBe(true);
		await save({
			name: 'Crunchyroll',
			url: 'https://www.crunchyroll.com/es/',
			tags: ' Infantil , dibujos, infantil'
		});
		expect((await tvShortcuts(false)).map((s) => [s.name, s.tags])).toEqual([
			['Crunchyroll', ['dibujos', 'infantil']],
			['NBA', ['deportes']]
		]);
		expect((await tvShortcuts(true)).map((s) => s.name)).toEqual(['Crunchyroll']);
		const nba = (await tvShortcuts(false)).find((s) => s.name === 'NBA')!;
		expect(await openableShortcut(nba.id, true)).toBeNull();
		expect(await openableShortcut(nba.id, false)).not.toBeNull();
	});

	test('a tag nothing has any more goes; a shared one stays', async () => {
		const crunchy = (await tvShortcuts(false)).find((s) => s.name === 'Crunchyroll')!;
		await save({ id: crunchy.id, name: 'Crunchyroll', url: crunchy.url!, tags: '' });
		expect(await tvShortcuts(true)).toEqual([]);
		const nba = (await tvShortcuts(false)).find((s) => s.name === 'NBA')!;
		await deleteTvShortcut(nba.id);
		expect((await db.select({ name: tag.name }).from(tag)).map((t) => t.name)).toEqual([]);
	});

	test('the TV view’s own: its destination’s name and page, and for a child only what it may have', async () => {
		const [bluey, adultsOnly] = await db
			.insert(series)
			.values([
				{ folder: 'bluey', title: 'Bluey' },
				{ folder: 'the-wire', title: 'The Wire' }
			])
			.returning({ id: series.id });
		const [{ id: infantil }] = await db
			.insert(tag)
			.values({ name: 'infantil' })
			.returning({ id: tag.id });
		await db.insert(seriesTag).values({ seriesId: bluey.id, tagId: infantil });
		const [film] = await db
			.insert(movie)
			.values({ path: 'coco.mkv', title: 'Coco', size: 1, mtime: new Date(), status: 'ready' })
			.returning({ id: movie.id });
		await db.insert(movieTag).values({ movieId: film.id, tagId: infantil });
		const [disc] = await db
			.insert(album)
			.values({ folder: 'abbey', title: 'Abbey Road', artist: 'The Beatles' })
			.returning({ id: album.id });
		const [list] = await db
			.insert(musicPlaylist)
			.values({ name: 'Para cenar' })
			.returning({ id: musicPlaylist.id });

		// No name: the destination's.
		await save({ name: '', kind: 'serie', target: String(bluey.id), tags: '' });
		await save({ name: 'Bunk y McNulty', kind: 'serie', target: ` ${adultsOnly.id} `, tags: '' });
		await save({ name: '', kind: 'pelicula', target: String(film.id), tags: '' });
		await save({ name: '', kind: 'canal', target: 'la1', tags: '' });
		await save({ name: '', kind: 'radio', target: station.uuid, tags: '' });
		await save({ name: '', kind: 'podcast', target: '7', tags: '' });
		await save({ name: '', kind: 'album', target: String(disc.id), tags: '' });
		await save({ name: '', kind: 'lista', target: String(list.id), tags: '' });
		await save({ name: '', kind: 'juego', target: 'snes/Mario World.sfc', tags: '' });
		await save({ name: '', kind: 'steam', target: '220', tags: '' });

		const tiles = await tvShortcutTiles({ userId: 'ana', kid: false });
		const own = tiles.filter((t) => t.kind !== 'url');
		expect(own.map((t) => [t.name, t.href, t.icon])).toEqual([
			['Abbey Road', `/tv/musica/${disc.id}`, null],
			[station.name, null, 'https://radio/logo.png'],
			['Bluey', `/tv/series/${bluey.id}`, null],
			['Bunk y McNulty', `/tv/series/${adultsOnly.id}`, null],
			['Coco', `/tv/cine/${film.id}`, `/api/movie-thumb/${film.id}`],
			['Half-Life 2', null, '/api/juegos/steam/220/caratula'],
			['La 1', null, null],
			['Mario World', '/tv/juegos/snes/Mario%20World.sfc', null],
			['Nadie sabe nada', `/tv/podcasts/7`, 'https://p/7.jpg'],
			['Para cenar', `/tv/musica/listas/${list.id}`, null]
		]);
		// Without the «infantil» tag on the shortcut: the series' and film's own count; no podcasts
		// nor games; La 1 is not a children's channel.
		expect((await tvShortcutTiles({ userId: 'ana', kid: true })).map((t) => t.name)).toEqual([
			'Abbey Road',
			station.name,
			'Bluey',
			'Coco',
			'Para cenar'
		]);
		expect(tiles.find((t) => t.name === 'Bunk y McNulty')?.detail).toBe('Serie · The Wire');
		expect(tiles.find((t) => t.name === 'Bluey')?.detail).toBe('Serie');
		expect(tiles.find((t) => t.name === 'Crunchyroll')?.detail).toBe('crunchyroll.com');
		// A podcast is each person's: one who does not follow it does not see it.
		expect(
			(await tvShortcutTiles({ userId: 'luis', kid: false })).map((t) => t.name)
		).not.toContain('Nadie sabe nada');
		// Only a site has a window.
		const coco = (await tvShortcuts(false)).find((s) => s.name === 'Coco')!;
		expect((await openableShortcut(coco.id, true))?.url).toBeNull();
	});

	test('a destination that is gone: out of the TV view, «gone» in Ajustes', async () => {
		const [wire] = await db
			.select({ id: series.id })
			.from(series)
			.where(eq(series.folder, 'the-wire'));
		await db.delete(series).where(eq(series.id, wire.id));
		expect((await tvShortcutTiles({ userId: 'ana', kid: false })).map((t) => t.name)).not.toContain(
			'Bunk y McNulty'
		);
		const listed = await settingsShortcuts('ana');
		expect(listed.find((s) => s.name === 'Bunk y McNulty')).toMatchObject({
			gone: true,
			opens: null
		});
		expect(listed.find((s) => s.name === 'Bluey')).toMatchObject({ gone: false, opens: 'Bluey' });
	});

	test('one that is not there, or not written as its kind wants, is not saved', async () => {
		expect(save({ name: 'X', kind: 'serie', target: '999999', tags: '' })).rejects.toThrow(
			'Eso ya no está'
		);
		expect(save({ name: 'X', kind: 'canal', target: 'no-such', tags: '' })).rejects.toThrow();
		expect(save({ name: 'X', kind: 'tele', target: '1', tags: '' })).rejects.toThrow(
			'Elige qué abre'
		);
		expect(() => shortcutTarget('pelicula', 'abc')).toThrow();
		expect(() => shortcutTarget('juego', '../etc/passwd')).toThrow();
		expect(shortcutTarget('steam', 'bigpicture')).toBe('bigpicture');
	});

	test('a site that becomes a series: its icon, to delete, and no address', async () => {
		const site = await save({ name: 'NBA', url: 'https://www.nba.com/', tags: '' });
		await db
			.update(schema.tvShortcut)
			.set({ icon: 'nba.png' })
			.where(eq(schema.tvShortcut.id, site.id));
		const [bluey] = await db
			.select({ id: series.id })
			.from(series)
			.where(eq(series.folder, 'bluey'));
		const changed = await save({
			id: site.id,
			name: '',
			kind: 'serie',
			target: String(bluey.id),
			tags: ''
		});
		expect(changed).toMatchObject({ findIcon: false, oldIcon: 'nba.png' });
		expect((await tvShortcuts(false)).find((s) => s.id === site.id)).toMatchObject({
			kind: 'serie',
			url: null,
			icon: null,
			name: 'Bluey'
		});
	});

	test('what each kind can open, to choose in Ajustes', async () => {
		expect((await candidates('serie', 'ana')).map((c) => c.name)).toEqual(['Bluey']);
		expect(await candidates('juego', 'ana')).toEqual([
			{ target: 'snes/Mario World.sfc', name: 'Mario World', detail: 'Super Nintendo' }
		]);
		expect((await candidates('steam', 'ana')).map((c) => c.target)).toEqual(['bigpicture', '220']);
		expect(await candidates('podcast', 'luis')).toEqual([]);
		const la1 = (await candidates('canal', 'ana')).find((c) => c.target === 'la1');
		expect(la1?.name).toBe('La 1');
	});

	test('only a whole address, http or https', () => {
		expect(shortcutUrl(' https://www.nba.com ')).toBe('https://www.nba.com/');
		expect(() => shortcutUrl('nba.com')).toThrow();
		expect(() => shortcutUrl('javascript:alert(1)')).toThrow();
		expect(parseTags('Infantil, ,dibujos,  infantil ')).toEqual(['infantil', 'dibujos']);
	});
});
