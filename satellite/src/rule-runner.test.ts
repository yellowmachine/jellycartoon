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

describe('«cumple la regla N», pedida por Seilide (#651, fase 4)', () => {
	test('a su hora sí, una vez; fuera de su hora o sin hora comprobada, no; y nunca sola', async () => {
		// «Si va a helar, enciende el calefactor del garaje a las 6:00, 60 minutos».
		const s = setup([
			termo({ when: { kind: 'cada_dia', time: '06:00' }, on: true, minutes: 60, asked: true })
		]);
		s.set(at('06:00'));
		s.runner.tick();
		await s.settle();
		expect(s.switched).toEqual([]);
		s.set(at('05:59'));
		expect(await s.runner.asked(PLUG, 1)).toEqual({ ok: false, why: 'no es su hora' });
		s.set(at('06:02'));
		s.clock(false);
		expect(await s.runner.asked(PLUG, 1)).toEqual({
			ok: false,
			why: 'no tiene la hora comprobada'
		});
		s.clock(true);
		expect(await s.runner.asked(PLUG, 1)).toEqual({ ok: true });
		expect(s.switched).toEqual([`${PLUG} on 60`]);
		expect(await s.runner.asked(PLUG, 1)).toEqual({ ok: false, why: 'ya la ha cumplido' });
		s.set(at('06:30'));
		expect(await s.runner.asked(PLUG, 1)).toEqual({ ok: false, why: 'no es su hora' });
		// It heard it: nothing left to tell later.
		await s.runner.flush();
		expect(s.told).toEqual([]);
	});

	test('solo las firmadas para pedirlas, y por su enchufe', async () => {
		const s = setup([
			termo({ id: 1, when: { kind: 'seilide' }, on: true, minutes: 30, asked: true }),
			termo({ id: 2 })
		]);
		expect(await s.runner.asked(PLUG, 2)).toMatchObject({ ok: false });
		expect(await s.runner.asked(PLUG, 9)).toMatchObject({ ok: false });
		expect(await s.runner.asked(WASHER, 1)).toEqual({
			ok: false,
			why: 'esa regla es de otro enchufe'
		});
		expect(s.switched).toEqual([]);
	});

	test('un ciclo que ha visto él mismo, hace poco', async () => {
		// «Cuando acabe la lavadora, si es de noche, apaga el termo».
		const s = setup([
			termo({ when: { kind: 'enchufe', plugs: [WASHER], moment: 'termina' }, asked: true })
		]);
		expect(await s.runner.asked(PLUG, 1)).toEqual({ ok: false, why: 'no ha visto ese ciclo' });
		s.runner.cycle(WASHER, 'finished');
		await s.settle();
		expect(s.switched).toEqual([]);
		s.set(at('21:03'));
		expect(await s.runner.asked(PLUG, 1)).toEqual({ ok: true });
		expect(await s.runner.asked(PLUG, 1)).toEqual({ ok: false, why: 'ya la ha cumplido' });
		s.set(at('21:30'));
		s.runner.cycle(WASHER, 'started');
		expect(await s.runner.asked(PLUG, 1)).toEqual({ ok: false, why: 'no ha visto ese ciclo' });
	});

	test('un momento que solo sabe Seilide: unas pocas veces al día, separadas', async () => {
		// «Cuando llegue a casa, enciende la estufa 30 minutos».
		const s = setup([termo({ when: { kind: 'seilide' }, on: true, minutes: 30, asked: true })]);
		s.set(at('08:00'));
		expect(await s.runner.asked(PLUG, 1)).toEqual({ ok: true });
		s.set(at('08:10'));
		expect(await s.runner.asked(PLUG, 1)).toEqual({
			ok: false,
			why: 'la cumplió hace menos de 30 minutos'
		});
		for (const t of ['09:00', '12:00', '18:00']) {
			s.set(at(t));
			expect(await s.runner.asked(PLUG, 1)).toEqual({ ok: true });
		}
		s.set(at('22:00'));
		expect(await s.runner.asked(PLUG, 1)).toEqual({
			ok: false,
			why: 'ya la ha cumplido 4 veces hoy'
		});
		s.set(at('08:00', '2026-11-29'));
		expect(await s.runner.asked(PLUG, 1)).toEqual({ ok: true });
		expect(s.switched).toHaveLength(5);
	});

	test('el candado también la para', async () => {
		const s = setup([termo({ when: { kind: 'seilide' }, on: true, minutes: 30, asked: true })]);
		s.rules.setGuards({ [PLUG]: { locked: true, paused: false, heatUntil: null } });
		expect(await s.runner.asked(PLUG, 1)).toEqual({ ok: true, failed: 'tiene el candado puesto' });
		expect(s.switched).toEqual([]);
	});
});
