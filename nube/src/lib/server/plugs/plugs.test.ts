import { beforeAll, describe, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import * as schema from '../db/schema.ts';
import { family, familyMember, plugEnergy, user } from '../db/schema.ts';
import { familyOnlyScope, familyScope, NoFamily } from '../family-scope.ts';
import { plugKeyScope } from './plug-key-scope.ts';
import type { PlugSocket } from './hub.ts';

/**
 * Enchufes (#396) on a real Postgres (PGlite) as the app's role: a plug found by its token only,
 * each family its own, what it used today and this month, and removed.
 */
const db = drizzle(new PGlite(), { schema });
const withFamily = familyScope(db, { role: 'app_user' });
const asFamily = familyOnlyScope(db, { role: 'app_user' });
mock.module('../db/index.ts', () => ({ db }));
mock.module('../family.ts', () => ({ withFamily, asFamily, NoFamily }));

const { createPlug, deletePlug, hub, listPlugs, renewPlugToken, switchPlug, updatePlug } =
	await import('./plugs.ts');
const plugOfToken = plugKeyScope(db, { role: 'app_user' });

class FakePlug implements PlugSocket {
	sent: { id: number; method: string; params?: unknown }[] = [];
	closed: number | null = null;
	private handlers: Record<string, ((data?: unknown) => void)[]> = {};
	on(event: string, listener: (data?: unknown) => void) {
		(this.handlers[event] ??= []).push(listener);
	}
	say(frame: object) {
		for (const h of this.handlers.message ?? []) h(JSON.stringify(frame));
	}
	send(text: string) {
		const frame = JSON.parse(text);
		this.sent.push(frame);
		queueMicrotask(() => this.say({ id: frame.id, src: 'x', dst: 'seilide', result: {} }));
	}
	close(code?: number) {
		this.closed = code ?? 1000;
		for (const h of this.handlers.close ?? []) h();
	}
	terminate() {}
	ping() {}
}

const person = (id: string) => ({
	id,
	name: id,
	email: `${id}@test.es`,
	createdAt: new Date(),
	updatedAt: new Date()
});
const settle = () => new Promise((r) => setTimeout(r, 50));
const sw = (s: object) => ({
	src: 'x',
	dst: 'ws',
	method: 'NotifyStatus',
	params: { 'switch:0': s }
});

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../../drizzle` });
	await db.execute(sql`create role app_user nosuperuser nobypassrls`);
	await db.execute(sql`grant usage on schema public to app_user`);
	await db.execute(
		sql`grant select, insert, update, delete on all tables in schema public to app_user`
	);
	await db.execute(sql`grant usage, select on all sequences in schema public to app_user`);
	await db.insert(user).values(['ana', 'otra'].map(person));
	await db.insert(family).values([
		{ id: 'A', name: 'Casa A' },
		{ id: 'B', name: 'Casa B' }
	]);
	await db.insert(familyMember).values([
		{ userId: 'ana', familyId: 'A', role: 'admin' },
		{ userId: 'otra', familyId: 'B', role: 'admin' }
	]);
});

let lampId = '';
let lampToken = '';

describe('enchufes', () => {
	test('a new one waits for its plug; another family does not see it', async () => {
		const made = await createPlug('ana', '  Lámpara del salón ', 'lampara');
		lampId = made.id;
		lampToken = made.token;
		expect(lampToken).toMatch(/^[\w-]{43}$/);
		expect(await listPlugs('ana')).toMatchObject([
			{ name: 'Lámpara del salón', kind: 'lampara', waiting: true, online: false, todayWh: 0 }
		]);
		expect(await listPlugs('otra')).toEqual([]);
	});

	test('found by its token alone, as the app’s role', async () => {
		expect(await plugOfToken(lampToken)).toMatchObject({ id: lampId, familyId: 'A' });
		expect(await plugOfToken('x'.repeat(43))).toBeNull();
		expect(await plugOfToken('corto')).toBeNull();
	});

	test('connected: on, watts, and what it used by the hour', async () => {
		const ws = new FakePlug();
		await hub.attach(lampToken, ws);
		ws.say({
			src: 'shellyplugmg3-1',
			dst: 'ws',
			method: 'NotifyFullStatus',
			params: { 'switch:0': { output: false, apower: 0, aenergy: { total: 100 } } }
		});
		await settle();
		expect(await switchPlug('ana', lampId, true)).toBe(true);
		expect(ws.sent.at(-1)).toMatchObject({ method: 'Switch.Set', params: { id: 0, on: true } });
		ws.say(sw({ output: true, source: 'WS_out' }));
		ws.say(sw({ apower: 5 }));
		ws.say(sw({ apower: 5, aenergy: { total: 100.25 } }));
		ws.say(sw({ apower: 5, aenergy: { total: 100.5 } }));
		await settle();
		const [lamp] = await listPlugs('ana');
		expect(lamp).toMatchObject({ online: true, waiting: false, output: true, power: 5 });
		expect(lamp!.todayWh).toBeCloseTo(0.5);
		expect(lamp!.monthWh).toBeCloseTo(0.5);
		// Another family cannot switch it.
		expect(await switchPlug('otra', lampId, false)).toBe(false);
	});

	test('today and this month by the family’s days; older ones left out', async () => {
		const hours = [
			// 40 days ago: neither.
			{ at: new Date(Date.now() - 40 * 86_400_000), wh: 1000 }
		];
		await asFamily('A', (tx) =>
			tx.insert(plugEnergy).values(
				hours.map(({ at, wh }) => {
					const hour = new Date(at);
					hour.setUTCMinutes(0, 0, 0);
					return { plugId: lampId, familyId: 'A', hour, wh };
				})
			)
		);
		const [lamp] = await listPlugs('ana');
		expect(lamp!.todayWh).toBeCloseTo(0.5);
		expect(lamp!.monthWh).toBeCloseTo(0.5);
	});

	test('gone off line: last known, no watts', async () => {
		const [before] = await listPlugs('ana');
		expect(before!.online).toBe(true);
		// Its connection drops.
		const ws = new FakePlug();
		await hub.attach(lampToken, ws); // replaces the first
		ws.close();
		await settle();
		const [lamp] = await listPlugs('ana');
		expect(lamp).toMatchObject({ online: false, waiting: false, output: true, power: null });
	});

	test('renamed; a new address and the old one no longer valid', async () => {
		await updatePlug('ana', lampId, '', 'lavadora');
		expect((await listPlugs('ana'))[0]).toMatchObject({ name: 'Lavadora', kind: 'lavadora' });
		const fresh = await renewPlugToken('ana', lampId);
		expect(await plugOfToken(lampToken)).toBeNull();
		expect(await plugOfToken(fresh!)).toMatchObject({ id: lampId });
		expect(await renewPlugToken('otra', lampId)).toBeNull();
		lampToken = fresh!;
	});

	test('removed: told to stop connecting, and its hours go with it', async () => {
		const ws = new FakePlug();
		await hub.attach(lampToken, ws);
		await settle();
		await deletePlug('otra', lampId);
		expect(await listPlugs('ana')).toHaveLength(1);
		await deletePlug('ana', lampId);
		expect(ws.sent.map((s) => s.method)).toContain('Ws.SetConfig');
		expect(ws.closed).toBe(4410);
		expect(await listPlugs('ana')).toEqual([]);
		const left = await asFamily('A', (tx) => tx.select().from(plugEnergy));
		expect(left).toEqual([]);
	});
});
