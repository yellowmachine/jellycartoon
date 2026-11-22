import { describe, expect, test } from 'bun:test';
import { plugSaid, ruleSaid, specOf, type TranslatedRule } from './rules.ts';

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
	then: 'avisar',
	deduce: { text: '', days: 0 },
	timer: { minutes: 0, label: '' },
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
				then: 'avisar',
				deduce: null,
				timer: null,
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

	test('a place (#593): arriving or leaving; without saying, arriving', () => {
		const place = (moment: string) =>
			specOf(
				answer({
					when: {
						kind: 'lugar',
						words: ['casa'],
						minutes_before: 0,
						minutes_after: 0,
						time: null,
						weather: none,
						place: moment
					}
				}),
				resolve
			);
		expect(place('sale')).toMatchObject({
			spec: { when: { kind: 'lugar', words: ['casa'], place: 'sale' } }
		});
		expect(place('llega')).toMatchObject({ spec: { when: { place: 'llega' } } });
		expect(place('ninguno')).toMatchObject({ spec: { when: { place: 'llega' } } });
		expect('place' in (specOf(answer(), resolve) as { spec: { when: object } }).spec.when).toBe(
			false
		);
	});

	test('a plug (#528): when it starts or ends; without saying, when it ends', () => {
		const plug = (moment: string) =>
			specOf(
				answer({
					when: {
						kind: 'enchufe',
						words: ['lavadora'],
						minutes_before: 0,
						minutes_after: 0,
						time: null,
						weather: none,
						plug: moment
					}
				}),
				resolve
			);
		expect(plug('empieza')).toMatchObject({
			spec: { when: { kind: 'enchufe', words: ['lavadora'], plug: 'empieza' } }
		});
		expect(plug('termina')).toMatchObject({ spec: { when: { plug: 'termina' } } });
		expect(plug('ninguno')).toMatchObject({ spec: { when: { plug: 'termina' } } });
		// Another «when» has no plug moment.
		expect('plug' in (specOf(answer(), resolve) as { spec: { when: object } }).spec.when).toBe(
			false
		);
	});

	test('a rule that deduces (phase 4): what, until when, and no notice needed', () => {
		const made = specOf(
			answer({
				when: {
					kind: 'dicho',
					words: ['lavadora'],
					minutes_before: 0,
					minutes_after: 0,
					time: null,
					weather: none
				},
				conditions: [],
				then: 'deducir',
				deduce: { text: 'Hay ropa tendida', days: 0 },
				notice: { to: 'yo', people: [], text: '', level: 'normal' }
			}),
			resolve
		);
		expect(made).toMatchObject({
			spec: {
				when: { kind: 'dicho', words: ['lavadora'] },
				then: 'deducir',
				deduce: { text: 'Hay ropa tendida', days: 0 }
			}
		});
		expect(specOf(answer({ then: 'deducir', deduce: { text: ' ', days: 0 } }), resolve)).toEqual({
			problem: 'Falta qué deducir.'
		});
		expect(
			specOf(answer({ then: 'deducir', deduce: { text: 'Algo', days: 999 } }), resolve)
		).toMatchObject({ spec: { deduce: { days: 30 } } });
	});

	test('a rule that starts a timer in the house: how long, what for, never said out loud too', () => {
		const made = specOf(
			answer({
				when: {
					kind: 'compra',
					words: ['bebida'],
					minutes_before: 0,
					minutes_after: 0,
					time: null,
					weather: none
				},
				conditions: [],
				then: 'temporizador',
				timer: { minutes: 60, label: ' Sacar las bebidas del congelador ' },
				notice: { to: 'yo', people: [], text: '', level: 'normal' },
				say: true
			}),
			resolve
		);
		expect(made).toMatchObject({
			spec: {
				when: { kind: 'compra', words: ['bebida'] },
				then: 'temporizador',
				timer: { minutes: 60, label: 'Sacar las bebidas del congelador' },
				deduce: null,
				say: false
			}
		});
		const timer = (minutes: number, label: string) =>
			specOf(answer({ then: 'temporizador', timer: { minutes, label } }), resolve);
		expect(timer(0, 'Algo')).toEqual({
			problem: 'Falta cuánto tiene que durar el temporizador.'
		});
		expect(timer(30, ' ')).toEqual({ problem: 'Falta para qué es el temporizador.' });
		expect(timer(5000, 'Algo')).toMatchObject({ spec: { timer: { minutes: 1440 } } });
	});

	test('a sensor’s temperature (#557): «la casa» or a room by its name; one there is not, said', () => {
		const sensors = [
			{ id: 's1', name: 'Salón' },
			{ id: 's2', name: 'Dormitorio' }
		];
		const cold = (temperature: { sensor: string; compare: string; degrees: number }) =>
			specOf(
				answer({
					conditions: [
						{ kind: 'temperatura', words: [], negate: false, weather: none, temperature }
					]
				}),
				resolve,
				{ sensors }
			);
		expect(cold({ sensor: 'casa', compare: 'menos_de', degrees: 15 })).toMatchObject({
			spec: {
				conditions: [
					{
						kind: 'temperatura',
						temperature: { sensorId: null, name: null, below: true, degrees: 15 }
					}
				]
			}
		});
		expect(cold({ sensor: 'Dormitorio', compare: 'mas_de', degrees: 25.55 })).toMatchObject({
			spec: {
				conditions: [
					{ temperature: { sensorId: 's2', name: 'Dormitorio', below: false, degrees: 25.6 } }
				]
			}
		});
		expect(cold({ sensor: 'Cocina', compare: 'menos_de', degrees: 15 })).toEqual({
			problem: 'No hay un sensor «Cocina»: los hay «Salón», «Dormitorio».'
		});
		expect(cold({ sensor: 'casa', compare: 'ninguno', degrees: 0 })).toEqual({
			problem: 'Falta qué temperatura esperar.'
		});
		expect(
			specOf(
				answer({
					conditions: [
						{
							kind: 'temperatura',
							words: [],
							negate: false,
							weather: none,
							temperature: { sensor: 'casa', compare: 'menos_de', degrees: 15 }
						}
					]
				}),
				resolve
			)
		).toEqual({ problem: 'La familia no tiene sensores de temperatura en Enchufes.' });
		// Another condition keeps no temperature.
		expect(specOf(answer(), resolve, { sensors })).toMatchObject({
			spec: { conditions: [{ kind: 'de_viaje' }] }
		});
	});

	test('an errand (#557): one day at one time, once, switching a plug of the family by its name', () => {
		const plugs = [
			{ id: 'p1', name: 'Termo' },
			{ id: 'p2', name: 'Tele del salón' }
		];
		const now = { day: '2026-11-20', time: '18:00' };
		const errand = (over: Partial<TranslatedRule> = {}) =>
			specOf(
				answer({
					when: {
						kind: 'en_fecha',
						words: [],
						minutes_before: 0,
						minutes_after: 0,
						time: '09:00',
						day: '2026-11-21',
						weather: none
					},
					conditions: [],
					then: 'enchufe',
					plug_switch: { plug: 'Termo', on: true, minutes: 60 },
					notice: { to: 'yo', people: [], text: '', level: 'normal' },
					once: false,
					say: true,
					...over
				}),
				resolve,
				{ plugs, now }
			);
		expect(errand()).toMatchObject({
			spec: {
				when: { kind: 'en_fecha', day: '2026-11-21', time: '09:00' },
				then: 'enchufe',
				plug: { plugId: 'p1', name: 'Termo', on: true, minutes: 60 },
				timer: null,
				once: true,
				say: false
			}
		});
		// Off, and for no while: it stays so.
		expect(
			errand({ plug_switch: { plug: 'Tele del salón', on: false, minutes: 0 } })
		).toMatchObject({ spec: { plug: { plugId: 'p2', on: false, minutes: null } } });
		expect(errand({ plug_switch: { plug: 'Estufa', on: true, minutes: 30 } })).toEqual({
			problem: 'No hay un enchufe «Estufa»: los hay «Termo», «Tele del salón».'
		});
		expect(errand({ plug_switch: { plug: 'Termo', on: true, minutes: 300 } })).toEqual({
			problem: 'Un enchufe se programa como mucho 4 horas.'
		});
		const at = (day: string | null, time: string | null) =>
			errand({
				when: {
					kind: 'en_fecha',
					words: [],
					minutes_before: 0,
					minutes_after: 0,
					time,
					day,
					weather: none
				}
			});
		expect(at('2026-11-20', '17:59')).toEqual({
			problem: 'Las 17:59 del 2026-11-20 ya han pasado.'
		});
		expect(at('2026-11-20', '18:00')).toMatchObject({ spec: { when: { day: '2026-11-20' } } });
		expect(at('2026-02-30', '09:00')).toEqual({ problem: 'Falta qué día.' });
		expect(at('2026-11-21', null)).toEqual({ problem: 'Falta a qué hora mirarla.' });
		// Without plugs, said so; and a day only in «en_fecha».
		expect(specOf(answer({ then: 'enchufe' }), resolve)).toEqual({
			problem: 'La familia no tiene enchufes en Enchufes.'
		});
		expect(specOf(answer(), resolve)).toMatchObject({ spec: { when: { kind: 'agenda' } } });
		expect('day' in (specOf(answer(), resolve) as { spec: { when: object } }).spec.when).toBe(
			false
		);
	});
});

