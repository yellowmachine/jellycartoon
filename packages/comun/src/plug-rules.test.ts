import { describe, expect, test } from 'bun:test';
import {
	MAX_PLUG_MIN,
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
