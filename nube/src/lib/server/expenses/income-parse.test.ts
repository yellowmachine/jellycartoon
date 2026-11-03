import { describe, expect, test } from 'bun:test';
import { INCOME_PROMPT, INCOME_SCHEMA, incomeDraftFromAnswer } from './income-parse.ts';

/** An income's invoice as the AI reads it (#384): what comes back, made safe for the form. */
describe('incomeDraftFromAnswer', () => {
	const today = '2026-11-03';

	test('as read: cents, its category, its day', () => {
		expect(
			incomeDraftFromAnswer(
				{
					concept: ' Cosecha de almendra ',
					date: '2026-08-20',
					amount: 812.4,
					category: 'Campo y cosechas'
				},
				today
			)
		).toEqual({
			concept: 'Cosecha de almendra',
			date: '2026-08-20',
			amount: 81_240,
			category: 'Campo y cosechas'
		});
	});

	test('what it could not read: today, Otros and no amount, to be written', () => {
		expect(
			incomeDraftFromAnswer({ concept: '', date: '2027-01-01', amount: 0, category: 'X' }, today)
		).toEqual({ concept: '', date: today, category: 'Otros' });
		expect(incomeDraftFromAnswer(null, today)).toEqual({
			concept: '',
			date: today,
			category: 'Otros'
		});
	});

	test('asked for every field, and every category named', () => {
		expect(INCOME_SCHEMA.required).toEqual(['concept', 'date', 'amount', 'category']);
		expect(INCOME_PROMPT).toContain('Campo y cosechas');
	});
});
