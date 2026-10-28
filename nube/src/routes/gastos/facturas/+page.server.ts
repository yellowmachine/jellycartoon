import type { PageServerLoad } from './$types';
import { consumptionByMonth } from 'comun/bill-months.ts';
import { BILL_KINDS } from 'comun/bills.ts';
import { addMonths, monthOf } from 'comun/expenses.ts';
import { billKinds, billsOf } from '#lib/server/expenses/bills.ts';
import { kitchenOf, today } from '#lib/server/fridge.ts';

/**
 * Gastos → Facturas (#232), for the adults: of one kind (`?de=Agua`, light by default), what was
 * consumed each of the last 12 months beside the same month a year before, and each bill.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const k = await kitchenOf(locals.user!.id);
	const present = await billKinds(k);
	const kinds = BILL_KINDS.filter((k) => present.includes(k) || k === 'Luz');
	const kind = kinds.find((k) => k === url.searchParams.get('de')) ?? 'Luz';
	const bills = await billsOf(k, kind);
	const current = monthOf(today());
	const months = Array.from({ length: 12 }, (_, i) => addMonths(current, i - 11));
	const now = consumptionByMonth(bills, months);
	const before = consumptionByMonth(
		bills,
		months.map((m) => addMonths(m, -12))
	);
	return {
		kinds,
		kind,
		bills,
		unit: bills[0]?.unit ?? (kind === 'Agua' ? 'm³' : 'kWh'),
		months: months.map((month, i) => ({ month, now: now[i]!, before: before[i]! }))
	};
};
