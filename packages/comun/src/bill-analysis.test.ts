import { describe, expect, test } from 'bun:test';
import { analyseBills, billWarnings, changeOf, perDay, yearBefore } from './bill-analysis.ts';

const bill = (
	id: number,
	periodStart: string,
	periodEnd: string,
	total: number,
	consumption: number | null = null,
	partsSum: number | null = null
) => ({ id, periodStart, periodEnd, total, consumption, partsSum });

describe('perDay', () => {
	test('what it costs and consumes a day, and its real price per unit', () => {
		// 30 days, 60,00 €, 150 kWh.
		expect(perDay(bill(1, '2026-09-15', '2026-10-14', 6000, 150))).toEqual({
			days: 30,
			centsPerDay: 200,
			unitsPerDay: 5,
			centsPerUnit: 40
		});
	});

	test('without consumption, only what it costs', () => {
		const p = perDay(bill(1, '2026-09-01', '2026-09-30', 3000));
		expect(p.unitsPerDay).toBeNull();
		expect(p.centsPerUnit).toBeNull();
	});
});

describe('yearBefore', () => {
	const now = bill(1, '2026-09-15', '2026-10-14', 6000, 150);

	test('the one covering most of the same days a year before', () => {
		const a = bill(2, '2025-08-15', '2025-09-14', 5000, 140);
		const b = bill(3, '2025-09-15', '2025-10-14', 5000, 140);
		expect(yearBefore(now, [now, a, b])?.id).toBe(3);
	});

	test('shifted a few days, still that one', () => {
		const b = bill(3, '2025-09-20', '2025-10-19', 5000, 140);
		expect(yearBefore(now, [now, b])?.id).toBe(3);
	});

	test('less than half of the same days: none', () => {
		const b = bill(3, '2025-10-05', '2025-11-04', 5000, 140);
		expect(yearBefore(now, [now, b])).toBeNull();
	});
});

test('changeOf: how much more, and nothing to compare with', () => {
	expect(changeOf(120, 100)).toBeCloseTo(0.2);
	expect(changeOf(80, 100)).toBeCloseTo(-0.2);
	expect(changeOf(null, 100)).toBeNull();
	expect(changeOf(100, 0)).toBeNull();
});

test('analyseBills: by the day, not by the bill, though their days differ', () => {
	// The same 2 € a day, in a 31-day bill and a 29-day one a year before.
	const [now] = analyseBills([
		bill(1, '2026-09-01', '2026-10-01', 6200, 155),
		bill(2, '2025-09-01', '2025-09-29', 5800, 116)
	]);
	expect(now!.change!.perDay).toBeCloseTo(0);
	expect(now!.change!.unitsPerDay).toBeCloseTo(0.25);
});

describe('billWarnings', () => {
	test('parts that do not add up to the total (as the 2026 Pepeenergy one, by 85 cents)', () => {
		expect(billWarnings([bill(1, '2026-09-01', '2026-09-30', 4500, 100, 4415)])).toEqual([
			{ kind: 'no-cuadra', id: 1, total: 4500, partsSum: 4415 }
		]);
	});

	test('a cent of rounding, or no parts: nothing', () => {
		expect(billWarnings([bill(1, '2026-09-01', '2026-09-30', 4500, 100, 4501)])).toEqual([]);
		expect(billWarnings([bill(1, '2026-09-01', '2026-09-30', 4500, 100)])).toEqual([]);
	});

	test('the latest, much dearer a day than a year before', () => {
		const warnings = billWarnings([
			bill(1, '2026-09-01', '2026-09-30', 6000, 150),
			bill(2, '2025-09-01', '2025-09-30', 5000, 150)
		]);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toMatchObject({ kind: 'sube', id: 1 });
		expect((warnings[0] as { change: number }).change).toBeCloseTo(0.2);
	});

	test('a little dearer, or an older bill dearer: nothing', () => {
		expect(
			billWarnings([
				bill(1, '2026-09-01', '2026-09-30', 5500, 150),
				bill(2, '2025-09-01', '2025-09-30', 5000, 150)
			])
		).toEqual([]);
	});
});
