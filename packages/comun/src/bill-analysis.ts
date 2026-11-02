import { billDays, type BillInput } from './bills.ts';

/**
 * Gastos → Facturas, at a glance (#232): what each bill costs a day and consumes a day (bills cover
 * 29, 31, 33 days: their totals do not compare), its real price per unit (everything paid over what
 * was consumed: power, taxes, the meter, discounts), each beside the bill that covered the same days
 * a year before; and what to look at: a bill whose parts do not add up to its total, or one much
 * dearer than a year before. Worked out here, exactly: no AI.
 */

/** A bill as Facturas has it: what was paid (cents) and, read from it, what its parts add up to. */
export type AnalysedBill = Pick<BillInput, 'periodStart' | 'periodEnd' | 'consumption'> & {
	id: number;
	total: number;
	/** The sum of its parts (cents); null without parts. */
	partsSum: number | null;
};

/** Over this much dearer a day than a year before, it is said. */
export const RISE_WARNING = 0.15;
/** Within this, the parts add up (cents of rounding). */
const ROUNDING_CENTS = 2;
/** The bill a year before has to cover at least this much of the same days to be compared. */
const MIN_OVERLAP = 0.5;

const DAY_MS = 86_400_000;
const dayOf = (date: string) => Date.parse(`${date}T12:00:00Z`);
const yearEarlier = (date: string) => {
	const d = new Date(`${date}T12:00:00Z`);
	d.setUTCFullYear(d.getUTCFullYear() - 1);
	return d.getTime();
};

/** Days two periods share (`from`/`to` as times of noon). */
const overlapDays = (a: { from: number; to: number }, b: { from: number; to: number }) =>
	Math.max(0, Math.round((Math.min(a.to, b.to) - Math.max(a.from, b.from)) / DAY_MS) + 1);

/** Cents a day; units a day, null without consumption; cents per unit, null without it. */
export function perDay(b: AnalysedBill) {
	const days = billDays(b);
	return {
		days,
		centsPerDay: b.total / days,
		unitsPerDay: b.consumption === null ? null : b.consumption / days,
		centsPerUnit: b.consumption ? b.total / b.consumption : null
	};
}

/** The bill covering most of the same days a year before (at least half of them); null, none. */
export function yearBefore<T extends AnalysedBill>(b: AnalysedBill, bills: T[]): T | null {
	const then = { from: yearEarlier(b.periodStart), to: yearEarlier(b.periodEnd) };
	const days = billDays(b);
	let best: { bill: T; shared: number } | null = null;
	for (const other of bills) {
		const shared = overlapDays(then, {
			from: dayOf(other.periodStart),
			to: dayOf(other.periodEnd)
		});
		if (shared >= days * MIN_OVERLAP && (!best || shared > best.shared))
			best = { bill: other, shared };
	}
	return best?.bill ?? null;
}

/** How much more (or less) than before: 0.12 is 12 % more; null, nothing to compare with. */
export const changeOf = (now: number | null, before: number | null) =>
	now === null || before === null || before <= 0 ? null : now / before - 1;

export interface BillAnalysis {
	id: number;
	centsPerDay: number;
	unitsPerDay: number | null;
	centsPerUnit: number | null;
	/** Against the same days a year before; null without that bill. */
	change: {
		perDay: number | null;
		unitsPerDay: number | null;
		perUnit: number | null;
	} | null;
}

/** Each bill's numbers, in the same order, with its year-before comparison. */
export function analyseBills(bills: AnalysedBill[]): BillAnalysis[] {
	return bills.map((b) => {
		const now = perDay(b);
		const old = yearBefore(b, bills);
		const then = old && perDay(old);
		return {
			id: b.id,
			centsPerDay: now.centsPerDay,
			unitsPerDay: now.unitsPerDay,
			centsPerUnit: now.centsPerUnit,
			change: then
				? {
						perDay: changeOf(now.centsPerDay, then.centsPerDay),
						unitsPerDay: changeOf(now.unitsPerDay, then.unitsPerDay),
						perUnit: changeOf(now.centsPerUnit, then.centsPerUnit)
					}
				: null
		};
	});
}

export type BillWarning =
	| { kind: 'no-cuadra'; id: number; total: number; partsSum: number }
	| { kind: 'sube'; id: number; change: number };

/**
 * What to look at: each bill whose parts do not add up to its total (to check it against the PDF),
 * and the latest, if it costs a day `RISE_WARNING` more than the same days a year before.
 * `bills`, the latest first, as Facturas lists them.
 */
export function billWarnings(bills: AnalysedBill[]): BillWarning[] {
	const warnings: BillWarning[] = bills
		.filter((b) => b.partsSum !== null && Math.abs(b.partsSum - b.total) > ROUNDING_CENTS)
		.map((b) => ({ kind: 'no-cuadra', id: b.id, total: b.total, partsSum: b.partsSum! }));
	const [latest] = bills;
	if (latest) {
		const change = analyseBills(bills).find((a) => a.id === latest.id)?.change?.perDay ?? null;
		if (change !== null && change > RISE_WARNING)
			warnings.push({ kind: 'sube', id: latest.id, change });
	}
	return warnings;
}
