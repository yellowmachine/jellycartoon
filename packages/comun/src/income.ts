import { isDay, MAX_CENTS } from './expenses.ts';

/**
 * The family's income (#384), in Dinero beside its expenses: what came in, from where, with its
 * invoice if there is one (a harvest sold, a refund, a payslip). In cents, always positive.
 */

export const INCOME_CATEGORIES = [
	'Trabajo',
	'Campo y cosechas',
	'Ventas',
	'Alquileres',
	'Devoluciones',
	'Ayudas y pensiones',
	'Regalos',
	'Otros'
] as const;

export type IncomeCategory = (typeof INCOME_CATEGORIES)[number];

export const isIncomeCategory = (value: unknown): value is IncomeCategory =>
	INCOME_CATEGORIES.includes(value as IncomeCategory);

export interface IncomeInput {
	/** `YYYY-MM-DD`: when it came in. */
	date: string;
	/** What it was: «Cosecha de almendra». */
	concept: string;
	category: IncomeCategory;
	/** In cents, over zero. */
	amount: number;
}

export interface Income extends IncomeInput {
	id: number;
	/** Its invoice, kept in the family's storage: whether it has one, and which kind. */
	document: 'pdf' | 'image' | null;
	/** Who wrote it down; null if their account is gone. */
	by: string | null;
}

export const MAX_CONCEPT = 120;

/** What a page sends to be saved, only if well formed. */
export function parseIncomeInput(body: unknown): IncomeInput | null {
	if (!body || typeof body !== 'object') return null;
	const { date, concept, category, amount } = body as Record<string, unknown>;
	if (!isDay(date) || typeof concept !== 'string' || !concept.trim()) return null;
	if (!isIncomeCategory(category)) return null;
	if (!Number.isInteger(amount) || (amount as number) <= 0 || (amount as number) > MAX_CENTS)
		return null;
	return {
		date,
		concept: concept.trim().slice(0, MAX_CONCEPT),
		category,
		amount: amount as number
	};
}
