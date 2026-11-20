import { beforeEach, expect, mock, test } from 'bun:test';
import { addDays, localDay, localTime } from 'comun/agenda.ts';
import type { RuleSpec } from '#lib/rules.ts';
import type { PlanCard } from '#lib/encargos.ts';
import type { Kitchen } from './fridge.ts';

/**
 * Errands in Preguntar (#557): the card, each errand understood by the rules' AI (faked here) and
 * a plain notice checked; «Guardar», only the ticked ones not kept yet, a notice as an alarm on the
 * person's phone and an errand as a rule only theirs; a moment gone by, not kept.
 */

const TOMORROW = addDays(localDay(), 1);
const understood: { text: string; who: string | null }[] = [];
const rules: { userId: string | null; said: string; spec: RuleSpec }[] = [];
const alarms: unknown[] = [];

const specAt = (day: string, time: string): RuleSpec => ({
	when: { kind: 'en_fecha', words: [], minutesBefore: 0, time, day },
	conditions: [],
	then: 'enchufe',
	plug: { plugId: 'p1', name: 'Termo', on: true, minutes: 60 },
	notice: { to: 'yo', userIds: [], names: [], text: '', level: 'normal' },
	once: true
});

const errandsComing = [
	{ id: 9, understood: 'Encenderé «Termo» 1 hora.', spec: specAt(TOMORROW, '09:00') }
];
const moved: unknown[] = [];
const deleted: number[] = [];
mock.module('#lib/server/rules.ts', () => ({
	listErrands: async () => ({ coming: errandsComing, past: [] }),
	describeErrands: async () => 'Encargos pendientes: …',
	moveErrand: async (_k: Kitchen, userId: string, id: number, day: string, time: string) => {
		moved.push({ userId, id, day, time });
		return null;
	},
	deleteRule: async (_k: Kitchen, _u: string, id: number) => {
		deleted.push(id);
		return id === 9 ? 'algo' : null;
	},
	translateRule: async (_k: Kitchen, text: string, who: string | null) => {
		understood.push({ text, who });
		if (text.includes('estufa')) return { problem: 'No hay un enchufe «estufa».' };
		return { understood: `Entendido: ${text}`, spec: specAt(TOMORROW, '09:00') };
	},
	saveRule: async (
		_k: Kitchen,
		userId: string | null,
		said: string,
		_u: string,
		spec: RuleSpec
	) => {
		rules.push({ userId, said, spec });
		return rules.length;
	}
}));
mock.module('#lib/server/alarms/alarms.ts', () => ({
	addAlarm: async (_k: Kitchen, input: unknown) => {
		alarms.push(input);
		return 40 + alarms.length;
	}
}));
mock.module('#lib/server/agenda/agenda.ts', () => ({
	personOf: async (_k: Kitchen, userId: string) => (userId === 'ana' ? '7' : null)
}));

const { applyErrandChange, proposeErrandChange, proposePlan, savePlan } =
	await import('./encargos.ts');
const ana = { familyId: 'A', userId: 'ana', run: async () => [] } as unknown as Kitchen;

beforeEach(() => {
	understood.length = 0;
	rules.length = 0;
	alarms.length = 0;
});

test('the card: notices checked, errands understood as who asks; what cannot be, told to the AI', async () => {
	const { result, card } = await proposePlan(ana, 'Ana', {
		avisos: [
			{ day: TOMORROW, time: '15:00', label: ' Poner la lavadora ' },
			{ day: localDay(), time: '00:00', label: 'Ya pasó' },
			{ day: TOMORROW, time: '25:00', label: 'Mala hora' },
			{ day: TOMORROW, time: '10:00', label: '' }
		],
		encargos: ['Mañana a las 9 enciende el termo una hora', 'Mañana enciende la estufa', '  ']
	});
	expect(understood).toEqual([
		{ text: 'Mañana a las 9 enciende el termo una hora', who: 'Ana' },
		{ text: 'Mañana enciende la estufa', who: 'Ana' }
	]);
	expect(card).toEqual({
		kind: 'encargos',
		items: [
			{ kind: 'aviso', day: TOMORROW, time: '15:00', label: 'Poner la lavadora', savedId: null },
			{
				kind: 'encargo',
				said: 'Mañana a las 9 enciende el termo una hora',
				understood: 'Entendido: Mañana a las 9 enciende el termo una hora',
				spec: specAt(TOMORROW, '09:00'),
				savedId: null
			}
		]
	});
	expect(result).toContain('Tarjeta enseñada con 2');
	expect(result).toContain('«Ya pasó»: esa hora ya ha pasado');
	expect(result).toContain('«Mala hora»: falta el día');
	expect(result).toContain('un aviso sin qué avisar');
	expect(result).toContain('«Mañana enciende la estufa»: No hay un enchufe «estufa».');
	expect(result).toContain('no digas que está guardado');

	const none = await proposePlan(ana, 'Ana', { encargos: ['enciende la estufa'] });
	expect(none.card).toBeUndefined();
	expect(none.result).toContain('No se enseña la tarjeta');
});

