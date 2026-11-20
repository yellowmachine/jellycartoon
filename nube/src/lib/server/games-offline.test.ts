import { beforeAll, describe, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import * as schema from './db/schema.ts';
import { family, mapDevice, offlineGame } from './db/schema.ts';
import { familyOnlyScope } from './family-scope.ts';
import type { Kitchen } from './fridge.ts';

/**
 * Games without coverage from «Tus juegos» (#564), on a real Postgres (PGlite) as the app's role,
 * with the bucket's games and the house faked: the bucket's game is ordered by its size (BIOS
 * too), beside the house's same file; the device is told its player; and one gone from the bucket
 * goes from the device.
 */

const db = drizzle(new PGlite(), { schema });
const asFamily = familyOnlyScope(db, { role: 'app_user' });
const k: Kitchen = { familyId: 'A', userId: 'ana', run: (fn) => asFamily('A', fn) };
const who = { id: 'ana', email: 'ana@test.es' };

let inBucket = true;
const player = (title: string, rom: string) => ({
	title,
	core: 'snes',
	rom,
	bios: null,
	gameId: 1,
	backdrop: '',
	cartridge: '',
	controls: {},
	shader: { own: null, inherited: 'disabled' }
});

mock.module('#lib/server/own-games.ts', () => ({
	ownCarry: async (_: string, system: string, file: string) => {
		if (!inBucket) error(404, 'Juego no encontrado');
		return {
			title: 'Zelda',
			consoleName: 'Super Nintendo',
			cover: '/api/juegos/propios/imagen/1/caratula',
			player: player('Zelda', `/api/juegos/propios/rom/1/${file}`),
			bytes: 1000
		};
	}
}));
mock.module('#lib/server/games.ts', () => ({
	gameSummary: async () => ({ title: 'Zelda (casa)' }),
	gamePlayer: async () => player('Zelda (casa)', '/api/juegos/snes/Zelda.sfc'),
	gameConsoles: async () => [{ id: 'snes', name: 'Super Nintendo' }],
	consoleCovers: async () => ({})
}));
mock.module('#lib/server/house.ts', () => {
	class HouseProblem extends Error {
		constructor(
			message: string,
			readonly status: number
		) {
			super(message);
		}
	}
	return {
		HouseProblem,
		passToHouse: async () =>
			new Response(null, { status: 200, headers: { 'content-length': '500' } })
	};
});
mock.module('#lib/server/music.ts', () => ({ playlists: async () => [] }));

const offline = await import('./games-offline.ts');

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../drizzle` });
	await db.execute(sql`create role app_user nosuperuser nobypassrls`);
	await db.execute(sql`grant usage on schema public to app_user`);
	await db.execute(
		sql`grant select, insert, update, delete on all tables in schema public to app_user`
	);
	await db.execute(sql`grant usage on all sequences in schema public to app_user`);
	await db.insert(family).values({ id: 'A', name: 'Casa A' });
	await db.insert(mapDevice).values({ familyId: 'A', id: 'tablet', name: 'Tablet' });
});

const own = { system: 'snes', file: 'Zelda.sfc', source: 'propia' } as const;
const house = { ...own, source: 'casa' } as const;

describe('«Tus juegos» without coverage (#564)', () => {
	test('ordered beside the house’s same file, each with its size', async () => {
		expect(await offline.orderOfflineGame(k, who, own, 'tablet')).toBeNull();
		expect(await offline.orderOfflineGame(k, who, house, 'tablet')).toBeNull();
		const view = await offline.offlineGamesOf(k);
		expect(view.games.map((g) => [g.source, g.title, g.bytes])).toEqual([
			['propia', 'Zelda', 1000],
			['casa', 'Zelda (casa)', 500]
		]);
	});

	test('the device is told each one’s player, from where it is', async () => {
		const orders = await offline.syncOfflineGames(k, who, 'tablet');
		expect(orders!.map((o) => [o.source, o.player.rom, o.cover])).toEqual([
			['propia', '/api/juegos/propios/rom/1/Zelda.sfc', '/api/juegos/propios/imagen/1/caratula'],
			['casa', '/api/juegos/snes/Zelda.sfc', null]
		]);
	});

	test('its report is the bucket’s game’s, not the house’s', async () => {
		await offline.reportOfflineGame(k, 'tablet', { ...own, state: 'ready', bytes: 1200 });
		const view = await offline.offlineGamesOf(k);
		expect(view.games.map((g) => [g.source, g.state])).toEqual([
			['propia', 'ready'],
			['casa', 'pending']
		]);
	});

	test('gone from the bucket: gone from the device too', async () => {
		inBucket = false;
		const orders = await offline.syncOfflineGames(k, who, 'tablet');
		expect(orders!.map((o) => o.source)).toEqual(['casa']);
		const left = await asFamily('A', (tx) => tx.select().from(offlineGame));
		expect(left.map((g) => g.source)).toEqual(['casa']);
	});

	test('taken away by hand, only that one', async () => {
		await offline.removeOfflineGame(k, house, 'tablet');
		expect((await offline.offlineGamesOf(k)).games).toEqual([]);
	});
});
