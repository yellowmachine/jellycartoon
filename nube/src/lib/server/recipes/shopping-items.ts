import { MAX_ITEM } from 'comun/fridge.ts';
import type { RecipeShoppingItem } from '#lib/recipe-shopping.ts';

/** A recipe's things to buy (shopping.ts), without the server: what can be tested alone. */

export const MAX_ITEMS = 60;

/** What the AI answered, checked: names and amounts trimmed, nothing empty, not too many. */
export function shoppingFromAi(answer: unknown): RecipeShoppingItem[] | null {
	const items = (answer as { items?: unknown } | null)?.items;
	if (!Array.isArray(items)) return null;
	const seen = new Set<string>();
	const out: RecipeShoppingItem[] = [];
	for (const raw of items) {
		const { name, amount, usual } = (raw ?? {}) as Record<string, unknown>;
		if (typeof name !== 'string' || !name.trim()) continue;
		const quantity = typeof amount === 'string' && amount.trim() ? ` (${amount.trim()})` : '';
		const item = `${name.trim()}${quantity}`.slice(0, MAX_ITEM);
		if (seen.has(item.toLowerCase())) continue;
		seen.add(item.toLowerCase());
		out.push({ item, usual: usual === true });
		if (out.length === MAX_ITEMS) break;
	}
	return out.length ? out : null;
}

/** Without the AI: the ingredients as the recipe has them. */
export function plainShopping(ingredients: string[]): RecipeShoppingItem[] {
	return ingredients
		.map((i) => i.trim().slice(0, MAX_ITEM))
		.filter(Boolean)
		.slice(0, MAX_ITEMS)
		.map((item) => ({ item, usual: false }));
}
