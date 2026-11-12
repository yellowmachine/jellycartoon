import { eq } from 'drizzle-orm';
import type { RecipeShoppingItem } from '#lib/recipe-shopping.ts';
import { recipe } from '#lib/server/db/schema.ts';
import { openRouterKey } from '#lib/server/family-settings.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { completeJson } from '#lib/server/openrouter.ts';
import { plainShopping, shoppingFromAi } from './shopping-items.ts';

/**
 * «Añadir a la compra» in a recipe: its ingredients as the site wrote them («200 g de harina de
 * trigo») made into things to buy by the AI, once, and kept with the recipe: the next time, at
 * once and for nothing. Without the AI (no key, or it fails), the ingredients as they are, and not
 * kept, so that it is done properly when it can be.
 */

const RULES = [
	'Conviertes los ingredientes de una receta en una lista de la compra, en español.',
	'Una entrada por cosa que comprar: name, el nombre corto y como se pide en la tienda, con mayúscula («Harina de trigo», «Huevos», «Tomate triturado»); amount, la cantidad que dice la receta («200 g», «2», «1 lata»), o null si no la dice («al gusto», «un chorrito» no es una cantidad).',
	'Si un ingrediente sale más de una vez, una sola entrada; suma las cantidades si van en la misma unidad, y si no, ponlas juntas («200 g + 1 taza»).',
	'Usa solo lo que dice la receta: no inventes ingredientes ni quites ninguno, salvo el agua del grifo, que no se compra.',
	'usual: true solo para lo que casi todas las casas tienen siempre (sal, pimienta, aceite de oliva, vinagre, azúcar); para lo demás, false.',
	'En el orden de la receta.'
].join('\n');

async function askAi(apiKey: string, title: string, ingredients: string[]) {
	const answer = await completeJson<unknown>({
		apiKey,
		label: `Compra de «${title}»`,
		system: RULES,
		prompt: `Receta: ${title}\n\nIngredientes:\n${ingredients.map((i) => `- ${i}`).join('\n')}`,
		name: 'shopping',
		schema: {
			type: 'object',
			properties: {
				items: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							name: { type: 'string' },
							amount: { type: ['string', 'null'] },
							usual: { type: 'boolean' }
						},
						required: ['name', 'amount', 'usual'],
						additionalProperties: false
					}
				}
			},
			required: ['items'],
			additionalProperties: false
		},
		maxTokens: 2_000,
		timeoutMs: 45_000
	});
	return shoppingFromAi(answer);
}

/**
 * The recipe's things to buy: the kept ones, or made now (and kept, if by the AI). `byAi`, false
 * when they go as the recipe wrote them; null if there is no such recipe.
 */
export async function recipeShopping(k: Kitchen, id: number) {
	const [row] = await k.run((tx) =>
		tx
			.select({ title: recipe.title, ingredients: recipe.ingredients, shopping: recipe.shopping })
			.from(recipe)
			.where(eq(recipe.id, id))
	);
	if (!row) return null;
	if (row.shopping) return { items: row.shopping, byAi: true };
	const apiKey = row.ingredients.length ? await openRouterKey(k) : null;
	let items: RecipeShoppingItem[] | null = null;
	if (apiKey) {
		try {
			items = await askAi(apiKey, row.title, row.ingredients);
		} catch (err) {
			console.warn('[recetas] La IA no ha hecho la lista de la compra', String(err));
		}
	}
	if (!items) return { items: plainShopping(row.ingredients), byAi: false };
	await k.run((tx) => tx.update(recipe).set({ shopping: items }).where(eq(recipe.id, id)));
	return { items, byAi: true };
}