test('«Guardar»: only the ticked ones, once; a notice on their phone, an errand only theirs', async () => {
	const { card } = await proposePlan(ana, 'Ana', {
		avisos: [{ day: TOMORROW, time: '15:00', label: 'Poner la lavadora' }],
		encargos: ['Mañana a las 9 enciende el termo una hora']
	});
	const first = await savePlan(ana, 'ana', card!, [1, 1, 9]);
	expect(first.problems).toEqual([]);
	expect(first.card.items.map((it) => it.savedId)).toEqual([null, 1]);
	expect(rules).toEqual([
		{
			userId: 'ana',
			said: 'Mañana a las 9 enciende el termo una hora',
			spec: specAt(TOMORROW, '09:00')
		}
	]);
	const second = await savePlan(ana, 'ana', first.card, [0, 1]);
	expect(second.card.items.map((it) => it.savedId)).toEqual([41, 1]);
	expect(rules).toHaveLength(1);
	expect(alarms).toEqual([
		{
			kind: 'alarma',
			time: '15:00',
			day: TOMORROW,
			days: [],
			label: 'Poner la lavadora',
			people: ['7'],
			place: 'movil'
		}
	]);
});

test('a moment gone by between the card and «Guardar»: not kept, said', async () => {
	const today = localDay();
	const gone: PlanCard = {
		kind: 'encargos',
		items: [
			{ kind: 'aviso', day: today, time: '00:00', label: 'Tarde', savedId: null },
			{
				kind: 'encargo',
				said: 'x',
				understood: 'Lo de esta mañana',
				spec: specAt(today, '00:00'),
				savedId: null
			}
		]
	};
	// Only when it is not just past midnight: then «00:00» is still now.
	if (localTime() === '00:00') return;
	const saved = await savePlan(ana, 'ana', gone, [0, 1]);
	expect(saved.problems).toEqual([
		'«Tarde»: esa hora ya ha pasado',
		'«Lo de esta mañana»: esa hora ya ha pasado'
	]);
	expect(saved.card).toEqual(gone);
	expect(rules).toEqual([]);
	expect(alarms).toEqual([]);
});

test('a change (#557, phase 3): only to an errand to come, checked; done as theirs, once', async () => {
	moved.length = 0;
	deleted.length = 0;
	const move = await proposeErrandChange(ana, 'ana', {
		id: 9,
		cancel: false,
		day: TOMORROW,
		time: '08:00'
	});
	expect(move.card).toEqual({
		kind: 'cambio-encargo',
		ruleId: 9,
		said: expect.stringMatching(/^El .+ a las 09:00: encenderé «Termo» 1 hora\.$/),
		cancel: false,
		day: TOMORROW,
		time: '08:00',
		done: false
	});
	expect((await proposeErrandChange(ana, 'ana', { id: 3, cancel: true })).card).toBeUndefined();
	expect(
		(await proposeErrandChange(ana, 'ana', { id: 9, cancel: false, day: TOMORROW })).result
	).toContain('Falta');
	expect(
		(
			await proposeErrandChange(ana, 'ana', {
				id: 9,
				cancel: false,
				day: localDay(),
				time: '00:00'
			})
		).result
	).toBe(localTime() === '00:00' ? expect.any(String) : 'Esa hora ya ha pasado.');
	const cancel = await proposeErrandChange(ana, 'ana', { id: 9, cancel: true, day: TOMORROW });
	expect(cancel.card).toMatchObject({ cancel: true, day: null, time: null });

	expect(await applyErrandChange(ana, 'ana', move.card!)).toBeNull();
	expect(moved).toEqual([{ userId: 'ana', id: 9, day: TOMORROW, time: '08:00' }]);
	expect(await applyErrandChange(ana, 'ana', { ...move.card!, done: true })).toBeNull();
	expect(moved).toHaveLength(1);
	expect(await applyErrandChange(ana, 'ana', cancel.card!)).toBeNull();
	expect(await applyErrandChange(ana, 'ana', { ...cancel.card!, ruleId: 4 })).toBe(
		'Ese encargo ya no está.'
	);
	expect(deleted).toEqual([9, 4]);
});
