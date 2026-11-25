import { euros, lineKey, ownTagOf, type Expense, type OwnTags } from 'comun/expenses.ts';

/** A month's expenses in Dinero, found by words, by day or by shop. */
export interface ExpenseFilter {
	text: string;
	/** `YYYY-MM-DD`; empty, any. */
	day: string;
	/** A shop as lineKey leaves it; empty, any. */
	store: string;
}
export const noFilter = (): ExpenseFilter => ({ text: '', day: '', store: '' });
export const isFiltered = (f: ExpenseFilter) => Boolean(f.text.trim() || f.day || f.store);

const plain = (text: string) =>
	text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ');

/** Every word of `text` somewhere in it: its shop, its category, who, its amount, its lines and their tags. */
function says(e: Expense, text: string, own: OwnTags) {
	const words = plain(text).split(' ').filter(Boolean);
	if (!words.length) return true;
	const there = plain(
		[
			e.store,
			e.category,
			e.by ?? '',
			euros(e.total),
			// Without the dot of the thousands too.
			(e.total / 100).toFixed(2).replace('.', ','),
			...e.lines.flatMap((l) => [l.text, l.tag, ownTagOf(own, l.text)?.name ?? ''])
		].join('\n')
	);
	return words.every((w) => there.includes(w));
}

export const filterExpenses = (list: Expense[], f: ExpenseFilter, own: OwnTags) =>
	list.filter(
		(e) =>
			(!f.day || e.date === f.day) &&
			(!f.store || lineKey(e.store) === f.store) &&
			says(e, f.text, own)
	);
