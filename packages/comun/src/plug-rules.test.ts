import { describe, expect, test } from 'bun:test';
import {
	MAX_PLUG_MIN,
	planJobs,
	validPlan,
	sameRules,
	validRules,
	voiceChangeOk,
	type SatelliteRule
} from './plug-rules.ts';

const rule = (over: Partial<SatelliteRule> = {}): SatelliteRule => ({
	id: 1,
	when: { kind: 'en_fecha', day: '2026-11-28', time: '09:00' },
	plug: 'shellyplugmg3-1',
	on: true,
	minutes: 60,
	once: true,
	...over
});

describe('las reglas que guarda un satélite (#651)', () => {
	test('solo lo que sabe mirar, con sus límites', () => {
		expect(validRules({ version: 1, rules: [rule()] })).toBe(true);
		expect(validRules({ version: 0, rules: [] })).toBe(false);
		expect(validRules({ version: 1, rules: [rule({ minutes: MAX_PLUG_MIN + 1 })] })).toBe(false);
		expect(validRules({ version: 1, rules: [rule(), rule()] })).toBe(false);
		expect(validRules({ version: 1, rules: [{ ...rule(), script: 'x' }] })).toBe(false);
		expect(validRules({ version: 1, rules: [rule({ when: { kind: 'tiempo' } as never })] })).toBe(
			false
		);
		expect(validRules({ version: 1, rules: [rule({ plug: 'otra-cosa' })] })).toBe(false);
		expect(
			validRules({ version: 1, rules: [rule({ when: { kind: 'cada_dia', time: '25:00' } })] })
		).toBe(false);
	});

	test('la misma lista aunque venga en otro orden', () => {
		const a = rule({ when: { kind: 'enchufe', plugs: ['shellyb', 'shellya'], moment: 'termina' } });
		const b = {
			...rule({ when: { kind: 'enchufe', plugs: ['shellya', 'shellyb'], moment: 'termina' } })
		};
		expect(sameRules([a, rule({ id: 2 })], [rule({ id: 2 }), b])).toBe(true);
	});

	test('por voz: lo firmado no se cambia', () => {
		const own = (id: string) => id === 'shellyplugmg3-1';
		expect(voiceChangeOk([rule()], [rule(), rule({ id: 2 })], own)).toBe(true);
		expect(voiceChangeOk([rule()], [rule({ on: false })], own)).toBe(false);
		expect(voiceChangeOk([], [rule({ plug: 'shellyplugmg3-9' })], own)).toBe(false);
		expect(voiceChangeOk([rule()], [], own)).toBe(true);
	});
});

describe('el plan de los horarios de un enchufe (#651, fase 5)', () => {
	const base = [
		{ timespec: '0 0 7 * * 1', on: true, enable: true },
		{ timespec: '0 0 8 * * 1', on: false, enable: true }
	];
	const plan = { paused: false, heatUntil: null, skipFrom: null, skipUntil: null };
	const now = Date.parse('2026-11-28T18:00:00+01:00');
	const enables = (jobs: { enable: boolean }[]) => jobs.map((j) => j.enable);

	test('un día normal, todos; en pausa o calentando, ninguno; «esta tarde no», sin el de encender', () => {
		expect(enables(planJobs(base, plan, undefined, now))).toEqual([true, true]);
		expect(enables(planJobs(base, { ...plan, paused: true }, undefined, now))).toEqual([
			false,
			false
		]);
		expect(enables(planJobs(base, { ...plan, heatUntil: now + 1 }, undefined, now))).toEqual([
			false,
			false
		]);
		expect(enables(planJobs(base, { ...plan, heatUntil: now }, undefined, now))).toEqual([
			true,
			true
		]);
		const skip = { ...plan, skipFrom: now - 1, skipUntil: now + 1 };
		expect(enables(planJobs(base, skip, undefined, now))).toEqual([false, true]);
		expect(enables(planJobs(base, skip, undefined, now + 1))).toEqual([true, true]);
	});

	test('lo dicho sin firmar solo quita el de encender: nunca vuelve a poner nada', () => {
		const paused = { locked: false, paused: true, heatUntil: null };
		expect(enables(planJobs(base, plan, paused, now))).toEqual([false, true]);
		const skip = { ...paused, paused: false, skipFrom: now - 1, skipUntil: now + 1 };
		expect(enables(planJobs(base, plan, skip, now))).toEqual([false, true]);
		// Signed paused: no unsigned guard brings it back.
		expect(
			enables(planJobs(base, { ...plan, paused: true }, { ...paused, paused: false }, now))
		).toEqual([false, false]);
	});

	test('un plan con sentido: calentar como mucho un día, saltar como mucho dos semanas', () => {
		expect(validPlan(plan, now)).toBe(true);
		expect(validPlan({ ...plan, heatUntil: now + 4 * 3_600_000 }, now)).toBe(true);
		expect(validPlan({ ...plan, heatUntil: now + 2 * 86_400_000 }, now)).toBe(false);
		expect(validPlan({ ...plan, skipFrom: now }, now)).toBe(false);
		expect(validPlan({ ...plan, skipFrom: now, skipUntil: now - 1 }, now)).toBe(false);
		expect(validPlan({ ...plan, skipFrom: now, skipUntil: now + 30 * 86_400_000 }, now)).toBe(
			false
		);
		expect(validPlan({ ...plan, extra: 1 }, now)).toBe(false);
	});
});
