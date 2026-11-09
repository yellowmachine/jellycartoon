import { describe, expect, test } from 'bun:test';
import { createHub, PlugOffline, type HubDeps, type PlugSocket } from './hub.ts';
import type { KeyPlug } from './plug-key-scope.ts';
import { energyRise, hourOf, parseMessage, switchOf } from './shelly.ts';

/**
 * The plugs' hub (#396) with a fake Shelly: frames as a Plug M Gen3 sent them on 2026-11-07.
 */

const FULL = JSON.stringify({
	src: 'shellyplugmg3-9070696e4874',
	dst: 'ws',
	method: 'NotifyFullStatus',
	params: {
		ts: 1794072693.51,
		'switch:0': {
			id: 0,
			source: 'init',
			output: false,
			apower: 0.0,
			voltage: 234.8,
			aenergy: { total: 10.0 }
		},
		ws: { connected: true }
	}
});
const status = (sw: Record<string, unknown>) =>
	JSON.stringify({ src: 'x', dst: 'ws', method: 'NotifyStatus', params: { 'switch:0': sw } });

describe('shelly', () => {
	test('reads its switch', () => {
		expect(
			switchOf({ 'switch:0': { output: true, apower: 5.1, aenergy: { total: 0.414 } } })
		).toEqual({ output: true, power: 5.1, energyWh: 0.414 });
		expect(switchOf({ sys: { time: '18:48' } })).toBeNull();
		expect(switchOf({ 'switch:0': { source: 'WS_out' } })).toBeNull();
	});

	test('tells replies from notices', () => {
		expect(parseMessage('{"id":3,"src":"s","dst":"seilide","result":{"was_on":false}}')).toEqual({
			kind: 'reply',
			id: 3,
			result: { was_on: false },
			error: undefined
		});
		expect(parseMessage(FULL)).toMatchObject({
			kind: 'status',
			full: true,
			src: 'shellyplugmg3-9070696e4874',
			sw: { output: false, power: 0, energyWh: 10 }
		});
		expect(parseMessage('no json')).toBeNull();
		expect(parseMessage('{"method":"NotifyEvent","params":{}}')).toBeNull();
	});

	test('energy rises, starts from where it stands, survives a reset', () => {
		expect(energyRise(null, 34)).toBe(0);
		expect(energyRise(0.207, 0.414)).toBeCloseTo(0.207);
		expect(energyRise(34, 2)).toBe(2);
	});

	test('hours by their start', () => {
		expect(hourOf(new Date('2026-11-07T17:56:40Z')).toISOString()).toBe('2026-11-07T17:00:00.000Z');
	});
});

class FakePlug implements PlugSocket {
	sent: { id: number; method: string; params?: Record<string, unknown> }[] = [];
	closed: number | null = null;
	pings = 0;
	terminated = false;
	private handlers: Record<string, ((data?: unknown) => void)[]> = {};
	/** Answers each order by itself, unless told otherwise. */
	answer: ((method: string) => unknown) | null = () => ({});

	on(event: string, listener: (data?: unknown) => void) {
		(this.handlers[event] ??= []).push(listener);
	}
	emit(event: string, data?: unknown) {
		for (const h of this.handlers[event] ?? []) h(data);
	}
	say(text: string) {
		this.emit('message', Buffer.from(text));
	}
	send(text: string) {
		const frame = JSON.parse(text);
		this.sent.push(frame);
		if (this.answer)
			queueMicrotask(() =>
				this.say(
					JSON.stringify({
						id: frame.id,
						src: 'x',
						dst: 'seilide',
						result: this.answer!(frame.method)
					})
				)
			);
	}
	close(code?: number) {
		this.closed = code ?? 1000;
		this.emit('close');
	}
	terminate() {
		this.terminated = true;
		this.emit('close');
	}
	ping() {
		this.pings++;
	}
}

const LAMP: KeyPlug = { id: 'p1', familyId: 'A', name: 'Lámpara', energyWh: 10 };

