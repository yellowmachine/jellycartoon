import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RuleDone, SatelliteRule } from '../../packages/comun/src/plug-rules.ts';
import { createRunner, localNow } from './rule-runner.ts';
import { createRules } from './rules.ts';
import { createTrust } from './trust.ts';

const PLUG = 'shellyplugmg3-1';
const WASHER = 'shellyplugmg3-2';
const ZONE = 'Europe/Madrid';
/** 2026-11-28 at that time in Madrid (UTC+1 in winter), in ms. */
const at = (time: string, day = '2026-11-28') => Date.parse(`${day}T${time}:00+01:00`);

function setup(list: SatelliteRule[], opts: { clock?: boolean; offline?: boolean } = {}) {
	const d = mkdtempSync(join(tmpdir(), 'runner-'));
	let ago = 0;
	const rules = createRules({
		file: join(d, 'reglas.json'),
		trust: createTrust(join(d, 'seguridad.json')),
		orderAgo: () => ago,
		ownPlug: () => true,
		log: () => {}
	});
	rules.offer({ version: 1, rules: list });
	ago = Infinity;
	let t = at('21:00');
	let clock = opts.clock ?? true;
	let offline = opts.offline ?? false;
	const switched: string[] = [];
	const told: RuleDone[] = [];
	const runner = createRunner({
		rules,
		switchPlug: async (id, on, minutes) => {
			switched.push(`${id} ${on ? 'on' : 'off'}${minutes ? ` ${minutes}` : ''}`);
		},
		clockOk: () => clock,
		send: async (done) => {
			if (offline) throw new Error('sin internet');
			told.push(...done);
		},
		log: () => {},
		now: () => t,
		timeZone: ZONE
	});
	const settle = () => new Promise((r) => setTimeout(r, 10));
	return {
		rules,
		runner,
		switched,
		told,
		settle,
		set: (ms: number) => (t = ms),
		clock: (on: boolean) => (clock = on),
		online: () => (offline = false)
	};
}

const termo = (over: Partial<SatelliteRule> = {}): SatelliteRule => ({
	id: 1,
	when: { kind: 'cada_dia', time: '22:00' },
	plug: PLUG,
	on: false,
	minutes: null,
	once: false,
	...over
});

describe('el satélite cumple sus reglas (#651, fase 3)', () => {
	test('su hora, en su zona', () => {
		expect(localNow(at('22:03'), ZONE)).toEqual({ day: '2026-11-28', minutes: 22 * 60 + 3 });
	});

	test('a su hora, una sola vez, y se lo cuenta a Seilide', async () => {
		const s = setup([termo()]);
		s.runner.tick();
		expect(s.switched).toEqual([]);
		s.set(at('22:00'));
		s.runner.tick();
		s.set(at('22:01'));
		s.runner.tick();
		await s.settle();
		expect(s.switched).toEqual([`${PLUG} off`]);
		expect(s.told).toMatchObject([{ id: 1, key: '2026-11-28 22:00' }]);
		expect(s.told[0]!.failed).toBeUndefined();
	});

	test('sin la hora comprobada, nada; comprobada a tiempo, se hace', async () => {
		const s = setup([termo()], { clock: false });
		s.set(at('22:00'));
		s.runner.tick();
		expect(s.switched).toEqual([]);
		s.clock(true);
		s.set(at('22:04'));
		s.runner.tick();
		await s.settle();
		expect(s.switched).toEqual([`${PLUG} off`]);
	});

	test('con más de cinco minutos de retraso, se deja; un encargo, se cuenta como perdido', async () => {
		const s = setup([
			termo(),
			termo({ id: 2, when: { kind: 'en_fecha', day: '2026-11-28', time: '21:30' }, once: true })
		]);
		s.set(at('22:30'));
		s.runner.tick();
		await s.settle();
		expect(s.switched).toEqual([]);
		expect(s.told).toMatchObject([{ id: 2, missed: true }]);
	});

	test('cuando acaba la lavadora, sin mirar el reloj', async () => {
		const s = setup(
			[
				termo({
					when: { kind: 'enchufe', plugs: [WASHER], moment: 'termina' },
					on: true,
					minutes: 60
				})
			],
			{ clock: false }
		);
		s.runner.cycle(WASHER, 'started');
		s.runner.cycle(PLUG, 'finished');
		expect(s.switched).toEqual([]);
		s.runner.cycle(WASHER, 'finished');
		await s.settle();
		expect(s.switched).toEqual([`${PLUG} on 60`]);
	});

	test('con candado o en pausa no se toca, y se cuenta por qué', async () => {
		const s = setup([termo()]);
		s.rules.setGuards({ [PLUG]: { locked: false, paused: true, heatUntil: null } });
		s.set(at('22:00'));
		s.runner.tick();
		await s.settle();
		expect(s.switched).toEqual([]);
		expect(s.told).toMatchObject([{ id: 1, failed: 'está en pausa' }]);
	});

	test('sin internet: lo hace igual y lo cuenta al volver', async () => {
		const s = setup([termo()], { offline: true });
		s.set(at('22:00'));
		s.runner.tick();
		await s.settle();
		expect(s.switched).toEqual([`${PLUG} off`]);
		expect(s.told).toEqual([]);
		expect(s.rules.outbox()).toHaveLength(1);
		s.online();
		await s.runner.flush();
		expect(s.told).toHaveLength(1);
		expect(s.rules.outbox()).toHaveLength(0);
	});
});
