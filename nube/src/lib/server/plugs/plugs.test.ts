import { beforeAll, describe, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import * as schema from '../db/schema.ts';
import {
	bill as billTable,
	expense,
	family,
	familyMember,
	plugEnergy,
	user
} from '../db/schema.ts';
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
	setHomeSensor,
	setKwhPrice,
	setLocked,
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
		if (frame.method === 'Switch.GetStatus')
			result = {
				output: this.output,
				...(this.timer && { timer_started_at: Date.now() / 1000, timer_duration: this.timer })
			};
		queueMicrotask(() => this.say({ id: frame.id, src: 'x', dst: 'seilide', result }));
	}
	close(code?: number) {
		this.closed = code ?? 1000;
		for (const h of this.handlers.close ?? []) h();
	}
	terminate() {}
	ping() {}
}

/** The last on or off it was told (after it, Seilide asks for its timer). */
const lastSet = (ws: FakePlug) => ws.sent.findLast((f) => f.method === 'Switch.Set');

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
		expect(lastSet(ws)).toMatchObject({ method: 'Switch.Set', params: { id: 0, on: true } });
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
		const last = () => lastSet(lampWs);
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
		// Its page shows when it switches back.
		await settle();
		const until = (await listPlugs('ana'))[0]!.timerUntil;
		expect(Date.parse(until!) - Date.now()).toBeGreaterThan(1790_000);
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

	test('timer from Enchufes: on with the plug’s timer, and «Quitar» ends it', async () => {
		expect(await switchPlug('ana', lampId, true, 15 * 60)).toBe(true);
		expect(lastSet(lampWs)).toMatchObject({
			method: 'Switch.Set',
			params: { id: 0, on: true, toggle_after: 900 }
		});
		await settle();
		expect((await listPlugs('ana'))[0]!.timerUntil).not.toBeNull();
		// «Quitar»: switched as it is, without a timer.
		expect(await switchPlug('ana', lampId, true)).toBe(true);
		expect(lastSet(lampWs)!.params).toEqual({ id: 0, on: true });
		await settle();
		expect((await listPlugs('ana'))[0]!.timerUntil).toBeNull();
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
		expect(lamp).toMatchObject({
			online: false,
			waiting: false,
			reconnecting: false,
			output: true,
			power: null
		});
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
		expect(await kwhPrice('ana')).toMatchObject({ source: 'mano', flat: 0.15 });
		expect(await kwhPrice('otra')).toBeNull();
		await setKwhPrice('ana', null);
		expect(await kwhPrice('ana')).toBeNull();
	});

	test('the price from the last light bill; by hand, it wins; euros by the hour', async () => {
		const bill = async (periodEnd: string, details: object) => {
			const [e] = await asFamily('A', (tx) =>
				tx
					.insert(expense)
					.values({
						familyId: 'A',
						date: periodEnd,
						store: 'Pepeenergy',
						category: 'Facturas',
						total: 8309,
						source: 'factura'
					})
					.returning({ id: expense.id })
			);
			await asFamily('A', (tx) =>
				tx.insert(billTable).values({
					familyId: 'A',
					expenseId: e!.id,
					kind: 'Luz',
					periodStart: `${periodEnd.slice(0, 8)}01`,
					periodEnd,
					consumption: 280,
					unit: 'kWh',
					details: details as never
				})
			);
		};
		await bill('2026-08-31', { unitPrice: 0.15 });
		await bill('2026-09-30', {
			unitPrice: 0.198,
			pricing: 'fijo',
			electricityTax: 5.1127,
			vat: 21
		});
		expect(await kwhPrice('ana')).toMatchObject({
			source: 'factura',
			pricing: 'fijo',
			flat: 0.2518,
			from: 'Pepeenergy, septiembre 2026'
		});
		expect(await kwhPrice('otra')).toBeNull();
		// A kWh used this hour.
		const stove = await createPlug('ana', 'Estufa', 'otro');
		const hour = new Date();
		hour.setUTCMinutes(0, 0, 0);
		await asFamily('A', (tx) =>
			tx.insert(plugEnergy).values({ plugId: stove.id, familyId: 'A', hour, wh: 1000 })
		);
		const view = (await listPlugs('ana')).find((p) => p.id === stove.id)!;
		expect(view.todayEuros).toBeCloseTo(0.2518, 6);
		expect(view.monthEuros).toBeCloseTo(0.2518, 6);
		await deletePlug('ana', stove.id);
		await setKwhPrice('ana', 0.3);
		expect(await kwhPrice('ana')).toMatchObject({ source: 'mano', flat: 0.3 });
		await setKwhPrice('ana', null);
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

	test('with its padlock: not switched, paused nor scheduled, by hand or by voice; its schedules go on', async () => {
		// Another family cannot put it.
		expect(await setLocked('otra', termo, true)).toBe(false);
		expect(await setLocked('ana', termo, true)).toBe(true);
		expect((await listPlugs('ana')).find((p) => p.id === termo)!.locked).toBe(true);
		const sent = ws.sent.length;
		const jobs = JSON.stringify(ours());
		expect(await switchPlug('ana', termo, false)).toBe('locked');
		expect(await setPaused('ana', termo, true)).toEqual({ heats: false, locked: true });
		expect(await addSchedule('ana', termo, { days: [2], start: '10:00', end: '11:00' })).toEqual({
			problem: 'Tiene el candado puesto: quítalo antes'
		});
		const k = { familyId: 'A', run: (fn: never) => asFamily('A', fn) } as never;
		const voice = (await plugsForVoice(k))!;
		expect(voice.line).toContain('Termo (termo): ');
		expect(voice.line).toMatch(/Termo \(termo\): [^;]*con candado/);
		expect(await switchByVoice(k, voice.plugs, { name: 'termo', on: false })).toMatchObject({
			done: false,
			result: expect.stringContaining('candado')
		});
		expect(ws.sent.length).toBe(sent);
		expect(JSON.stringify(ours())).toBe(jobs);
		expect((await listPlugs('ana')).find((p) => p.id === termo)!.paused).toBe(false);
		// Without it, as before.
		expect(await setLocked('ana', termo, false)).toBe(true);
		expect(await switchPlug('ana', termo, false)).toBe(true);
	});

	test('its pause by voice and in Preguntar (#557): as on its card, once; the padlock stops it', async () => {
		const k = { familyId: 'A', run: (fn: never) => asFamily('A', fn) } as never;
		const { pauseByVoice } = await import('./voice.ts');
		const { applyPlugPause, proposePlugPause } = await import('./pause-card.ts');
		const plugs = async () => (await plugsForVoice(k))!.plugs;
		expect((await plugsForVoice(k))!.line).toContain('«plug_pause»');
		ws.output = true;
		expect(await pauseByVoice(k, await plugs(), { name: 'termo', paused: true })).toEqual({
			done: true,
			result: 'Termo en pausa: apagado y sin sus horarios hasta que se quite.'
		});
		expect(ws.output).toBe(false);
		expect(ours().every((j) => !j.enable)).toBe(true);
		expect(await pauseByVoice(k, await plugs(), { name: 'termo', paused: true })).toEqual({
			done: false,
			result: 'Termo ya está en pausa.'
		});
		expect((await pauseByVoice(k, await plugs(), { name: 'nada', paused: true })).result).toContain(
			'Los hay: '
		);

		// Preguntar: a card, done only when confirmed, and only once.
		const { card } = await proposePlugPause(k, { name: 'termo', paused: false });
		expect(card).toEqual({
			kind: 'pausa-enchufe',
			plugId: termo,
			name: 'Termo',
			paused: false,
			done: false,
			result: null
		});
		expect((await listPlugs('ana')).find((p) => p.id === termo)!.paused).toBe(true);
		const done = await applyPlugPause(k, card!);
		expect(done).toEqual({
			card: {
				...card!,
				done: true,
				result:
					'Termo sin pausa: calienta 4 horas seguidas, contra la legionela, y luego vuelven sus horarios.'
			}
		});
		expect((await listPlugs('ana')).find((p) => p.id === termo)!.paused).toBe(false);
		expect(await applyPlugPause(k, (done as { card: typeof card & object }).card)).toEqual(done);
		expect((await proposePlugPause(k, { name: 'termo', paused: false })).result).toBe(
			'Termo ya no está en pausa.'
		);

		// With its padlock: no card, and an old one not done.
		await setLocked('ana', termo, true);
		expect((await proposePlugPause(k, { name: 'termo', paused: true })).card).toBeUndefined();
		expect(await applyPlugPause(k, { ...card!, paused: true })).toEqual({
			problem: expect.stringContaining('candado')
		});
		expect(await pauseByVoice(k, await plugs(), { name: 'termo', paused: true })).toMatchObject({
			done: false
		});
		await setLocked('ana', termo, false);
		// The heat over by hand, as the tests after expect it.
		expect(await switchPlug('ana', termo, false)).toBe(true);
	});

	test('its schedules skipped for a while (#557): only their «on» off, by voice and in Preguntar', async () => {
		const k = { familyId: 'A', run: (fn: never) => asFamily('A', fn) } as never;
		const { momentSaid, skipByVoice, skipPlug } = await import('./voice.ts');
		const { addDays, localDay } = await import('comun/agenda.ts');
		const { applyPlugSkip, proposePlugSkip } = await import('./pause-card.ts');
		const plugs = async () => (await plugsForVoice(k))!.plugs;
		const today = localDay();
		// It is weekdays from 4:00 to 7:00: the voice sees them, and when it switches on next.
		const line = (await plugsForVoice(k))!.line;
		expect(line).toContain('«plug_skip»');
		expect(line).toMatch(
			/Termo \(termo\): [^;]*; horarios: L a V, de 4:00 a 7:00; se enciende solo (hoy|mañana|el [^;]+) a las 04:00/
		);

		// A while going on now (from today's start to three days on: some weekday's 4:00 in it).
		const p = (await plugs()).find((x) => x.id === termo)!;
		const going = {
			from: { day: today, time: '00:00' },
			to: { day: addDays(today, 3), time: '23:59' }
		};
		const done = await skipPlug(k, p, going);
		expect(done).toMatchObject({
			done: true,
			result: expect.stringMatching(
				/^Termo: no se enciende solo de hoy a las 00:00 a .+; se salta(n)? .+\. Luego vuelven sus horarios\.$/
			)
		});
		await settleLong();
		expect(ours().map((j) => [j.timespec, j.enable])).toEqual([
			['0 00 4 * * 1,2,3,4,5', false],
			['0 00 7 * * 1,2,3,4,5', true]
		]);
		const view = (await listPlugs('ana')).find((x) => x.id === termo)!;
		expect(view.skipFrom).not.toBeNull();
		expect((await plugsForVoice(k))!.line).toContain('(saltados)');
		// Not switched off, nor kept from being switched on by hand.
		expect(await switchPlug('ana', termo, true)).toBe(true);
		expect(await switchPlug('ana', termo, false)).toBe(true);

		// Back by voice: its jobs on again.
		expect(await skipByVoice(k, await plugs(), { name: 'termo', cancel: true })).toEqual({
			done: true,
			result: 'Termo: vuelven ya sus horarios.'
		});
		await settleLong();
		expect(ours().every((j) => j.enable)).toBe(true);
		expect(await skipByVoice(k, await plugs(), { name: 'termo', cancel: true })).toMatchObject({
			done: false
		});

		// A while with no switch-on in it: nothing done, said.
		const sunday = (() => {
			let d = addDays(today, 1);
			while (new Date(`${d}T12:00:00Z`).getUTCDay() !== 0) d = addDays(d, 1);
			return d;
		})();
		expect(
			await skipByVoice(k, await plugs(), {
				name: 'termo',
				from_day: sunday,
				from_time: '00:00',
				to_day: sunday,
				to_time: '23:59'
			})
		).toEqual({
			done: false,
			result: 'En ese rato los horarios de Termo no lo encienden: no hace falta nada.'
		});
		// Wrong whiles refused.
		expect(
			(await skipByVoice(k, await plugs(), { name: 'termo', from_day: today })).result
		).toContain('Falta');
		expect(
			(
				await skipByVoice(k, await plugs(), {
					name: 'termo',
					from_day: today,
					from_time: '00:00',
					to_day: addDays(today, 20),
					to_time: '00:00'
				})
			).result
		).toContain('Como mucho 14 días');

		// One to come (next Monday 3:00 to 8:00): its jobs stay on until then.
		const monday = (() => {
			let d = addDays(today, 1);
			while (new Date(`${d}T12:00:00Z`).getUTCDay() !== 1) d = addDays(d, 1);
			return d;
		})();
		const { card } = await proposePlugSkip(k, {
			name: 'termo',
			from_day: monday,
			from_time: '03:00',
			to_day: monday,
			to_time: '08:00'
		});
		expect(card).toEqual({
			kind: 'saltar-horario',
			plugId: termo,
			name: 'Termo',
			from: { day: monday, time: '03:00' },
			to: { day: monday, time: '08:00' },
			skipped: `de ${momentSaid({ day: monday, time: '03:00' })} a ${momentSaid({ day: monday, time: '08:00' })}; se salta su encendido de ${momentSaid({ day: monday, time: '04:00' })}`,
			done: false,
			result: null
		});
		expect((await listPlugs('ana')).find((x) => x.id === termo)!.skipFrom).toBeNull();
		const applied = await applyPlugSkip(k, card!);
		expect(applied).toMatchObject({
			card: { done: true, result: expect.stringContaining('se salta su encendido') }
		});
		await settleLong();
		expect(ours().every((j) => j.enable)).toBe(true);
		expect((await listPlugs('ana')).find((x) => x.id === termo)!.skipFrom).not.toBeNull();
		// Its time comes: synced at its edge, its «on» off.
		await asFamily('A', (tx) =>
			tx.execute(sql`update plug set skip_from = now() - interval '1 minute' where id = ${termo}`)
		);
		await hub.attach(token, ws);
		await settleLong();
		expect(ours().map((j) => j.enable)).toEqual([false, true]);
		// It ends: its jobs back.
		await asFamily('A', (tx) =>
			tx.execute(sql`update plug set skip_until = now() - interval '1 minute' where id = ${termo}`)
		);
		await hub.attach(token, ws);
		await settleLong();
		expect(ours().every((j) => j.enable)).toBe(true);
		expect((await listPlugs('ana')).find((x) => x.id === termo)!.skipFrom).toBeNull();

		// With its padlock: no card, not done by voice.
		await setLocked('ana', termo, true);
		expect(
			(
				await proposePlugSkip(k, {
					name: 'termo',
					from_day: monday,
					from_time: '03:00',
					to_day: monday,
					to_time: '08:00'
				})
			).card
		).toBeUndefined();
		expect(
			await skipByVoice(k, await plugs(), {
				name: 'termo',
				from_day: monday,
				from_time: '03:00',
				to_day: monday,
				to_time: '08:00'
			})
		).toMatchObject({ done: false, result: expect.stringContaining('candado') });
		await setLocked('ana', termo, false);
	});

	test('a schedule removed: its jobs gone from the plug', async () => {
		const [view] = (await listPlugs('ana')).filter((p) => p.id === termo);
		await deleteSchedule('ana', termo, view!.schedules[0]!.id);
		expect(ours()).toEqual([]);
		expect(ws.jobs.map((j) => j.id)).toEqual([1]);
	});
});