function setup(plugs: Record<string, KeyPlug> = { tok: LAMP }) {
	const saved: { plugId: string; patch: Parameters<HubDeps['save']>[2] }[] = [];
	const energy: { plugId: string; hour: Date; wh: number }[] = [];
	let clock = new Date('2026-11-07T17:56:00Z');
	const deps: HubDeps = {
		plugOfToken: async (t) => plugs[t] ?? null,
		save: async (_f, plugId, patch) => void saved.push({ plugId, patch }),
		addEnergy: async (_f, plugId, hour, wh) => void energy.push({ plugId, hour, wh }),
		now: () => clock,
		log: () => {}
	};
	const hub = createHub(deps);
	return {
		hub,
		saved,
		energy,
		setClock: (d: string) => (clock = new Date(d))
	};
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('hub', () => {
	test('after Seilide starts, reconnecting until it is back, or for a while', async () => {
		const { hub, setClock } = setup();
		expect(hub.reconnecting('p1')).toBe(true);
		const ws = new FakePlug();
		await hub.attach('tok', ws);
		ws.close();
		expect(hub.reconnecting('p1')).toBe(false);
		setClock('2026-11-07T18:11:00Z');
		expect(hub.reconnecting('p2')).toBe(false);
	});

	test('an unknown token is closed', async () => {
		const { hub } = setup();
		const ws = new FakePlug();
		await hub.attach('otro', ws);
		expect(ws.closed).toBe(4401);
		expect(hub.connected('p1')).toBe(false);
	});

	test('what it says while its token is looked up is not lost', async () => {
		const { hub, saved } = setup();
		const ws = new FakePlug();
		const attaching = hub.attach('tok', ws);
		ws.say(FULL);
		await attaching;
		await tick();
		expect(hub.liveOf('p1')).toEqual({ online: true, output: false, power: 0, timerUntil: null });
		expect(saved.some((s) => s.patch.output === false && s.patch.energyWh === 10)).toBe(true);
	});

	test('asks who it is, and keeps it', async () => {
		const { hub, saved } = setup();
		const ws = new FakePlug();
		ws.answer = (m) =>
			m === 'Shelly.GetDeviceInfo'
				? { id: 'shellyplugmg3-9070696e4874', model: 'S3PL-30110EU' }
				: {};
		await hub.attach('tok', ws);
		await tick();
		await tick();
		expect(ws.sent[0]!.method).toBe('Shelly.GetDeviceInfo');
		expect(saved).toContainEqual({
			plugId: 'p1',
			patch: { deviceId: 'shellyplugmg3-9070696e4874', model: 'S3PL-30110EU' }
		});
	});

	test('orders go and their answers come back', async () => {
		const { hub } = setup();
		const ws = new FakePlug();
		await hub.attach('tok', ws);
		ws.answer = () => ({ was_on: false });
		expect(await hub.call('p1', 'Switch.Set', { id: 0, on: true })).toEqual({ was_on: false });
		expect(ws.sent.at(-1)).toMatchObject({ method: 'Switch.Set', params: { id: 0, on: true } });
	});

	test('an error from the plug is an error', async () => {
		const { hub } = setup();
		const ws = new FakePlug();
		await hub.attach('tok', ws);
		ws.answer = null;
		const asked = hub.call('p1', 'Switch.Set', { id: 0 });
		const id = ws.sent.at(-1)!.id;
		ws.say(JSON.stringify({ id, src: 'x', error: { code: -103, message: 'Invalid argument' } }));
		expect(asked).rejects.toThrow('Invalid argument');
	});

	test('not connected, or gone while waiting: PlugOffline', async () => {
		const { hub } = setup();
		expect(hub.call('p1', 'Switch.Set')).rejects.toBeInstanceOf(PlugOffline);
		const ws = new FakePlug();
		await hub.attach('tok', ws);
		ws.answer = null;
		const asked = hub.call('p1', 'Switch.Set');
		ws.emit('close');
		expect(asked).rejects.toBeInstanceOf(PlugOffline);
		expect(hub.liveOf('p1').online).toBe(false);
	});

	test('watts live only; on and off saved; energy by the hour', async () => {
		const { hub, saved, energy, setClock } = setup();
		const ws = new FakePlug();
		await hub.attach('tok', ws);
		saved.length = 0;
		ws.say(status({ output: true, source: 'WS_out' }));
		ws.say(status({ apower: 5.0 }));
		await tick();
		expect(hub.liveOf('p1')).toEqual({ online: true, output: true, power: 5, timerUntil: null });
		expect(saved).toEqual([{ plugId: 'p1', patch: { output: true, power: undefined } }]);

		setClock('2026-11-07T17:58:00Z');
		ws.say(status({ apower: 5.0, aenergy: { total: 10.207, by_minute: [207.159, 0, 0] } }));
		await tick();
		expect(energy).toHaveLength(1);
		expect(energy[0]!.hour.toISOString()).toBe('2026-11-07T17:00:00.000Z');
		expect(energy[0]!.wh).toBeCloseTo(0.207);

		// The same count again: nothing used.
		ws.say(status({ aenergy: { total: 10.207 } }));
		await tick();
		expect(energy).toHaveLength(1);
	});

	test('its timer: said when it starts; after a switch without one, asked, and gone', async () => {
		const { hub } = setup();
		const ws = new FakePlug();
		await hub.attach('tok', ws);
		ws.say(status({ output: true, timer_started_at: 1_794_100_000.5, timer_duration: 1800 }));
		await tick();
		expect(hub.liveOf('p1').timerUntil).toBe(1_794_101_800_500);
		// Its watts change: the timer stays.
		ws.say(status({ apower: 30 }));
		await tick();
		expect(hub.liveOf('p1').timerUntil).toBe(1_794_101_800_500);
		// Off (it ended, or someone switched it): asked, and the plug says none.
		ws.say(status({ output: false }));
		await tick();
		await tick();
		expect(ws.sent.at(-1)).toMatchObject({ method: 'Switch.GetStatus', params: { id: 0 } });
		expect(hub.liveOf('p1').timerUntil).toBeNull();
	});

	test("a change made in Seilide (a schedule, the pause): its family's pages told, once", async () => {
		const { hub } = setup();
		let told = 0;
		let others = 0;
		hub.watch('A', () => told++);
		hub.watch('B', () => others++);
		hub.changed('A');
		hub.changed('A');
		await new Promise((r) => setTimeout(r, 1100));
		expect(told).toBe(1);
		expect(others).toBe(0);
	});

	test('idle, almost nothing saved nor told: when it was heard, every 10 minutes', async () => {
		const { hub, saved, energy, setClock } = setup();
		let told = 0;
		hub.watch('A', () => told++);
		const ws = new FakePlug();
		ws.answer = () => ({});
		await hub.attach('tok', ws);
		ws.say(FULL);
		await new Promise((r) => setTimeout(r, 1100));
		saved.length = 0;
		told = 0;
		// An hour of its minute notices, off and with the same count.
		for (let minute = 1; minute <= 60; minute++) {
			setClock(new Date(Date.UTC(2026, 10, 7, 18, minute)).toISOString());
			ws.say(status({ apower: 0, aenergy: { total: 10.0 } }));
			await tick();
		}
		await new Promise((r) => setTimeout(r, 1100));
		expect(energy).toEqual([]);
		expect(told).toBe(0);
		expect(saved.length).toBe(6);
		expect(saved.every((s) => Object.keys(s.patch).length === 0)).toBe(true);
	});

	test('a second connection replaces the first', async () => {
		const { hub } = setup();
		const first = new FakePlug();
		await hub.attach('tok', first);
		const second = new FakePlug();
		await hub.attach('tok', second);
		expect(first.closed).toBe(4000);
		expect(hub.connected('p1')).toBe(true);
		second.answer = () => ({ ok: 1 });
		expect(await hub.call('p1', 'Sys.GetStatus')).toEqual({ ok: 1 });
	});

	test('one that does not answer pings is dropped', async () => {
		const { hub } = setup();
		const ws = new FakePlug();
		await hub.attach('tok', ws);
		hub.checkAlive();
		expect(ws.pings).toBe(1);
		ws.emit('pong');
		hub.checkAlive();
		expect(ws.terminated).toBe(false);
		hub.checkAlive();
		expect(ws.terminated).toBe(true);
		expect(hub.connected('p1')).toBe(false);
	});

	test('removed: told to stop connecting, then dropped', async () => {
		const { hub } = setup();
		const ws = new FakePlug();
		await hub.attach('tok', ws);
		await hub.remove('p1');
		expect(ws.sent.map((s) => s.method)).toContain('Ws.SetConfig');
		expect(ws.sent.find((s) => s.method === 'Ws.SetConfig')!.params).toEqual({
			config: { enable: false }
		});
		expect(ws.sent.map((s) => s.method)).toContain('Shelly.Reboot');
		expect(ws.closed).toBe(4410);
	});

	test('the family is told, at most once a second', async () => {
		const { hub } = setup();
		let told = 0;
		hub.watch('A', () => told++);
		const ws = new FakePlug();
		await hub.attach('tok', ws);
		for (let i = 0; i < 5; i++) ws.say(status({ apower: i }));
		await new Promise((r) => setTimeout(r, 1100));
		expect(told).toBe(1);
	});
});
