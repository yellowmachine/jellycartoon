import { isDay } from '#lib/expenses.ts';

/**
 * The house's bills (#232): an expense with what it says of the supply, to see the consumption and
 * not only what was paid. Light first; water and gas keep theirs in the same `details`.
 */

export const BILL_KINDS = ['Luz', 'Agua', 'Gas'] as const;
export type BillKind = (typeof BILL_KINDS)[number];
export const isBillKind = (value: unknown): value is BillKind =>
	BILL_KINDS.includes(value as BillKind);

export const BILL_UNITS = ['kWh', 'm³'] as const;
export type BillUnit = (typeof BILL_UNITS)[number];
export const isBillUnit = (value: unknown): value is BillUnit =>
	BILL_UNITS.includes(value as BillUnit);

/** A period of the tariff («P1», punta) and how much of something in it. */
export interface BillPeriod {
	name: string;
	value: number;
}

/** What is particular to each kind, as the bill says it; empty or null when it does not. */
export interface BillDetails {
	/** The tariff, as named: «Precio estable · 2.0TD». */
	tariff: string | null;
	/** Consumption in each period (P1 punta, P2 llano, P3 valle), in the bill's unit. */
	consumption: BillPeriod[];
	/** Power contracted in each period, kW. */
	power: BillPeriod[];
	/** The highest power demanded in the last year, kW: what says the contracted one is too much. */
	maxPower: BillPeriod[];
	/** Price of the energy (or water) as billed, €/unit, before taxes. */
	unitPrice: number | null;
	/** What the same postcode consumes on average, per month, when it says so. */
	areaAverage: number | null;
}

export interface BillInput {
	kind: BillKind;
	/** The supply's period, `YYYY-MM-DD`, both included. */
	periodStart: string;
	periodEnd: string;
	consumption: number | null;
	unit: BillUnit;
	details: BillDetails;
}

/** Days of its period, both ends included. */
export const billDays = (b: Pick<BillInput, 'periodStart' | 'periodEnd'>) =>
	Math.round((Date.parse(b.periodEnd) - Date.parse(b.periodStart)) / 86_400_000) + 1;

const MAX_PERIODS = 6;

const finite = (value: unknown, max = 1_000_000) =>
	typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < max ? value : null;

function periods(value: unknown): BillPeriod[] {
	if (!Array.isArray(value)) return [];
	return value.slice(0, MAX_PERIODS).flatMap((p: unknown) => {
		const { name, value: v } = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
		const n = typeof name === 'string' ? name.trim().slice(0, 40) : '';
		const amount = finite(v);
		return n && amount !== null ? [{ name: n, value: amount }] : [];
	});
}

/** What a model or a page says of the details, only what is well formed. */
export function parseBillDetails(value: unknown): BillDetails {
	const d = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
	return {
		tariff: typeof d.tariff === 'string' && d.tariff.trim() ? d.tariff.trim().slice(0, 120) : null,
		consumption: periods(d.consumption),
		power: periods(d.power),
		maxPower: periods(d.maxPower),
		unitPrice: finite(d.unitPrice, 100),
		areaAverage: finite(d.areaAverage)
	};
}

/** What a page sends to be saved with its expense, only if well formed; a period of at most a year. */
export function parseBillInput(body: unknown): BillInput | null {
	if (!body || typeof body !== 'object') return null;
	const { kind, periodStart, periodEnd, consumption, unit, details } = body as Record<
		string,
		unknown
	>;
	if (!isBillKind(kind) || !isBillUnit(unit) || !isDay(periodStart) || !isDay(periodEnd))
		return null;
	if (periodEnd < periodStart || billDays({ periodStart, periodEnd }) > 366) return null;
	if (consumption !== null && finite(consumption) === null) return null;
	return {
		kind,
		periodStart,
		periodEnd,
		consumption: consumption as number | null,
		unit,
		details: parseBillDetails(details)
	};
}