describe('consumo', () => {
	test('a week: by day, the one before as far in, each plug’s part; another family’s, no', async () => {
		const { plugStats, dayStart } = await import('./stats.ts');
		expect(dayStart('2026-11-08').toISOString()).toBe('2026-11-07T23:00:00.000Z');
		// The night the clocks go back: 25 hours, from midnight in summer time.
		expect(dayStart('2026-10-25').toISOString()).toBe('2026-10-24T22:00:00.000Z');
		const heater = await createPlug('ana', 'Calentador', 'termo');
		const fan = await createPlug('ana', 'Ventilador', 'otro');
		const rows = [
			{ plugId: heater.id, hour: '2026-11-08T05:00:00Z', wh: 1000 }, // Sunday 6:00
			{ plugId: heater.id, hour: '2026-11-06T05:00:00Z', wh: 500 }, // Friday
			{ plugId: fan.id, hour: '2026-11-06T17:00:00Z', wh: 500 },
			{ plugId: heater.id, hour: '2026-11-01T05:00:00Z', wh: 800 }, // the Sunday before, 6:00
			{ plugId: heater.id, hour: '2026-11-01T20:00:00Z', wh: 300 } // later than now, then
		];
		await asFamily('A', (tx) =>
			tx
				.insert(plugEnergy)
				.values(rows.map((r) => ({ ...r, familyId: 'A', hour: new Date(r.hour) })))
		);
		const now = new Date('2026-11-08T12:00:00Z');
		const week = (await plugStats('ana', {}, now))!;
		expect(week).toMatchObject({
			view: 'semana',
			title: 'Semana del 2 al 8 de noviembre',
			goingOn: true,
			prevDay: '2026-10-26',
			nextDay: null,
			total: { wh: 2000 },
			before: { wh: 800 }
		});
		expect(week.buckets.map((b) => b.wh)).toEqual([0, 0, 0, 0, 1000, 0, 1000]);
		expect(week.total.euros).toBeCloseTo(2 * 0.2518, 6);
		expect(week.byPlug.map((p) => [p.name, p.wh])).toEqual([
			['Calentador', 1500],
			['Ventilador', 500]
		]);
		// Each column's parts, by plug: Friday's from both.
		expect(week.buckets[4]!.parts).toEqual({ [heater.id]: 500, [fan.id]: 500 });
		expect(week.buckets[6]!.parts).toEqual({ [heater.id]: 1000 });
		expect(week.buckets[0]!.parts).toEqual({});
		// One plug, by the hour of a day.
		const day = (await plugStats('ana', { view: 'dia', plugId: heater.id }, now))!;
		expect(day.buckets[6]!.wh).toBe(1000);
		expect(day.byPlug).toEqual([]);
		// A whole week before: compared whole.
		const last = (await plugStats('ana', { day: '2026-11-01' }, now))!;
		expect(last).toMatchObject({ goingOn: false, total: { wh: 1100 }, nextDay: '2026-11-02' });
		// Not its plug; a day to come is today.
		expect(await plugStats('otra', { plugId: heater.id }, now)).toBeNull();
		expect((await plugStats('otra', {}, now))!.total.wh).toBe(0);
		expect((await plugStats('ana', { day: '2027-01-01' }, now))!.day).toBe('2026-11-08');
		await deletePlug('ana', heater.id);
		await deletePlug('ana', fan.id);
	});
});

