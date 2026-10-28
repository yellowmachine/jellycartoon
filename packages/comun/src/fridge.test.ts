import { expect, test } from 'bun:test';
import { PAPERS, paperFor, tiltFor, untilChoices, untilDay, untilText } from './fridge.ts';

// A Wednesday.
const now = new Date(2026, 9, 21, 18, 0);

test('the days to leave it up until: today, tomorrow, the next Friday and Sunday, a week', () => {
	expect(untilChoices(now)).toEqual([
		{ label: 'Hoy', value: '2026-10-21' },
		{ label: 'Mañana', value: '2026-10-22' },
		{ label: 'El viernes', value: '2026-10-23' },
		{ label: 'El domingo', value: '2026-10-25' },
		{ label: 'Una semana', value: '2026-10-28' }
	]);
});

test('on a Friday, «el viernes» is the next one; a day said twice, once', () => {
	const friday = new Date(2026, 9, 23, 9, 0);
	expect(untilChoices(friday).find((c) => c.label === 'El viernes')?.value).toBe('2026-10-30');
	const saturday = new Date(2026, 9, 24, 9, 0);
	const values = untilChoices(saturday).map((c) => c.value);
	expect(new Set(values).size).toBe(values.length);
	expect(untilChoices(saturday).map((c) => c.label)).not.toContain('El domingo');
});

test('as it is said', () => {
	expect(untilText('2026-10-21', now)).toBe('hasta hoy');
	expect(untilText('2026-10-22', now)).toBe('hasta mañana');
	expect(untilText('2026-10-23', now)).toBe('hasta el vie 23');
});

test('each person, always the same paper; each post-it, the same tilt', () => {
	expect(paperFor('abc')).toBe(paperFor('abc'));
	expect(paperFor('abc')).toBeLessThan(PAPERS.length);
	expect(tiltFor(7)).toBe(tiltFor(7));
	for (let id = 1; id < 50; id++) expect(Math.abs(tiltFor(id))).toBeLessThanOrEqual(3);
});

test("said by voice, the day even if it is another button's: on Saturday, «domingo» is tomorrow", () => {
	const saturday = new Date(2026, 9, 24, 9, 0);
	expect(untilDay('domingo', saturday)).toBe('2026-10-25');
	expect(untilDay('mañana', saturday)).toBe('2026-10-25');
	expect(untilDay('viernes', saturday)).toBe('2026-10-30');
});
