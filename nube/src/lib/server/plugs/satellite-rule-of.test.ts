import { describe, expect, test } from 'bun:test';
import type { Rule } from '#lib/server/rule-check.ts';
import type { RuleSpec } from '#lib/rules.ts';
import { satelliteRuleOf, type PlugRow } from './satellite-rule-of.ts';

const FP = 'huella-del-dormitorio-x';
const plugs: PlugRow[] = [
	{ id: 'p1', name: 'Termo', kind: 'termo', deviceId: 'shellyplugmg3-1', satelliteFp: FP },
	{ id: 'p2', name: 'Lavadora', kind: 'lavadora', deviceId: 'shellyplugmg3-2', satelliteFp: FP },
	{
		id: 'p3',
		name: 'Lámpara',
		kind: 'lampara',
		deviceId: 'shellyplugmg3-3',
		satelliteFp: 'otro-satelite-xxxxxxxx'
	}
];

const rule = (spec: Partial<RuleSpec>, over: Partial<Rule> = {}): Rule => ({
	id: 7,
	userId: null,
	said: '',
	understood: '',
	paused: false,
	lastFiredAt: null,
	lastWhy: null,
	fired: [],
	matches: {},
	...over,
	spec: {
		when: { kind: 'cada_dia', words: [], minutesBefore: 0, time: '22:00' },
		conditions: [],
		then: 'enchufe',
		plug: { plugId: 'p1', name: 'Termo', on: false, minutes: null },
		notice: { to: 'casa', userIds: [], names: [], text: '', level: 'normal' },
		once: false,
		...spec
	}
});

describe('qué reglas puede hacer un satélite él solo (#651)', () => {
	test('a una hora, con un enchufe suyo', () => {
		expect(satelliteRuleOf(rule({}), plugs, FP)).toEqual({
			id: 7,
			when: { kind: 'cada_dia', time: '22:00' },
			plug: 'shellyplugmg3-1',
			on: false,
			minutes: null,
			once: false
		});
	});

	test('cuando acaba la lavadora, si la lavadora también pasa por él', () => {
		const r = rule({
			when: { kind: 'enchufe', words: ['lavadora'], minutesBefore: 0, time: null, plug: 'termina' },
			plug: { plugId: 'p1', name: 'Termo', on: true, minutes: 60 }
		});
		expect(satelliteRuleOf(r, plugs, FP)?.when).toEqual({
			kind: 'enchufe',
			plugs: ['shellyplugmg3-2'],
			moment: 'termina'
		});
		// The lamp goes through another satellite: not by itself.
		const lamp = rule({
			when: { kind: 'enchufe', words: ['lampara'], minutesBefore: 0, time: null, plug: 'empieza' }
		});
		expect(satelliteRuleOf(lamp, plugs, FP)).toBeNull();
	});

	test('lo que no puede mirar él solo, en Seilide', () => {
		expect(
			satelliteRuleOf(
				rule({ when: { kind: 'tiempo', words: [], minutesBefore: 0, time: null } }),
				plugs,
				FP
			)
		).toBeNull();
		expect(
			satelliteRuleOf(
				rule({ conditions: [{ kind: 'de_viaje', words: [], negate: false }] }),
				plugs,
				FP
			)
		).toBeNull();
		expect(satelliteRuleOf(rule({ then: 'avisar' }), plugs, FP)).toBeNull();
		expect(
			satelliteRuleOf(
				rule({ plug: { plugId: 'p1', name: 'Termo', on: false, minutes: null, pause: true } }),
				plugs,
				FP
			)
		).toBeNull();
		expect(
			satelliteRuleOf(
				rule({ plug: { plugId: 'p3', name: 'Lámpara', on: true, minutes: null } }),
				plugs,
				FP
			)
		).toBeNull();
		expect(satelliteRuleOf(rule({}, { paused: true }), plugs, FP)).toBeNull();
		expect(
			satelliteRuleOf(rule({ once: true }, { lastFiredAt: new Date() }), plugs, FP)
		).toBeNull();
	});

	test('nunca más de cuatro horas encendido', () => {
		const r = rule({ plug: { plugId: 'p1', name: 'Termo', on: true, minutes: 600 } });
		expect(satelliteRuleOf(r, plugs, FP)?.minutes).toBe(240);
	});
});
