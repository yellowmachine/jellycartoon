import { beforeAll, describe, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq, sql } from 'drizzle-orm';
import * as schema from './db/schema.ts';
import { family, familyMember, gameSource, ownGame, user } from './db/schema.ts';
import { familyOnlyScope, familyScope, NoFamily, userScope } from './family-scope.ts';

/**
 * «Tus juegos» (#564), on a real Postgres (PGlite) as the app's role, with a faked bucket and
 * storage: listing it puts its games in and takes the gone ones out, keeping their rows; the
 * consoles and a console's games; each person's cartridge, saved games and time, only theirs; and
 * another family's game is not found.
 */

const db = drizzle(new PGlite(), { schema });
const withFamily = familyScope(db, { role: 'app_user' });
const asFamily = familyOnlyScope(db, { role: 'app_user' });
const asUser = userScope(db, { role: 'app_user' });
const bucket = {
	endpoint: 'https://s3.test',
	region: 'auto',
	bucket: 'casa',
	prefix: 'Juegos/',
	accessKeyId: 'a',
	secretAccessKey: 'b'
};
let keys: string[] = [];
const files = new Map<string, Uint8Array>();

mock.module('#lib/server/db/index.ts', () => ({ db }));
mock.module('#lib/server/family.ts', () => ({ withFamily, asFamily, asUser, NoFamily }));
mock.module('#lib/server/family-secret.ts', () => ({
	sealFor: async (_: string, text: string) => text,
	openFor: async (_: string, text: string) => text
}));
mock.module('#lib/server/own-music.ts', () => ({
	bucketOf: async () => bucket,
	testSource: async () => ({ canWrite: false })
}));
mock.module('#lib/server/own-music-read.ts', () => ({
	listAll: async () => keys.map((key) => ({ key, etag: 'e', size: 10 }))
}));
mock.module('#lib/server/storage.ts', () => ({
	ownPlace: () => ({ client: async () => ({}) }),
	putFile: async (f: string, area: string, name: string, body: Uint8Array) =>
		void files.set(`${f}/${area}/${name}`, body),
	readFile: async (f: string, area: string, name: string) =>
		files.get(`${f}/${area}/${name}`) ?? null,
	removeFile: async (f: string, area: string, name: string) =>
		void files.delete(`${f}/${area}/${name}`)
}));

