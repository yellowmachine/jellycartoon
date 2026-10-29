import { expect, test } from 'bun:test';
import { answerOf } from './settings-ask.ts';
import { SETTINGS_INDEX } from '#lib/settings-index.ts';

const call = (args: unknown) => ({
	content: null,
	toolCalls: [
		{
			id: '1',
			type: 'function' as const,
			function: { name: 'open_settings', arguments: JSON.stringify(args) }
		}
	]
});

test("only the index's sections, once, at most three", () => {
	expect(
		answerOf(
			call({ ids: ['avisos', 'inventada', 'avisos', 'colores'], why: 'Actívalos aquí.' }),
			SETTINGS_INDEX
		)
	).toEqual({ ids: ['avisos', 'colores'], why: 'Actívalos aquí.' });
	expect(
		answerOf(call({ ids: ['avisos', 'colores', 'ia', 'invitaciones'], why: '' }), SETTINGS_INDEX)
			.ids
	).toHaveLength(3);
});

test('none, with why; text instead of the tool, as its why', () => {
	expect(answerOf(call({ ids: [], why: 'Eso lo hace quien administra.' }), SETTINGS_INDEX)).toEqual(
		{
			ids: [],
			why: 'Eso lo hace quien administra.'
		}
	);
	expect(answerOf({ content: 'Está en Agenda.', toolCalls: [] }, SETTINGS_INDEX)).toEqual({
		ids: [],
		why: 'Está en Agenda.'
	});
	expect(answerOf(call({ ids: [] }), SETTINGS_INDEX).why).toBe('No sé dónde está eso.');
});
