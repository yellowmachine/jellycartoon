import { expect, test } from 'bun:test';
import { consumptionByMonth } from './bill-months.ts';

test("a month's bill, in its month; months without one, unknown", () => {
	expect(
		consumptionByMonth(
			[{ periodStart: '2026-09-01', periodEnd: '2026-09-30', consumption: 280 }],
			['2026-08', '2026-09', '2026-10']
		)
	).toEqual([null, 280, null]);
});

test('a period across months, shared out by its days', () => {
	// 61 days, 2 m³ a day: 30 in November (from the 1st), 31 in December.
	expect(
		consumptionByMonth(
			[{ periodStart: '2025-11-01', periodEnd: '2025-12-31', consumption: 122 }],
			['2025-11', '2025-12']
		)
	).toEqual([60, 62]);
	// From the 15th to the 14th: half in each, about.
	expect(
		consumptionByMonth(
			[
				{ periodStart: '2026-08-15', periodEnd: '2026-09-14', consumption: 310 },
				{ periodStart: '2026-09-15', periodEnd: '2026-10-14', consumption: 300 }
			],
			['2026-09']
		)
	).toEqual([140 + 160]);
});

test('without consumption, not counted', () => {
	expect(
		consumptionByMonth(
			[{ periodStart: '2026-09-01', periodEnd: '2026-09-30', consumption: null }],
			['2026-09']
		)
	).toEqual([null]);
});
