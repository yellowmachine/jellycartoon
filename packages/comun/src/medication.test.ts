import { expect, test } from 'bun:test';
import { daysText, dosesOn, parseMedicationInput, takenOn } from './medication.ts';

const pill = {
	id: 1,
	personId: '3',
	name: 'Sintrom',
	dose: '½ pastilla',
	times: ['20:00'],
	days: [],
	startDay: '2026-10-01',
	endDay: null
};

test('taken from its first day to its last, on its weekdays', () => {
	expect(takenOn(pill, '2026-09-30')).toBe(false);
	expect(takenOn(pill, '2026-10-30')).toBe(true);
	const antibiotic = { ...pill, startDay: '2026-10-28', endDay: '2026-11-03' };
	expect(takenOn(antibiotic, '2026-11-03')).toBe(true);
	expect(takenOn(antibiotic, '2026-11-04')).toBe(false);
	// Mondays and Thursdays: Friday 30 no, Thursday 29 yes.
	const twice = { ...pill, days: [0, 3] };
	expect(takenOn(twice, '2026-10-30')).toBe(false);
	expect(takenOn(twice, '2026-10-29')).toBe(true);
});

test("the day's doses, by time", () => {
	const morning = { ...pill, id: 2, name: 'Omeprazol', times: ['08:00', '22:00'] };
	const doses = dosesOn([pill, morning], '2026-10-30');
	expect(doses.map((d) => `${d.time} ${d.medication.name}`)).toEqual([
		'08:00 Omeprazol',
		'20:00 Sintrom',
		'22:00 Omeprazol'
	]);
});

test('as the page sends it', () => {
	expect(
		parseMedicationInput({
			personId: '3',
			name: '  Dalsy ',
			dose: '',
			times: ['22:00', '08:00', '08:00', '25:00'],
			days: [0, 1, 2, 3, 4, 5, 6],
			startDay: '2026-10-30',
			endDay: '2026-10-01'
		})
	).toEqual({
		personId: '3',
		name: 'Dalsy',
		dose: null,
		times: ['08:00', '22:00'],
		days: [],
		startDay: '2026-10-30',
		endDay: null
	});
	expect(parseMedicationInput({ ...pill, personId: '3', times: [] })).toBeNull();
	expect(parseMedicationInput({ ...pill, personId: '3', name: ' ' })).toBeNull();
});

test('its days, as said', () => {
	expect(daysText([])).toBe('Todos los días');
	expect(daysText([4, 0, 2])).toBe('L, X, V');
});