describe('sensores (#508)', () => {
	test('a Shelly H&T: each reading kept, its plug heard from; not a plug, nor scheduled', async () => {
		const made = await createPlug('ana', 'Dormitorio', 'otro', 'shellyhtg3-d885ac153264');
		const ws = new FakePlug();
		await hub.attach(made.token, ws);
		ws.say({
			src: 'shellyhtg3-d885ac153264',
			dst: 'ws',
			method: 'NotifyFullStatus',
			params: {
				'devicepower:0': { id: 0, battery: { V: 6.59, percent: 100 }, external: { present: true } },
				'humidity:0': { id: 0, rh: 55.1 },
				'temperature:0': { id: 0, tC: 19.9, tF: 67.8 }
			}
		});
		await settle();
		const rows = await db
			.select()
			.from(schema.plugReading)
			.where(sql`${schema.plugReading.plugId} = ${made.id}`);
		expect(rows).toMatchObject([
			{ familyId: 'A', tempC: 19.9, humidity: 55.1, battery: 100, external: true }
		]);
		const [row] = await db
			.select({ lastSeenAt: schema.plug.lastSeenAt })
			.from(schema.plug)
			.where(sql`${schema.plug.id} = ${made.id}`);
		expect(row!.lastSeenAt).not.toBeNull();
		expect((await listPlugs('ana')).some((p) => p.id === made.id)).toBe(false);
		expect(ws.sent.map((f) => f.method)).not.toContain('Schedule.List');
		expect(ws.sent.map((f) => f.method)).not.toContain('Sys.GetConfig');
		// Another family's role does not see its readings.
		const others = await asFamily('B', (tx) => tx.select().from(schema.plugReading));
		expect(others).toEqual([]);
		ws.close();
	});

	test('Temperatura: its last reading, its line by the hour, and silent after 5 hours', async () => {
		const { sensorsIn } = await import('./sensors.ts');
		const made = await createPlug('ana', 'Salón', 'otro', 'shellyhtg3-aaaaaaaaaaaa');
		const at = (iso: string, tempC: number | null) => ({
			plugId: made.id,
			familyId: 'A',
			at: new Date(iso),
			tempC,
			humidity: 50,
			battery: 80,
			external: false
		});
		await db
			.insert(schema.plugReading)
			.values([
				at('2026-11-19T09:00:00Z', 19),
				at('2026-11-19T09:30:00Z', 20),
				at('2026-11-19T10:10:00Z', null),
				at('2026-11-19T10:20:00Z', 21.4)
			]);
		const since = new Date('2026-11-19T00:00:00Z');
		const read = (hourly: boolean, now: string) =>
			asFamily('A', (tx) => sensorsIn(tx, since, hourly, new Date(now)));
		const salon = (await read(true, '2026-11-19T11:00:00Z')).find((s) => s.id === made.id)!;
		// Spain's hours (UTC+1 in November); the failed reading left out.
		expect(salon).toMatchObject({
			name: 'Salón',
			tempC: 21.4,
			battery: 80,
			external: false,
			silent: false,
			points: [
				{ at: '2026-11-19T10:00', temperature: 19.5 },
				{ at: '2026-11-19T11:00', temperature: 21.4 }
			]
		});
		expect(
			(await read(false, '2026-11-19T11:00:00Z')).find((s) => s.id === made.id)!.points
		).toHaveLength(3);
		const silentAt = async (now: string) =>
			(await read(true, now)).find((s) => s.id === made.id)!.silent;
		// Asleep two hours at a time on batteries: one missed wake is not silence yet.
		expect(await silentAt('2026-11-19T15:19:00Z')).toBe(false);
		expect(await silentAt('2026-11-19T15:21:00Z')).toBe(true);
		expect(await asFamily('B', (tx) => sensorsIn(tx, since, true))).toEqual([]);
	});

	test('the sensor of «la casa» (#557): the only one; with several, the one marked, one at most', async () => {
		const { sensorsIn } = await import('./sensors.ts');
		const homes = async (family = 'A') =>
			(await asFamily(family, (tx) => sensorsIn(tx, new Date(), false)))
				.filter((s) => s.home)
				.map((s) => s.name);
		const sensors = (await asFamily('A', (tx) => sensorsIn(tx, new Date(), false))).length;
		const bedroom = await createPlug('ana', 'Dormitorio', 'otro', 'shellyhtg3-bbbbbbbbbbbb');
		const kitchen = await createPlug('ana', 'Cocina', 'otro', 'shellyhtg3-cccccccccccc');
		expect(sensors).toBeGreaterThan(0);
		expect(await homes()).toEqual([]);
		expect(await setHomeSensor('ana', bedroom.id, true)).toBe(true);
		expect(await homes()).toEqual(['Dormitorio']);
		expect(await setHomeSensor('ana', kitchen.id, true)).toBe(true);
		expect(await homes()).toEqual(['Cocina']);
		// Another family's cannot touch it.
		expect(await setHomeSensor('otra', bedroom.id, true)).toBe(false);
		expect(await homes()).toEqual(['Cocina']);
		expect(await setHomeSensor('ana', kitchen.id, false)).toBe(true);
		expect(await homes()).toEqual([]);
		await deletePlug('ana', bedroom.id);
		await deletePlug('ana', kitchen.id);
	});
});
