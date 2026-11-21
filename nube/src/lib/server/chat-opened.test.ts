import { expect, mock, test } from 'bun:test';
import type { Kitchen } from '#lib/server/fridge.ts';

// The expense itself, read in chat-reads.ts.
mock.module('#lib/server/chat-reads.ts', () => ({
	describeExpense: async (_k: Kitchen, id: number) => (id === 5 ? 'el gasto del 2026-11-20' : null)
}));
const { describeOpened, openedOf } = await import('./chat-opened.ts');

const today = '2026-11-21';

test('what the page beside the panel has open, from its path and query', () => {
	expect(openedOf('/recetas/7', today)).toEqual({ kind: 'receta', id: 7 });
	expect(openedOf('/recetas', today)).toBeNull();
	expect(openedOf('/viajes/hechos?viaje=12', today)).toEqual({ kind: 'trayecto', id: 12 });
	expect(openedOf('/viajes/hechos', today)).toBeNull();
	expect(openedOf('/paseos?paseo=3', today)).toEqual({ kind: 'paseo', id: 3 });
	expect(openedOf('/paseos?paseo=x', today)).toBeNull();
	expect(openedOf('/gastos?mes=2026-10', today)).toEqual({
		kind: 'mes',
		month: '2026-10',
		income: false
	});
	// No month, or one still to come: this one, as the page shows.
	expect(openedOf('/gastos', today)).toMatchObject({ month: '2026-11' });
	expect(openedOf('/gastos?mes=2027-01', today)).toMatchObject({ month: '2026-11' });
	expect(openedOf('/gastos?mes=2026-10&gasto=5', today)).toEqual({ kind: 'gasto', id: 5 });
	expect(openedOf('/gastos/ingresos?mes=2026-09', today)).toMatchObject({ income: true });
	// Agenda: the week of the day (Monday to Sunday), or its month.
	expect(openedOf('/agenda', today)).toEqual({
		kind: 'dias',
		from: '2026-11-16',
		to: '2026-11-22',
		month: false
	});
	expect(openedOf('/agenda?dia=2026-02-10&vista=mes', today)).toEqual({
		kind: 'dias',
		from: '2026-02-01',
		to: '2026-02-28',
		month: true
	});
	expect(openedOf('/notas', today)).toBeNull();
	expect(openedOf(null, today)).toBeNull();
});

test('told to the AI: a recipe of the book by its title; one not in it, nothing', async () => {
	const k = {} as Kitchen;
	const book = [{ id: 7, title: 'Tarta de chocolate sencilla' }];
	expect(await describeOpened(k, 'ana', { kind: 'receta', id: 7 }, book)).toContain(
		'«Tarta de chocolate sencilla» [receta 7]'
	);
	expect(await describeOpened(k, 'ana', { kind: 'receta', id: 8 }, book)).toBeNull();
	expect(await describeOpened(k, 'ana', { kind: 'gasto', id: 5 }, book)).toBe(
		'el gasto del 2026-11-20'
	);
	expect(
		await describeOpened(k, 'ana', { kind: 'mes', month: '2026-10', income: false }, book)
	).toContain('los gastos de octubre de 2026');
	expect(
		await describeOpened(
			k,
			'ana',
			{ kind: 'dias', from: '2026-11-16', to: '2026-11-22', month: false },
			book
		)
	).toContain('semana del 2026-11-16 al 2026-11-22');
});
