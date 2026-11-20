import { expect, test } from 'bun:test';
import { RULE_TEMPLATES } from '#lib/rule-templates.ts';
import { specOf, type RuleSpec, type TranslatedRule } from '#lib/rules.ts';
import type { SolarDay } from '#lib/solar.ts';
import { conditionsHold, solarFor, type Rule, type World } from './rule-check.ts';

/**
 * The rules' «placas» condition (#513 phase 4): what Energía → Previsión says the panels will do,
 * read in a made-up world: today with sun to spare from 11 to 15 and the battery out at 4 in the
 * morning, tomorrow cloudy.
 */
const DAY = '2026-11-16';
const solarDay = (day: string, over: Partial<SolarDay>): SolarDay => ({
	day,
	made: 14,
	used: 9,
	fromGrid: 1,
	toGrid: 4,
	full: true,
	emptyAt: null,
	spare: null,
	...over
});
const days: SolarDay[] = [
	solarDay(DAY, { emptyAt: 4, spare: { from: 11, to: 15, kwh: 5.6 } }),
	solarDay('2026-11-17', { made: 3, emptyAt: 19 })
];

const world = (time: string, solar: World['solar']): World => ({
	today: DAY,
	time,
	from: 0,
	to: 0,
	trips: async () => [],
	memories: async () => [],
	fridge: async () => [],
	agenda: async () => [],
	doses: async () => [],
	home: async () => null,
	forecast: async () => [],
	meaning: async () => null,
	solar
});

const rule = (conditions: RuleSpec['conditions']): Rule => ({
	id: 1,
	userId: 'yo',
	said: '',
	understood: '',
	spec: {
		when: { kind: 'cada_dia', words: [], minutesBefore: 0, time: '09:00' },
		conditions,
		notice: { to: 'yo', userIds: [], names: [], text: 'x', level: 'normal' },
		once: false
	},
	paused: false,
	lastFiredAt: null,
	lastWhy: null,
	fired: [],
	matches: {}
});
const r = rule([]);

test('sun to spare: the hours still to come, and none once they are gone', async () => {
	const w = world('09:00', async () => days);
	expect((await solarFor(w, r, 'sobra_sol')).hit).toBe(
		'hoy sobra sol de las placas de 11 a 15 (unos 6 kWh)'
	);
	expect(
		(
			await solarFor(
				world('12:30', async () => days),
				r,
				'sobra_sol'
			)
		).hit
	).toBe('hoy sobra sol de las placas de 12 a 15 (unos 6 kWh)');
	expect(
		await solarFor(
			world('16:00', async () => days),
			r,
			'sobra_sol'
		)
	).toEqual({
		hit: null,
		none: 'ya pasó el sol que sobraba hoy (de 11 a 15)'
	});
});

test('the battery tonight, and little sun tomorrow', async () => {
	const w = world('20:00', async () => days);
	expect((await solarFor(w, r, 'bateria_no_llega')).hit).toBe(
		'esta noche la batería se acaba a las 4 de madrugada'
	);
	expect((await solarFor(w, r, 'poco_sol_manana')).hit).toBe(
		'mañana las placas darán unos 3 kWh, menos de la mitad que hoy (14)'
	);
	const sunny = world('20:00', async () => [days[0]!, solarDay('2026-11-17', { made: 12 })]);
	expect((await solarFor(sunny, r, 'poco_sol_manana')).hit).toBeNull();
});

test('no panels, no forecast, or not known: never holds, and why', async () => {
	expect(
		(
			await solarFor(
				world('09:00', async () => null),
				r,
				'sobra_sol'
			)
		).none
	).toBe('no hay placas en Energía → Previsión');
	expect(
		(
			await solarFor(
				world('09:00', async () => 'falta lo que gasta la casa'),
				r,
				'sobra_sol'
			)
		).none
	).toBe('falta lo que gasta la casa');
	expect((await solarFor(world('09:00', undefined), r, 'sobra_sol')).none).toBe(
		'no sé lo que harán las placas'
	);
});

test('as a condition, negated too', async () => {
	const w = world('09:00', async () => days);
	expect(
		await conditionsHold(
			w,
			rule([{ kind: 'placas', words: [], negate: false, solar: 'sobra_sol' }])
		)
	).toEqual({
		ok: true,
		why: ['hoy sobra sol de las placas de 11 a 15 (unos 6 kWh)'],
		unknown: false
	});
	expect(
		(
			await conditionsHold(
				w,
				rule([{ kind: 'placas', words: [], negate: true, solar: 'bateria_no_llega' }])
			)
		).ok
	).toBe(false);
});

test('the AI’s rule: placas kept with what it checks, dropped without it', () => {
	const t: TranslatedRule = {
		possible: true,
		why_not: null,
		understood: 'Cada día a las 9, si sobra sol, aviso',
		when: {
			kind: 'cada_dia',
			words: [],
			minutes_before: 0,
			minutes_after: 0,
			time: '09:00',
			weather: { what: 'ninguno', hours: 0, threshold: null, where: 'casa' }
		},
		conditions: [
			{
				kind: 'placas',
				words: [],
				negate: false,
				weather: { what: 'ninguno', hours: 0, threshold: null, where: 'casa' },
				solar: 'sobra_sol'
			},
			{
				kind: 'placas',
				words: [],
				negate: false,
				weather: { what: 'ninguno', hours: 0, threshold: null, where: 'casa' },
				solar: 'ninguno'
			}
		],
		then: 'avisar',
		deduce: { text: '', days: 0 },
		timer: { minutes: 0, label: '' },
		notice: { to: 'yo', people: [], text: 'Pon la lavadora', level: 'normal' },
		once: false,
		say: false
	};
	const out = specOf(t, () => null);
	if (!('spec' in out)) throw new Error(out.problem);
	expect(out.spec.conditions).toEqual([
		{ kind: 'placas', words: [], negate: false, solar: 'sobra_sol' }
	]);
});

test('the ready ones with the panels are well made', () => {
	for (const id of ['sobra-sol', 'poco-sol-manana']) {
		const t = RULE_TEMPLATES.find((t) => t.id === id)!;
		expect(t.rules[0]!.spec.conditions[0]).toMatchObject({ kind: 'placas' });
	}
});
