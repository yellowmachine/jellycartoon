import { addMonths } from './expenses.ts';
import { billDays, type BillInput } from './bills.ts';

/**
 * Each month's consumption from the bills that cover it (#232): a period across two months (water
 * by two months, light from the 15th to the 14th) is shared out by its days. `months`, oldest
 * first; a month no bill covers, null, not 0: unknown, not nothing.
 */
export function consumptionByMonth(
	bills: Pick<BillInput, 'periodStart' | 'periodEnd' | 'consumption'>[],
	months: string[]
) {
	const totals = new Map<string, number>();
	const covered = new Set<string>();
	for (const b of bills) {
		if (b.consumption === null) continue;
		const perDay = b.consumption / billDays(b);
		let month = b.periodStart.slice(0, 7);
		while (month <= b.periodEnd.slice(0, 7)) {
			const from = month === b.periodStart.slice(0, 7) ? b.periodStart : `${month}-01`;
			const to =
				month === b.periodEnd.slice(0, 7)
					? b.periodEnd
					: new Date(Date.parse(`${addMonths(month, 1)}-01T12:00:00Z`) - 86_400_000)
							.toISOString()
							.slice(0, 10);
			totals.set(
				month,
				(totals.get(month) ?? 0) + perDay * billDays({ periodStart: from, periodEnd: to })
			);
			covered.add(month);
			month = addMonths(month, 1);
		}
	}
	return months.map((month) =>
		covered.has(month) ? Math.round((totals.get(month) ?? 0) * 10) / 10 : null
	);
}
