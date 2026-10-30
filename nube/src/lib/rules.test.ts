import { describe, expect, test } from 'bun:test';
import { specOf, type TranslatedRule } from './rules.ts';

const none = { what: 'ninguno', hours: 0, threshold: null, where: 'casa' };

/** What the AI answers for a rule (#331), checked before it is kept. */
const answer = (over: Partial<TranslatedRule> = {}): TranslatedRule => ({
	possible: true,
	why_not: null,
	understood: 'Cuando empiece algo con «padres», si estás de viaje, te avisaré.',
	when: {
		kind: 'agenda',
		words: ['padres'],
		minutes_before: 0,
		minutes_after: 0,
		time: null,
		weather: none
	},
	conditions: [{ kind: 'de_viaje', words: [], negate: false, weather: none }],
	notice: { to: 'yo', people: [], text: 'Recuérdales lo de las plantas', level: 'normal' },
	once: false,
	say: false,
	...over
});

const family = [{ userId: 'u-ana', name: 'Ana María' }];
const resolve = (name: string) =>
	family.find((p) => p.name.toLowerCase().startsWith(name.toLowerCase())) ?? null;

describe('specOf', () => {
	test('a rule the server can check', () => {
		const made = specOf(answer(), resolve);
		expect(made).toEqual({
			spec: {
				when: { kind: 'agenda', words: ['padres'], minutesBefore: 0, time: null },
				conditions: [{ kind: 'de_viaje', words: [], negate: false }],
				notice: {
					to: 'yo',
					userIds: [],
					names: [],
					text: 'Recuérdales lo de las plantas',
					level: 'normal'
				},
				once: false,
				say: false
			}
		});
	});

	test('people become their accounts; one not in the family, said', () => {
		const to = (people: string[]) =>
			specOf(
				answer({ notice: { to: 'personas', people, text: 'Hola', level: 'normal' } }),
				resolve
			);
		expect(to(['Ana'])).toMatchObject({
			spec: { notice: { userIds: ['u-ana'], names: ['Ana María'] } }
		});
		expect(to(['Pepe'])).toEqual({
			problem: 'No hay nadie con cuenta llamado Pepe en la familia.'
		});
		expect(to([])).toEqual({ problem: 'Falta a quién avisar.' });
	});

	test('what it cannot check, with why', () => {
		expect(specOf(answer({ possible: false, why_not: 'Aún no sé del tiempo.' }), resolve)).toEqual({
			problem: 'Aún no sé del tiempo.'
		});
		expect(
			specOf(
				answer({
					when: {
						kind: 'cada_dia',
						words: [],
						minutes_before: 0,
						minutes_after: 0,
						time: '25:00',
						weather: none
					}
				}),
				resolve
			)
		).toEqual({ problem: 'Falta a qué hora mirarla.' });
		expect(
			specOf(
				answer({
					when: {
						kind: 'luna_llena',
						words: [],
						minutes_before: 0,
						minutes_after: 0,
						time: null,
						weather: none
					}
				}),
				resolve
			)
		).toEqual({ problem: 'No he entendido cuándo mirarla.' });
	});

	test('unknown conditions left out, and minutes kept within a week', () => {
		const made = specOf(
			answer({
				when: {
					kind: 'agenda',
					words: ['padres'],
					minutes_before: 99_999,
					minutes_after: 0,
					time: null,
					weather: none
				},
				conditions: [
					{ kind: 'llueve', words: [], negate: false, weather: none },
					{ kind: 'nevera', words: ['leche'], negate: true, weather: none }
				]
			}),
			resolve
		);
		expect(made).toMatchObject({
			spec: {
				when: { minutesBefore: 7 * 24 * 60 },
				conditions: [{ kind: 'nevera', words: ['leche'], negate: true }]
			}
		});
	});

	test('the weather (phase 3): its own thresholds when none is said, and a condition without one left out', () => {
		const made = specOf(
			answer({
				when: {
					kind: 'tiempo',
					words: [],
					minutes_before: 0,
					minutes_after: 0,
					time: null,
					weather: { what: 'lluvia', hours: 3, threshold: null, where: 'donde_este' }
				},
				conditions: [
					{ kind: 'tiempo', words: [], negate: false, weather: none },
					{
						kind: 'tiempo',
						words: [],
						negate: false,
						weather: { what: 'helada', hours: 500, threshold: -2, where: 'casa' }
					}
				]
			}),
			resolve
		);
		expect(made).toMatchObject({
			spec: {
				when: {
					kind: 'tiempo',
					weather: { what: 'lluvia', hours: 3, threshold: 60, where: 'donde_este' }
				},
				conditions: [
					{ kind: 'tiempo', weather: { what: 'helada', hours: 72, threshold: -2, where: 'casa' } }
				]
			}
		});
		expect(
			specOf(
				answer({
					when: {
						kind: 'tiempo',
						words: [],
						minutes_before: 0,
						minutes_after: 0,
						time: null,
						weather: none
					}
				}),
				resolve
			)
		).toEqual({ problem: 'Falta qué tiempo esperar.' });
	});

	test('a dose not marked: half an hour after, unless said', () => {
		const dose = (minutes_after: number) =>
			specOf(
				answer({
					when: {
						kind: 'toma_sin_marcar',
						words: ['Papá'],
						minutes_before: 0,
						minutes_after,
						time: null,
						weather: none
					}
				}),
				resolve
			);
		expect(dose(0)).toMatchObject({
			spec: { when: { kind: 'toma_sin_marcar', words: ['Papá'], minutesAfter: 30 } }
		});
		expect(dose(45)).toMatchObject({ spec: { when: { minutesAfter: 45 } } });
	});
});