describe('ruleSaid', () => {
	test('an errand with its day and time first (#557, phase 3); another rule as understood', () => {
		const when = {
			kind: 'en_fecha' as const,
			words: [],
			minutesBefore: 0,
			time: '09:00',
			day: '2026-11-21'
		};
		expect(
			ruleSaid({ understood: 'Si en casa hay frío, encenderé «Termo».', spec: { when } })
		).toBe('El sábado 21 a las 09:00: si en casa hay frío, encenderé «Termo».');
		expect(
			ruleSaid({
				understood: 'Cada día a las 9, avisaré.',
				spec: { when: { ...when, kind: 'cada_dia' } }
			})
		).toBe('Cada día a las 9, avisaré.');
	});
});

describe('a plug’s pause (#557)', () => {
	test('understood: put or taken off, no while; said in each tense', () => {
		const made = (pause: string, minutes = 0) =>
			specOf(
				answer({
					when: {
						kind: 'en_fecha',
						words: [],
						minutes_before: 0,
						minutes_after: 0,
						time: '08:00',
						day: '2026-11-23',
						weather: none
					},
					conditions: [],
					then: 'enchufe',
					plug_switch: { plug: 'Termo', on: false, minutes, pause },
					notice: { to: 'yo', people: [], text: '', level: 'normal' }
				}),
				resolve,
				{ plugs: [{ id: 'p1', name: 'Termo' }] }
			);
		expect(made('poner', 90)).toMatchObject({
			spec: { plug: { plugId: 'p1', on: false, minutes: null, pause: true } }
		});
		expect(made('quitar')).toMatchObject({ spec: { plug: { pause: false } } });
		const switched = made('ninguno', 60) as { spec: { plug: object } };
		expect('pause' in switched.spec.plug).toBe(false);

		const p = { plugId: 'p1', name: 'Termo', on: true, minutes: 60 };
		expect(plugSaid(p, 'haria')).toBe('encendería «Termo» 1 hora');
		expect(plugSaid({ ...p, on: false, minutes: null }, 'hecho')).toBe('apagado «Termo»');
		expect(plugSaid({ ...p, pause: true }, 'hara')).toBe('pondrá en pausa «Termo»');
		expect(plugSaid({ ...p, pause: false }, 'hecho')).toBe('quitado la pausa de «Termo»');
		expect(plugSaid({ ...p, pause: false }, 'hacer')).toBe('quitar la pausa de «Termo»');
	});
});
