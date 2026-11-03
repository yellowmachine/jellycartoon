import { isDay, MAX_CENTS } from 'comun/expenses.ts';
import {
	INCOME_CATEGORIES,
	isIncomeCategory,
	MAX_CONCEPT,
	type IncomeInput
} from 'comun/income.ts';

/**
 * An income's invoice as read (#384): what OpenRouter's structured outputs are asked for (every
 * property required, no others), and what comes back made safe. Nothing is saved from it: the
 * page shows it to be checked.
 */
export const INCOME_SCHEMA = {
	type: 'object',
	properties: {
		concept: { type: 'string' },
		date: { type: 'string' },
		amount: { type: 'number' },
		category: { type: 'string', enum: [...INCOME_CATEGORIES] }
	},
	required: ['concept', 'date', 'amount', 'category'],
	additionalProperties: false
};

export const INCOME_PROMPT =
	'Es la factura o el justificante de algo que ha cobrado una familia española: la venta de una ' +
	'cosecha a una cooperativa, una nómina, una devolución, un alquiler cobrado, una venta… Extrae: ' +
	'qué fue, corto y con mayúscula, como se apuntaría («Cosecha de almendra», «Nómina de octubre», ' +
	'«Devolución de Hacienda»); la fecha de la factura o del cobro (YYYY-MM-DD); el importe que se ' +
	'cobra en euros: el «líquido a percibir» o «total a cobrar» si lo pone (ya sin retenciones), y si ' +
	'no, el total de la factura; y la categoría que mejor le va de estas: ' +
	`${INCOME_CATEGORIES.join(', ')}. Los números usan coma decimal: 1.234,56 es 1234.56. ` +
	'Sin inventar: lo que no ponga, vacío (o 0 el importe).';

/** What came back, made safe: a date not after today, an amount in cents, a known category. */
export function incomeDraftFromAnswer(answer: unknown, today: string): Partial<IncomeInput> {
	const a = (answer && typeof answer === 'object' ? answer : {}) as Record<string, unknown>;
	const amount =
		typeof a.amount === 'number' && Number.isFinite(a.amount) && a.amount > 0
			? Math.round(a.amount * 100)
			: null;
	const concept = typeof a.concept === 'string' ? a.concept.trim().slice(0, MAX_CONCEPT) : '';
	return {
		date: isDay(a.date) && a.date <= today ? a.date : today,
		concept,
		category: isIncomeCategory(a.category) ? a.category : 'Otros',
		...(amount !== null && amount <= MAX_CENTS && { amount })
	};
}
