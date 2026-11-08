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

const {
	addSchedule,
	createPlug,
	deleteSchedule,
	deletePlug,
	hub,
	kwhPrice,
	listPlugs,
	renewPlugToken,
	setKwhPrice,
	setPaused,
	switchPlug,
	updatePlug
} = await import('./plugs.ts');
const { plugsForVoice, switchByVoice } = await import('./voice.ts');
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
	/** As a Plug M Gen3 keeps them: its jobs (one of Shelly's own), its time zone, its switch. */
	jobs: { id: number; enable: boolean; timespec: string; calls: unknown[] }[] = [
		{
			id: 1,
			enable: true,
			timespec: '0 0 0 * * 0,1,2,3,4,5,6',
			calls: [{ method: 'Shelly.Update' }]
		}
	];
	nextJob = 2;
	tz: string | null = null;
	output = false;
	timer: number | null = null;
	send(text: string) {
		const frame = JSON.parse(text);
		this.sent.push(frame);
		const p = frame.params ?? {};
		let result: unknown = {};
		if (frame.method === 'Schedule.List') result = { jobs: structuredClone(this.jobs) };
		if (frame.method === 'Schedule.Create') {
			const id = this.nextJob++;
			// It gives its minutes back with two digits.
			const timespec = p.timespec.replace(/^0 (\d) /, '0 0$1 ');
			this.jobs.push({ id, enable: p.enable, timespec, calls: p.calls });
			result = { id, rev: id };
		}
		if (frame.method === 'Schedule.Delete') this.jobs = this.jobs.filter((j) => j.id !== p.id);
		if (frame.method === 'Sys.GetConfig') result = { location: { tz: this.tz } };
		if (frame.method === 'Sys.SetConfig') this.tz = p.config.location.tz;
		if (frame.method === 'Switch.Set') {
			result = { was_on: this.output };
			this.output = p.on;
			this.timer = p.toggle_after ?? null;
		}
		queueMicrotask(() => this.say({ id: frame.id, src: 'x', dst: 'seilide', result }));
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
let lampWs: FakePlug;

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
		const ws = (lampWs = new FakePlug());
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

	test('by voice for a while: the plug’s own timer, and when it ends said back', async () => {
		const k = { familyId: 'A', run: (fn: never) => asFamily('A', fn) } as never;
		const plugs = (await plugsForVoice(k))!.plugs;
		const last = () => lampWs.sent.at(-1);
		const now = new Date('2026-11-08T14:00:00Z').getTime();
		// On for half an hour: on now, off by itself after.
		expect(
			await switchByVoice(k, plugs, { name: 'lámpara', on: true, for_minutes: 30 }, now)
		).toEqual({
			result: 'Lámpara del salón encendido durante 30 min: se apaga a las 15:30.',
			done: true
		});
		expect(last()).toMatchObject({
			method: 'Switch.Set',
			params: { on: true, toggle_after: 1800 }
		});
		// Off in an hour while on: kept on now, off after.
		const on = plugs.map((p) => ({ ...p, output: true }));
		expect(
			await switchByVoice(k, on, { name: 'lámpara', on: false, in_minutes: 60 }, now)
		).toMatchObject({
			result: 'Lámpara del salón se apaga a las 16:00, dentro de 60 min.',
			done: true
		});
		expect(last()).toMatchObject({
			method: 'Switch.Set',
			params: { on: true, toggle_after: 3600 }
		});
		const sent = lampWs.sent.length;
		// Already as asked, «dentro de» has nothing to do; too long or both, refused.
		expect(
			await switchByVoice(k, on, { name: 'lámpara', on: true, in_minutes: 60 }, now)
		).toMatchObject({ result: 'Lámpara del salón ya está encendido.', done: false });
		expect(
			(await switchByVoice(k, on, { name: 'lámpara', on: true, for_minutes: 2000 }, now)).done
		).toBe(false);
		expect(
			(
				await switchByVoice(
					k,
					on,
					{ name: 'lámpara', on: true, for_minutes: 5, in_minutes: 5 },
					now
				)
			).done
		).toBe(false);
		expect(lampWs.sent.length).toBe(sent);
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

	test('the price of a kWh, the family’s', async () => {
		expect(await kwhPrice('ana')).toBeNull();
		await setKwhPrice('ana', 0.15);
		expect(await kwhPrice('ana')).toBeCloseTo(0.15);
		expect(await kwhPrice('otra')).toBeNull();
		await setKwhPrice('ana', null);
		expect(await kwhPrice('ana')).toBeNull();
	});
});

describe('horarios, pausa y calentamiento', () => {
	let termo = '';
	let token = '';
	let ws: FakePlug;
	const settleLong = () => new Promise((r) => setTimeout(r, 150));
	const ours = () => ws.jobs.filter((j) => j.id !== 1);

	test('connected: its time zone set, Shelly’s own job left alone', async () => {
		const made = await createPlug('ana', 'Termo', 'termo');
		termo = made.id;
		token = made.token;
		ws = new FakePlug();
		await hub.attach(token, ws);
		await settleLong();
		expect(ws.tz).toBe('Europe/Madrid');
		expect(ws.jobs.map((j) => j.id)).toEqual([1]);
	});

	test('a schedule: on and off jobs on the plug; the same again, nothing rewritten', async () => {
		expect(
			await addSchedule('ana', termo, { days: [1, 2, 3, 4, 5], start: '04:00', end: '07:00' })
		).toEqual({ ok: true });
		expect(ours().map((j) => [j.timespec, j.enable])).toEqual([
			['0 00 4 * * 1,2,3,4,5', true],
			['0 00 7 * * 1,2,3,4,5', true]
		]);
		const [view] = (await listPlugs('ana')).filter((p) => p.id === termo);
		expect(view!.schedules).toMatchObject([
			{ days: [1, 2, 3, 4, 5], start: '04:00', end: '07:00' }
		]);
		// Connecting again with them already there: not rewritten.
		const before = ws.sent.length;
		await hub.attach(token, ws);
		await settleLong();
		expect(ws.sent.slice(before).some((f) => f.method === 'Schedule.Create')).toBe(false);
		// Wrong ones are refused; not another family's plug.
		expect(await addSchedule('ana', termo, { days: [], start: '04:00', end: '07:00' })).toEqual({
			problem: 'Elige algún día'
		});
		expect(await addSchedule('otra', termo, { days: [1], start: '04:00', end: '07:00' })).toEqual({
			problem: 'Ese enchufe ya no está'
		});
	});

	test('paused: off, its jobs off, it cannot be switched on; Shelly’s job untouched', async () => {
		ws.output = true;
		expect(await setPaused('ana', termo, true)).toEqual({ heats: false });
		expect(ws.output).toBe(false);
		expect(ours().every((j) => !j.enable)).toBe(true);
		expect(ws.jobs.find((j) => j.id === 1)!.enable).toBe(true);
		expect(await switchPlug('ana', termo, true)).toBe('paused');
		expect((await listPlugs('ana')).find((p) => p.id === termo)!.paused).toBe(true);
	});

	test('out of a pause with nothing used for a week: 4 hours on, its jobs back after', async () => {
		expect(await setPaused('ana', termo, false)).toEqual({ heats: true });
		expect(ws.output).toBe(true);
		expect(ws.timer).toBeGreaterThan(4 * 3600 - 5);
		expect(ours().every((j) => !j.enable)).toBe(true);
		const view = (await listPlugs('ana')).find((p) => p.id === termo)!;
		expect(view.heatUntil).not.toBeNull();
		// Switched off by hand: the heat is over, its jobs on at once.
		expect(await switchPlug('ana', termo, false)).toBe(true);
		expect(ws.output).toBe(false);
		expect(ours().every((j) => j.enable)).toBe(true);
		expect((await listPlugs('ana')).find((p) => p.id === termo)!.heatUntil).toBeNull();
		// Or it ends by itself: paused and back again, heating, then its time passes.
		await setPaused('ana', termo, true);
		expect(await setPaused('ana', termo, false)).toEqual({ heats: true });
		expect(ours().every((j) => !j.enable)).toBe(true);
		// The heat over: its jobs on again.
		await asFamily('A', (tx) =>
			tx.execute(sql`update plug set heat_until = now() - interval '1 minute' where id = ${termo}`)
		);
		await hub.attach(token, ws);
		await settleLong();
		expect(ours().every((j) => j.enable)).toBe(true);
		expect((await listPlugs('ana')).find((p) => p.id === termo)!.heatUntil).toBeNull();
	});

	test('a lamp out of a pause does not heat', async () => {
		const lamp = await createPlug('ana', 'Lámpara', 'lampara');
		await setPaused('ana', lamp.id, true);
		expect(await setPaused('ana', lamp.id, false)).toEqual({ heats: false });
		await deletePlug('ana', lamp.id);
	});

	test('a schedule removed: its jobs gone from the plug', async () => {
		const [view] = (await listPlugs('ana')).filter((p) => p.id === termo);
		await deleteSchedule('ana', termo, view!.schedules[0]!.id);
		expect(ours()).toEqual([]);
		expect(ws.jobs.map((j) => j.id)).toEqual([1]);
	});
});