const games = await import('./own-games.ts');

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../drizzle` });
	await db.execute(sql`create role app_user nosuperuser nobypassrls`);
	await db.execute(sql`grant usage on schema public to app_user`);
	await db.execute(
		sql`grant select, insert, update, delete on all tables in schema public to app_user`
	);
	await db.execute(sql`grant usage on all sequences in schema public to app_user`);
	await db.insert(family).values([
		{ id: 'A', name: 'Casa A' },
		{ id: 'B', name: 'Casa B' }
	]);
	await db.insert(user).values(
		['ana', 'pepe', 'otro'].map((id) => ({
			id,
			name: id,
			email: `${id}@test.es`,
			createdAt: new Date(),
			updatedAt: new Date()
		}))
	);
	await db.insert(familyMember).values([
		{ userId: 'ana', familyId: 'A', role: 'admin' },
		{ userId: 'pepe', familyId: 'A', role: 'member', keepHistory: false },
		{ userId: 'otro', familyId: 'B', role: 'admin' }
	]);
});

const rows = () => asFamily('A', (tx) => tx.select().from(ownGame).orderBy(ownGame.title));

describe('«Tus juegos» (#564)', () => {
	test('saving the bucket lists its games', async () => {
		keys = [
			'Juegos/snes/Super Mario World (Europe).sfc',
			'Juegos/snes/Zelda.sfc',
			'Juegos/gba/Metroid Fusion (USA).gba',
			'Juegos/snes/portada.png'
		];
		expect(await games.saveSource('A', bucket)).toBeNull();
		// The listing goes on its own: once more, waited for (it is not taken twice).
		await new Promise((r) => setTimeout(r, 50));
		await games.indexGames('A');
		expect((await rows()).map((r) => [r.system, r.title, r.present])).toEqual([
			['gba', 'Metroid Fusion', true],
			['snes', 'Super Mario World', true],
			['snes', 'Zelda', true]
		]);
		const [source] = await asFamily('A', (tx) => tx.select().from(gameSource));
		expect(source.games).toBe(3);
		expect(source.scanningSince).toBeNull();
	});

	test('consoles in SYSTEMS’ order, and a console’s games by title', async () => {
		expect((await games.ownConsoles('A')).map((c) => [c.id, c.count])).toEqual([
			['snes', 2],
			['gba', 1]
		]);
		expect((await games.ownConsoleGames('A', 'snes')).games.map((g) => g.title)).toEqual([
			'Super Mario World',
			'Zelda'
		]);
	});

	test('the player asks for the rest at Seilide’s own', async () => {
		const p = await games.ownPlayer('A', 'snes', 'Zelda.sfc');
		expect(p.api).toBe('/api/juegos/propios');
		expect(p.rom).toBe(`/api/juegos/propios/rom/${p.gameId}/Zelda.sfc`);
		expect(p.cartridge).toBe(`/api/juegos/propios/cartucho/${p.gameId}`);
		expect(p.core).toBe('snes');
	});

	test('cartridge, saved games and time: each one’s own', async () => {
		const { gameId } = await games.ownPlayer('A', 'snes', 'Zelda.sfc');
		expect(await games.cartridgeOf('A', 'ana', gameId)).toEqual({ bytes: null, nobody: true });
		await games.saveCartridge('A', 'ana', gameId, new Uint8Array([1, 2]));
		expect((await games.cartridgeOf('A', 'ana', gameId)).bytes).toEqual(new Uint8Array([1, 2]));
		expect(await games.cartridgeOf('A', 'pepe', gameId)).toEqual({ bytes: null, nobody: false });

		const saveId = await games.addSave('A', 'ana', gameId, new Uint8Array([9]), null);
		expect((await games.savesOf('A', 'ana', gameId)).map((s) => s.id)).toEqual([saveId]);
		expect(await games.savesOf('A', 'pepe', gameId)).toEqual([]);
		await expect(games.ownSave('A', 'pepe', saveId)).rejects.toMatchObject({ status: 404 });
		expect(await games.saveState('A', saveId)).toEqual(new Uint8Array([9]));

		const session = await games.startSession('A', 'ana', gameId);
		expect(session).not.toBeNull();
		expect(await games.reportSession('A', 'ana', session!, 3)).toBe(true);
		expect(await games.reportSession('A', 'pepe', session!, 3)).toBe(false);
		// «Guardar lo que veo» off: nothing kept.
		expect(await games.startSession('A', 'pepe', gameId)).toBeNull();
		const summary = await games.ownGameSummary('A', 'ana', 'snes', 'Zelda.sfc');
		expect(summary.played.seconds).toBe(3);
		expect(summary.saves).toHaveLength(1);

		await games.removeSave('A', saveId);
		expect(await games.savesOf('A', 'ana', gameId)).toEqual([]);
		expect(await games.saveState('A', saveId)).toBeNull();
	});

	test('a game gone from the bucket is not found, and comes back with its cartridge', async () => {
		const { gameId } = await games.ownPlayer('A', 'snes', 'Zelda.sfc');
		keys = keys.filter((k) => !k.includes('Zelda'));
		await games.indexGames('A');
		await expect(games.ownPlayer('A', 'snes', 'Zelda.sfc')).rejects.toMatchObject({ status: 404 });
		keys.push('Juegos/snes/Zelda.sfc');
		await games.indexGames('A');
		const back = await games.ownPlayer('A', 'snes', 'Zelda.sfc');
		expect(back.gameId).toBe(gameId);
		expect((await games.cartridgeOf('A', 'ana', gameId)).bytes).not.toBeNull();
	});

	test('taken out: its games gone, their rows kept', async () => {
		await games.removeSource('A');
		expect(await games.ownConsoles('A')).toEqual([]);
		expect((await rows()).every((r) => !r.present)).toBe(true);
		expect(await games.sourceView('A')).toBeNull();
	});

	test('another family’s game is not found', async () => {
		const [row] = await rows();
		await expect(games.gameById('B', row.id)).rejects.toMatchObject({ status: 404 });
		const other = await asFamily('B', (tx) =>
			tx.select().from(ownGame).where(eq(ownGame.id, row.id))
		);
		expect(other).toEqual([]);
	});
});
