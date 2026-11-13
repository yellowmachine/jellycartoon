import type { ExpenseInput } from 'comun/expenses.ts';

/**
 * What a purchase has, for the rules that wait for one (#451): each line with its tag, which the
 * rule's words find too («bebida» in «COCA COLA Z 2L (Bebidas)»); none (by voice, «cerveza, 8 €»),
 * what it was. Not its discounts.
 */
export function boughtOf(expenseId: number, input: ExpenseInput) {
	const items = input.lines
		.filter((l) => l.amount >= 0 && l.text.trim())
		.map((l) => `${l.text.trim()} (${l.tag})`);
	return { expenseId, items: items.length ? [...new Set(items)] : [input.store.trim()] };
}
