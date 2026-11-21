import type { ExpenseInput, ForeignAmount } from 'comun/expenses.ts';

/**
 * A receipt paid in another currency, into euros: with the European Central Bank's rate of its day,
 * by Frankfurter (https://frankfurter.dev, free, without a key; on a weekend or holiday, the last
 * working day's). About 30 currencies; another, or no answer, and it is left as read.
 */

const API = 'https://api.frankfurter.dev/v1';

/** The euros one of `currency` was worth on `day`; null, not known. */
export async function eurosPerUnit(
	currency: string,
	day: string,
	get: typeof fetch = fetch
): Promise<number | null> {
	try {
		const res = await get(`${API}/${day}?base=${currency}&symbols=EUR`, {
			signal: AbortSignal.timeout(8000)
		});
		if (!res.ok) return null;
		const rate = ((await res.json()) as { rates?: { EUR?: unknown } })?.rates?.EUR;
		return typeof rate === 'number' && rate > 0 && Number.isFinite(rate) ? rate : null;
	} catch (err) {
		console.warn(`[gastos] Sin el cambio de ${currency} del ${day}`, err);
		return null;
	}
}

/**
 * What was read, in euros, with what the receipt said beside it; with no rate, as read and said so
 * (`rate` null). A receipt in euros, as it is.
 */
export function inEuros(
	input: ExpenseInput,
	currency: string,
	rate: number | null
): ExpenseInput & { foreign: ForeignAmount | null } {
	if (currency === 'EUR') return { ...input, foreign: null };
	const foreign = { currency, total: input.total, rate };
	if (rate === null) return { ...input, foreign };
	const euro = (cents: number) => Math.round(cents * rate);
	return {
		...input,
		total: euro(input.total),
		lines: input.lines.map((l) => ({ ...l, amount: euro(l.amount) })),
		foreign
	};
}
