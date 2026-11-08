import { beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq, sql } from 'drizzle-orm';
import * as schema from '#lib/server/db/schema.ts';
import { family, familyMember, user, walk, walkPhoto, walkShare } from '#lib/server/db/schema.ts';
import { familyScope } from '#lib/server/family-scope.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import type { StoredPoint } from '#lib/trips.ts';
import { createShare, listShares, revokeShare, walkSharesOf } from './share.ts';
import { shareReader } from './share-scope.ts';

/**
 * Walks shared by link (#434) on PGlite with the migrations as they are, as the app's role, to
 * which row-level security applies: what a link opens, and nothing else.
 */
const db = drizzle(new PGlite(), { schema });
const withFamily = familyScope(db, { role: 'app_user' });
const reader = shareReader(db, { role: 'app_user' });
const kitchen = (userId: string, familyId: string): Kitchen => ({
	familyId,
	userId,
	run: (fn) => withFamily(userId, (tx) => fn(tx))
});
const ana = kitchen('ana', 'A');
const luis = kitchen('luis', 'A');
const berta = kitchen('berta', 'B');

const line: StoredPoint[] = Array.from({ length: 100 }, (_, i) => [-1.13, 37.98 + i * 0.0001, i]);
let walkId = 0;
let photos: number[] = [];

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../../drizzle` });
	await db.execute(sql`create role app_user nosuperuser nobypassrls`);
	await db.execute(sql`grant usage on schema public to app_user`);
	await db.execute(
		sql`grant select, insert, update, delete on all tables in schema public to app_user`
	);
	await db.execute(sql`grant usage on all sequences in schema public to app_user`);
	const person = (id: string, name = id) => ({
		id,
		name,
		email: `${id}@test.es`,
		createdAt: new Date(),
		updatedAt: new Date()
	});
	await db.insert(user).values([person('ana', 'Ana María'), person('luis'), person('berta')]);
	await db.insert(family).values([
		{ id: 'A', name: 'Casa A' },
		{ id: 'B', name: 'Casa B' }
	]);
	await db.insert(familyMember).values([
		{ userId: 'ana', familyId: 'A', role: 'admin' },
		{ userId: 'luis', familyId: 'A', role: 'member' },
		{ userId: 'berta', familyId: 'B', role: 'admin' }
	]);
});

beforeEach(async () => {
	await db.execute(sql`truncate walk_share, walk_photo, walk cascade`);
	const [w] = await db
		.insert(walk)
		.values({
			familyId: 'A',
			userId: 'ana',
			startedAt: new Date('2026-11-08T09:00:00Z'),
			endedAt: new Date('2026-11-08T10:00:00Z'),
			distance: 1100,
			points: line.length,
			line,
			diagnosis: { fixes: 0, hiddenFixes: 0, musicFixes: 0, hiddenSeconds: 0, gaps: [] }
		})
		.returning({ id: walk.id });
	walkId = w!.id;
	const at = new Date('2026-11-08T09:30:00Z');
	const rows = await db
		.insert(walkPhoto)
		.values([
			{
				familyId: 'A',
				userId: 'ana',
				walkId,
				clientId: 'c1',
				file: 'casa.jpg',
				at,
				lon: -1.13,
				lat: 37.9801
			},
			{
				familyId: 'A',
				userId: 'ana',
				walkId,
				clientId: 'c2',
				file: 'lejos.jpg',
				at,
				lon: -1.13,
				lat: 37.985
			},
			{
				familyId: 'A',
				userId: 'ana',
				walkId,
				clientId: 'c3',
				file: 'otra.webp',
				at,
				lon: null,
				lat: null
			}
		])
		.returning({ id: walkPhoto.id });
	photos = rows.map((r) => r.id);
});

async function made(k = ana, options = {}) {
	const result = await createShare(k, walkId, {
		label: 'Grupo del cole',
		photoIds: photos,
		trim: true,
		...options
	});
	if (!result.ok) throw new Error(result.problem);
	return result.token;
}

describe('walks shared by link (#434)', () => {
	test('its link opens it: first name, km, trimmed way, the photos chosen without their place near home', async () => {
		const token = await made();
		const seen = await reader.open(token, { counted: true });
		expect(seen).toMatchObject({ name: 'Ana María', distance: 1100, seconds: 3600, trimmed: true });
		expect(seen!.pieces.length).toBe(1);
		expect(seen!.pieces[0]!.length).toBeLessThan(line.length);
		// The WebP is not shared; the one near home, without its place.
		expect(seen!.photos).toEqual([
			{ id: photos[0]!, lon: null, lat: null },
			{ id: photos[1]!, lon: -1.13, lat: 37.985 }
		]);
		const [row] = await db.select().from(walkShare);
		expect(row).toMatchObject({ opens: 1, label: 'Grupo del cole' });
		expect(row!.tokenHash).not.toBe(token);
	});

	test('a preview is not counted; untrimmed, the whole way', async () => {
		const token = await made(ana, { trim: false });
		const seen = await reader.open(token, { counted: false });
		expect(seen!.pieces[0]).toHaveLength(line.length);
		expect(seen!.photos[0]).toMatchObject({ lon: -1.13, lat: 37.9801 });
		expect((await db.select().from(walkShare))[0]!.opens).toBe(0);
	});

	test('its photos: only those chosen, by their file in its family', async () => {
		const token = await made(ana, { photoIds: [photos[1]!] });
		expect(await reader.photo(token, photos[1]!)).toEqual({ familyId: 'A', file: 'lejos.jpg' });
		expect(await reader.photo(token, photos[0]!)).toBeNull();
		expect(await reader.photo(token, photos[2]!)).toBeNull();
	});

	test('taken back, or its walk deleted: nothing', async () => {
		const token = await made();
		const other = await made(ana, { label: 'Mamá' });
		const [first] = (await walkSharesOf(ana, walkId)).filter((s) => s.label === 'Grupo del cole');
		await revokeShare(ana, first!.id);
		expect(await reader.open(token, { counted: true })).toBeNull();
		expect(await reader.photo(token, photos[1]!)).toBeNull();
		expect(await reader.open(other, { counted: true })).not.toBeNull();
		await db.delete(walk).where(eq(walk.id, walkId));
		expect(await reader.open(other, { counted: true })).toBeNull();
	});

	test('a token that does not exist, or is not one', async () => {
		await made();
		expect(await reader.open('x'.repeat(43), { counted: true })).toBeNull();
		expect(await reader.open("' or 1=1 --", { counted: true })).toBeNull();
	});

	test("only one's own walk is shared, and only one's own links are seen or taken back", async () => {
		expect(
			await createShare(luis, walkId, { label: null, photoIds: [], trim: true })
		).toMatchObject({
			ok: false,
			status: 404
		});
		expect(
			await createShare(berta, walkId, { label: null, photoIds: [], trim: true })
		).toMatchObject({
			ok: false,
			status: 404
		});
		const token = await made();
		const [mine] = await listShares(ana);
		expect(mine).toMatchObject({ label: 'Grupo del cole', distance: 1100 });
		expect(await listShares(luis)).toEqual([]);
		expect(await listShares(berta)).toEqual([]);
		await revokeShare(luis, mine!.id);
		await revokeShare(berta, mine!.id);
		expect(await reader.open(token, { counted: false })).not.toBeNull();
	});

	test("the photos chosen can only be the walk's own", async () => {
		const [elsewhere] = await db
			.insert(walk)
			.values({
				familyId: 'A',
				userId: 'luis',
				startedAt: new Date('2026-11-07T09:00:00Z'),
				endedAt: new Date('2026-11-07T10:00:00Z'),
				diagnosis: { fixes: 0, hiddenFixes: 0, musicFixes: 0, hiddenSeconds: 0, gaps: [] }
			})
			.returning({ id: walk.id });
		const [his] = await db
			.insert(walkPhoto)
			.values({
				familyId: 'A',
				userId: 'luis',
				walkId: elsewhere!.id,
				clientId: 'l1',
				file: 'suya.jpg',
				at: new Date()
			})
			.returning({ id: walkPhoto.id });
		await made(ana, { photoIds: [photos[1]!, his!.id] });
		expect((await db.select().from(walkShare))[0]!.photoIds).toEqual([photos[1]!]);
	});

	test('without a family set, nothing of it is seen', async () => {
		await made();
		const rows = await db.transaction(async (tx) => {
			await tx.execute(sql`select set_config('role', 'app_user', true)`);
			return tx.select().from(walkShare);
		});
		expect(rows).toEqual([]);
	});
});
