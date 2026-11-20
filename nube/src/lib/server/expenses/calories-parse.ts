import type { FoodEstimate } from '#lib/calories.ts';

/**
 * Calorías (#562): what the AI is asked of a batch of products, by their receipts' texts, and its
 * answer as kept. Every property required and no others, as OpenRouter's strict schemas want.
 */

/** A product to estimate: its text as written most, and a few of its lines, to tell what it is. */
export interface ProductAsked {
	key: string;
	text: string;
	/** Quantity (units or kg; null, not said) and amount in cents. */
	examples: { quantity: number | null; amount: number }[];
}

export const CALORIES_SCHEMA = {
	type: 'object',
	properties: {
		products: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					n: { type: 'integer' },
					food: { type: 'boolean' },
					byWeight: { type: 'boolean' },
					grams: { type: 'number' },
					kcal100: { type: 'number' }
				},
				required: ['n', 'food', 'byWeight', 'grams', 'kcal100'],
				additionalProperties: false
			}
		}
	},
	required: ['products'],
	additionalProperties: false
};

const euros = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');
const amount = (q: number | null) => (q === null ? 'sin cantidad' : String(q).replace('.', ','));

export function caloriesPrompt(products: ProductAsked[]) {
	const list = products
		.map(
			(p, n) =>
				`${n + 1}. ${p.text} — ${p.examples.map((e) => `${amount(e.quantity)} por ${euros(e.amount)} €`).join('; ')}`
		)
		.join('\n');
	return (
		'Son productos de tickets de compra españoles, con su texto tal cual (abreviado) y algunas ' +
		'de sus líneas: cantidad (unidades, o kg si se vende al peso) y lo que costó. Para cada uno, ' +
		'por su número n: food, si es algo que se come o se bebe (una bolsa, un mechero o una ' +
		'tarjeta regalo no); byWeight, si se vende al peso y su cantidad son kg (fruta, verdura, ' +
		'carne o pescado al corte; las cantidades con decimales lo delatan); grams, los gramos de ' +
		'una unidad tal como se compra, o de una compra normal si se vende al peso (un pack de 6 ' +
		'bricks de 1 L son unos 6000; un litro de bebida, unos 1000; usa el precio para ' +
		'distinguir un paquete pequeño de uno grande); y kcal100, sus kcal por 100 g, como las de ' +
		'su etiqueta en un supermercado español (agua y refrescos zero, 0). Si no es comida, ' +
		'grams y kcal100 a 0. Si dudas, lo más probable; nunca te saltes ninguno.\n\n' +
		list
	);
}

/** Within what a product can be: a misread answer is not kept as it came. */
const MAX_GRAMS = 50_000;
const MAX_KCAL100 = 900;

/** The answer, each by its product's key; those it did not give, or gave wrong, missing. */
export function estimatesFromAnswer(
	products: ProductAsked[],
	answer: unknown
): Map<string, FoodEstimate> {
	const out = new Map<string, FoodEstimate>();
	const items = (answer as { products?: unknown })?.products;
	if (!Array.isArray(items)) return out;
	for (const item of items) {
		const { n, food, byWeight, grams, kcal100 } = (item ?? {}) as Record<string, unknown>;
		const product = typeof n === 'number' ? products[n - 1] : undefined;
		if (!product || typeof food !== 'boolean') continue;
		const g = typeof grams === 'number' && Number.isFinite(grams) ? grams : 0;
		const k = typeof kcal100 === 'number' && Number.isFinite(kcal100) ? kcal100 : 0;
		out.set(product.key, {
			food,
			byWeight: food && byWeight === true,
			grams: food ? Math.min(Math.max(g, 0), MAX_GRAMS) : 0,
			kcal100: food ? Math.min(Math.max(k, 0), MAX_KCAL100) : 0
		});
	}
	return out;
}
