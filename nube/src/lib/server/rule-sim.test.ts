import { describe, expect, test } from 'bun:test';
import type { HourAhead } from 'comun/weather.ts';
import type { RuleSpec } from '#lib/rules.ts';
import { minutesOf, momentOf, type Rule, type World } from './rule-check.ts';
import { simulate, type Deduced } from './rule-sim.ts';

/**
 * «¿Qué pasaría…?» (#389) in a world made up here: a Wednesday with rain in the afternoon, the
 * grandparents coming at 17:00, Ana's pill at 9:00 not marked; nothing read nor written.
 */
const DAY = '2026-11-04';

const notice = (text: string): RuleSpec['notice'] => ({
	to: 'yo',
	userIds: [],
	names: [],
	text,
	level: 'normal'
});

let ids = 0;
const ruleOf = (
	spec: Partial<RuleSpec> & Pick<RuleSpec, 'when'>,
	extra: Partial<Rule> = {}
): Rule => {
	const id = ++ids;
	return {
		id,
		userId: 'yo',
		said: `regla ${id}`,
		understood: `Regla ${id}`,
		spec: { conditions: [], notice: notice(`aviso ${id}`), once: false, ...spec },
		paused: false,
		lastFiredAt: null,
		lastWhy: null,
		fired: [],
		matches: {},
		...extra
	};
};

const when = (w: Partial<RuleSpec['when']> & Pick<RuleSpec['when'], 'kind'>): RuleSpec['when'] => ({
	words: [],
	minutesBefore: 0,
	time: null,
	...w
});

const hours: HourAhead[] = Array.from({ length: 24 }, (_, h) => ({
	at: `${DAY}T${String(h).padStart(2, '0')}:00`,
	temperature: 15,
	rain: h >= 15 && h <= 18 ? 80 : 5,
	wind: 10,
	code: 3
}));

function worldAt(minute: number, deduced: readonly Deduced[]): World {
	const { day, time } = momentOf(minute);
	return {
		today: day,
		time,
		from: minute,
		to: minute,
		trips: async () => [],
		memories: async (r) => deduced.filter((d) => !d.userId || d.userId === r.userId),
		fridge: async () => ['leche'],
		agenda: async () => [
			{
				eventId: 1,
				title: 'Vienen los abuelos',
				day: DAY,
				lastDay: DAY,
				startTime: '17:00',
				endTime: null,
				people: [],
				repeats: false
			}
		],
		doses: async () => [
			{ time: '09:00', name: 'Pastilla', personId: 'p1', who: 'Ana', taken: false }
		],
		home: async () => ({ lat: 37.6, lon: -2.1 }),
		forecast: async (_lat, _lon, d, t) => hours.filter((h) => h.at >= `${d}T${t.slice(0, 2)}:00`),
		meaning: async () => null
	};
}

const run = (rules: Rule[], from: string, to: string) =>
	simulate({
		rules,
		from: minutesOf(DAY, from),
		to: minutesOf(DAY, to),
		world: worldAt,
		tells: async () => ({ how: 'te avisaría' })
	});

describe('¿Qué pasaría…?', () => {
	test('by the clock, at its time, and in order', async () => {
		const out = await run(
			[
				ruleOf({ when: when({ kind: 'agenda', words: ['abuelos'], minutesBefore: 60 }) }),
				ruleOf({ when: when({ kind: 'cada_dia', time: '08:30' }) }),
				ruleOf({ when: when({ kind: 'toma_sin_marcar', words: ['Ana'] }) })
			],
			'08:00',
			'23:59'
		);
		expect(out.map((o) => [o.at, o.does])).toEqual([
			['08:30', 'avisa'],
			['09:30', 'avisa'],
			['16:00', 'avisa']
		]);
		expect(out[1]!.said).toContain('la toma de las 09:00 de Ana (Pastilla) sigue sin marcar');
		expect(out[2]!.said).toContain('va a empezar «Vienen los abuelos»');
	});

	test('out of the span: not its time, said so', async () => {
		const [o] = await run(
			[ruleOf({ when: when({ kind: 'cada_dia', time: '21:00' }) })],
			'08:00',
			'08:59'
		);
		expect(o!.does).toBeNull();
		expect(o!.said).toBe('Entonces no le toca: se mira cada día a las 21:00.');
	});

	test('the weather: the first half hour it comes, once', async () => {
		const rain = { what: 'lluvia', hours: 3, threshold: 60, where: 'casa' } as const;
		const out = await run(
			[ruleOf({ when: when({ kind: 'tiempo', weather: rain }) })],
			'10:00',
			'23:59'
		);
		expect(out).toHaveLength(1);
		expect(out[0]!.at).toBe('13:00');
		expect(out[0]!.said).toContain('va a llover (80 % a las 15:00) en casa');
	});

	test('a condition that does not hold: why not, at its time', async () => {
		const [o] = await run(
			[
				ruleOf({
					when: when({ kind: 'cada_dia', time: '09:00' }),
					conditions: [{ kind: 'nevera', words: ['pan'], negate: false }]
				})
			],
			'08:00',
			'23:59'
		);
		expect(o!.at).toBe('09:00');
		expect(o!.does).toBeNull();
		expect(o!.said).toBe('No avisaría: son las 09:00 pero no hay nada en la nevera con «pan».');
	});

	test('a deduction, remembered for the rules after it and through the chain', async () => {
		const washing = ruleOf({
			when: when({ kind: 'cada_dia', time: '10:00' }),
			then: 'deducir',
			deduce: { text: 'Hay ropa tendida', days: 0 }
		});
		const rainOnClothes = ruleOf({
			when: when({
				kind: 'tiempo',
				weather: { what: 'lluvia', hours: 3, threshold: 60, where: 'casa' }
			}),
			conditions: [{ kind: 'recuerdo', words: ['ropa', 'tendida'], negate: false }]
		});
		const chained = ruleOf({ when: when({ kind: 'recuerdo', words: ['ropa'] }) });
		const out = await run([rainOnClothes, chained, washing], '09:00', '23:59');
		expect(out.map((o) => [o.at, o.does, o.understood])).toEqual([
			['10:00', 'deduce', washing.understood],
			['10:00', 'avisa', chained.understood],
			['13:00', 'avisa', rainOnClothes.understood]
		]);
		expect(out[2]!.said).toContain('recuerdo «Hay ropa tendida»');
	});

	test('what waits for something to happen: whether it would hold then; paused, nothing', async () => {
		const out = await run(
			[
				ruleOf({
					when: when({ kind: 'nevera', words: ['leche'] }),
					conditions: [{ kind: 'agenda_hoy', words: ['abuelos'], negate: false }]
				}),
				ruleOf({ when: when({ kind: 'cada_dia', time: '08:30' }) }, { paused: true })
			],
			'08:00',
			'08:59'
		);
		expect(out.map((o) => o.said)).toEqual([
			'Se mira cuando ponen en la nevera algo con «leche». Si pasara entonces, avisaría: hoy hay «Vienen los abuelos» en la Agenda.',
			'En pausa: no haría nada.'
		]);
	});
});
