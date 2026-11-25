import { expect, test } from 'bun:test';
import { costIn, fuelSums, perDay } from './fuel-cost.ts';

const line = (text: string, amount: number) => ({ text, amount });

test('an expense: its lines that say it; with none, all of it if the shop says it', () => {
	expect(costIn({ store: 'Butano repartidor', total: 1850, lines: [] }, 'butano')).toBe(1850);
	expect(
		costIn(
			{
				store: 'Leroy',
				total: 9000,
				lines: [line('PÉLLET 15KG', 1200), line('Pellet', 600), line('Tornillos', 7200)]
			},
			'pellet'
		)
	).toBe(1800);
	// The shop says it, its lines do not: all of it. Neither: not known.
	expect(costIn({ store: 'Pellets Sur', total: 500, lines: [line('Saco', 500)] }, 'pellet')).toBe(
		500
	);
	expect(costIn({ store: 'Leroy', total: 500, lines: [line('Saco', 500)] }, 'pellet')).toBeNull();
	expect(costIn({ store: 'Gasolinera', total: 1700, lines: [] }, 'butano')).toBe(1700);
});

const unit = (startedOn: string, endedOn: string | null, cost: number | null, whole = true) => ({
	startedOn,
	endedOn,
	cost,
	whole
});

test('a day of one: only ended, all used, with its price and at least a day', () => {
	expect(perDay(unit('2026-10-01', '2026-10-11', 1800))).toBe(180);
	expect(perDay(unit('2026-10-01', null, 1800))).toBeNull();
	expect(perDay(unit('2026-10-01', '2026-10-11', null))).toBeNull();
	expect(perDay(unit('2026-10-01', '2026-10-11', 1800, false))).toBeNull();
	expect(perDay(unit('2026-10-01', '2026-10-01', 1800))).toBeNull();
});

test('a spot: what they lasted, and a day of those with a price', () => {
	expect(fuelSums([unit('2026-10-01', null, 1800)])).toBeNull();
	expect(
		fuelSums([
			unit('2026-10-01', '2026-10-11', 1800),
			unit('2026-10-11', '2026-10-31', 1800),
			unit('2026-10-31', '2026-11-15', null),
			unit('2026-11-15', '2026-11-18', 1800, false)
		])
	).toEqual({ units: 3, days: 15, perDay: 120, priced: 2 });
	expect(fuelSums([unit('2026-10-01', '2026-10-11', null)])!.perDay).toBeNull();
});
