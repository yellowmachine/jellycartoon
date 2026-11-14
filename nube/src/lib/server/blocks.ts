import { addMonths, isCategory } from 'comun/expenses.ts';
import { REST, SERIES_MAX, type BarsBlock } from '#lib/blocks.ts';
import { expenseSums } from '#lib/server/expenses/analysis.ts';
import type { Kitchen } from '#lib/server/fridge.ts';

/**
 * The blocks' figures (#504 phase 3, #505), from the database when the block is made: kept as they
 * were then. The AI only asks for one; nothing of it comes from the AI but its title.
 */

/** Months in a block, at most: two years of columns. */
export const BLOCK_MONTHS = 24;

const isMonth = (v: unknown): v is string =>
	typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

/**
 * What was spent month by month (the fixed ones too), each category a segment: the biggest of the
 * period with a colour of their own, the rest together. Empty months stay, at nought. A string,
 * what is wrong (for the AI).
 */
export async function spendingBars(
	k: Kitchen,
	from: unknown,
	to: unknown,
	title: unknown
): Promise<BarsBlock | string> {
	if (!isMonth(from) || !isMonth(to)) return 'Faltan los meses, AAAA-MM.';
	const [first, last] = from <= to ? [from, to] : [to, from];
	const labels: string[] = [];
	for (let m = first; m <= last && labels.length <= BLOCK_MONTHS; m = addMonths(m, 1))
		labels.push(m);
	if (labels.length > BLOCK_MONTHS) return `Como mucho ${BLOCK_MONTHS} meses en una gráfica.`;
	const rows = await expenseSums(k, first, last);
	if (!rows.length) return `No hay gastos apuntados entre ${first} y ${last}: no hay gráfica.`;

	const category = (c: string) => (isCategory(c) ? c : 'Otros');
	const totals = new Map<string, number>();
	for (const r of rows)
		totals.set(category(r.category), (totals.get(category(r.category)) ?? 0) + r.total);
	const ranked = [...totals].sort((a, b) => b[1] - a[1]).map(([name]) => name);
	// All of them if they fit; else the biggest, and one «Resto» with the others.
	const own = ranked.length <= SERIES_MAX ? ranked : ranked.slice(0, SERIES_MAX - 1);
	const names = ranked.length <= SERIES_MAX ? own : [...own, REST];
	const series = names.map((name) => ({ name, values: labels.map(() => 0) }));
	for (const r of rows) {
		const name = own.includes(category(r.category)) ? category(r.category) : REST;
		series[names.indexOf(name)]!.values[labels.indexOf(r.month)]! += r.total;
	}
	const said = typeof title === 'string' && title.trim() ? title.trim().slice(0, 80) : null;
	return {
		kind: 'barras',
		title: said ?? (first === last ? `Gastos de ${first}` : `Gastos de ${first} a ${last}`),
		labels,
		series
	};
}

/** A block as the AI is told of it: what it shows, in figures (it may talk about them). */
export function describeBlock(block: BarsBlock, euros: (cents: number) => string) {
	const months = block.labels.map((label, i) => {
		const parts = block.series
			.filter((s) => s.values[i])
			.map((s) => `${s.name} ${euros(s.values[i]!)}`);
		const total = block.series.reduce((sum, s) => sum + s.values[i]!, 0);
		return `${label}: ${euros(total)}${parts.length ? ` (${parts.join(', ')})` : ''}`;
	});
	return `«${block.title}»\n${months.join('\n')}`;
}
