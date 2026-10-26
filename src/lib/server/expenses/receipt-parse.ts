import {
	EXPENSE_CATEGORIES,
	LINE_TAGS,
	isCategory,
	isDay,
	isTag,
	linesSum,
	MAX_LINES,
	type ExpenseInput
} from '#lib/expenses.ts';

/**
 * What the vision model is asked for, a receipt as read (#194): the same for Ollama's structured
 * outputs (https://docs.ollama.com/capabilities/structured-outputs) and OpenRouter's, which wants
 * every property required and no others.
 */
export const RECEIPT_SCHEMA = {
	type: 'object',
	properties: {
		store: { type: 'string' },
		date: { type: 'string' },
		total: { type: 'number' },
		category: { type: 'string', enum: [...EXPENSE_CATEGORIES] },
		lines: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					text: { type: 'string' },
					quantity: { type: 'number' },
					amount: { type: 'number' },
					tag: { type: 'string', enum: [...LINE_TAGS] }
				},
				required: ['text', 'quantity', 'amount', 'tag'],
				additionalProperties: false
			}
		}
	},
	required: ['store', 'date', 'total', 'category', 'lines'],
	additionalProperties: false
};

const RECEIPT_PROMPT =
	'Es la foto de un ticket de compra, casi siempre español. Extrae: la tienda (su nombre ' +
	'comercial, sin «S.A.» ni la dirección), la fecha (YYYY-MM-DD), el total pagado en euros, la ' +
	`categoría que mejor le va de estas: ${EXPENSE_CATEGORIES.join(', ')} (Restaurantes es también ` +
	'bares y cafeterías); y cada línea de producto con su texto tal cual, la cantidad (unidades o ' +
	'kg), el importe de la línea en euros y qué es, de estas: ' +
	`${LINE_TAGS.join(', ')}. Comida preparada son platos hechos, pizzas, y en un bar o restaurante ` +
	'los platos, menús, raciones y bocadillos. Alcohol es cerveza, vino y licores con alcohol; la ' +
	'cerveza sin alcohol o 0,0 y el café son Bebidas. Caprichos son dulces, snacks, helados y ' +
	'chucherías. Los descuentos, como líneas con importe negativo y Otros. No pongas como líneas el total, el subtotal, el ' +
	'IVA, la forma de pago ni el cambio. Los números del ticket usan coma decimal: 6,12 es 6.12. Sin ' +
	'líneas que leer (una gasolinera, un restaurante), una sola con lo que fue y el total.';

/**
 * The prompt, with the shops already written down (as corrected): a name misread («Don Mario» for
 * «Don Market») comes out as the house wrote it, and the same shop is not written two ways.
 */
export function receiptPrompt(knownStores: string[]) {
	if (!knownStores.length) return RECEIPT_PROMPT;
	return (
		`${RECEIPT_PROMPT} Tiendas donde ya se ha comprado: ${knownStores.join(', ')}. Si el ticket ` +
		'es de una de ellas, escribe su nombre exactamente así; si es de otra, el que ponga el ticket.'
	);
}

/** Euros as the model says them, to cents; nonsense, null. */
const toCents = (value: unknown) =>
	typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 1_000_000
		? Math.round(value * 100)
		: null;

/**
 * The model's answer, to what the page shows to check: what it could not read is left empty or
 * guessed (today, «Otros», the lines' sum), for a person to correct.
 */
export function draftFromAnswer(answer: unknown, today: string): ExpenseInput {
	const a = (answer && typeof answer === 'object' ? answer : {}) as Record<string, unknown>;
	const lines = (Array.isArray(a.lines) ? a.lines : [])
		.slice(0, MAX_LINES)
		.flatMap((line: unknown) => {
			const l = (line && typeof line === 'object' ? line : {}) as Record<string, unknown>;
			const text = typeof l.text === 'string' ? l.text.trim().slice(0, 200) : '';
			const amount = toCents(l.amount);
			if (!text || amount === null) return [];
			const quantity =
				typeof l.quantity === 'number' && Number.isFinite(l.quantity) && l.quantity > 0
					? l.quantity
					: null;
			return [{ text, quantity, amount, tag: isTag(l.tag) ? l.tag : ('Otros' as const) }];
		});
	const store = typeof a.store === 'string' ? a.store.trim().slice(0, 120) : '';
	return {
		date: isDay(a.date) && a.date <= today ? a.date : today,
		store,
		category: isCategory(a.category) ? a.category : 'Otros',
		total: toCents(a.total) || linesSum(lines),
		lines
	};
}
