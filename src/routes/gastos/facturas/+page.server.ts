import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { consumptionByMonth } from '#lib/bill-months.ts';
import { BILL_KINDS } from '#lib/bills.ts';
import { addMonths, monthOf } from '#lib/expenses.ts';
import { billKinds, billsOf } from '#lib/server/expenses/bills.ts';
import { isKid } from '#lib/server/kids.ts';
import { today } from '#lib/server/playlist.ts';

/**
 * Gastos → Facturas (#232), for the adults: of one kind (`?de=Agua`, light by default), what was
 * consumed each of the last 12 months beside the same month a year before, and each bill.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	if (isKid(locals.user)) redirect(303, '/');
	const present = await billKinds();
	const kinds = BILL_KINDS.filter((k) => present.includes(k) || k === 'Luz');
	const kind = kinds.find((k) => k === url.searchParams.get('de')) ?? 'Luz';
	const bills = await billsOf(kind);
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
