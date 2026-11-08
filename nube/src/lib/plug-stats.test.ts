import { describe, expect, test } from 'bun:test';
import { periodBounds } from './plug-stats.ts';

describe('consumo: periodos', () => {
	test('a week from Monday; the one before; its columns', () => {
		const w = periodBounds('semana', '2026-11-08'); // a Sunday
		expect([w.start, w.end, w.prevStart]).toEqual(['2026-11-02', '2026-11-09', '2026-10-26']);
		expect(w.title).toBe('Semana del 2 al 8 de noviembre');
		expect(w.buckets.map((b) => b.tick)).toEqual(['L 2', 'M 3', 'X 4', 'J 5', 'V 6', 'S 7', 'D 8']);
		expect(periodBounds('semana', '2026-11-01').title).toBe(
			'Semana del 26 de octubre al 1 de noviembre'
		);
	});

	test('a month, a year, a day', () => {
		const m = periodBounds('mes', '2026-02-14');
		expect([m.start, m.end, m.prevStart, m.title]).toEqual([
			'2026-02-01',
			'2026-03-01',
			'2026-01-01',
			'Febrero de 2026'
		]);
		expect(m.buckets).toHaveLength(28);
		const y = periodBounds('año', '2026-11-08');
		expect([y.start, y.end, y.prevStart, y.buckets.length]).toEqual([
			'2026-01-01',
			'2027-01-01',
			'2025-01-01',
			12
		]);
		expect(y.keyOf('2026-03-30', 5)).toBe('2026-03');
		const d = periodBounds('dia', '2026-11-08');
		expect([d.start, d.end, d.prevStart, d.title]).toEqual([
			'2026-11-08',
			'2026-11-09',
			'2026-11-07',
			'Domingo, 8 de noviembre de 2026'
		]);
		expect(d.buckets).toHaveLength(24);
	});
});
