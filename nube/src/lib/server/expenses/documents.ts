import { monthOf } from 'comun/expenses.ts';
import type { MoneyDocument } from 'comun/papers.ts';
import { searchExpenses } from '#lib/server/expenses/expenses.ts';
import { searchIncomeDocuments } from '#lib/server/expenses/income.ts';
import { plainText } from '#lib/server/expenses/plain.ts';
import type { Kitchen } from '#lib/server/fridge.ts';

/** At most, of each. */
export const DOCUMENTS_LIMIT = 30;

/**
 * What Papeles also finds in Dinero: the expenses and income with a receipt or invoice kept, by
 * their shop, lines or concept; the newest first. Only to go to them, where they are. They are not
 * Papeles': kept as they came, and read by the AI.
 */
export async function moneyDocuments(k: Kitchen, text: string): Promise<MoneyDocument[]> {
	const [expenses, incomes] = await Promise.all([
		searchExpenses(k, { text, from: null, to: null }, { withFile: true, limit: DOCUMENTS_LIMIT }),
		searchIncomeDocuments(k, text, DOCUMENTS_LIMIT)
	]);
	const words = plainText(text);
	const found: MoneyDocument[] = [
		...expenses.map((e): MoneyDocument => ({
			kind: e.bill ? 'factura' : 'gasto',
			id: e.id,
			title: e.store,
			day: e.date,
			amount: e.total,
			// Found by a line, not by its shop: which, or it would not be clear why.
			line: plainText(e.store).includes(words)
				? null
				: (e.lines.find((l) => plainText(l.text).includes(words))?.text ?? null),
			file: `/gastos/ticket/${e.id}`,
			place: `/gastos?mes=${monthOf(e.date)}&gasto=${e.id}`
		})),
		...incomes.map((i): MoneyDocument => ({
			kind: 'ingreso',
			id: i.id,
			title: i.concept,
			day: i.date,
			amount: i.amount,
			line: null,
			file: `/gastos/ingresos/${i.id}/factura`,
			place: `/gastos/ingresos?mes=${monthOf(i.date)}`
		}))
	];
	return found.sort((a, b) => b.day.localeCompare(a.day));
}
