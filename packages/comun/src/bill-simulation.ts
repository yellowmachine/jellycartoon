import { billDays, type BillInput, type BillPeriod } from './bills.ts';

/**
 * «¿Y si…?» (#232): what each light bill would have cost with another tariff, from what it says was
 * consumed (in each period, for a tariff by periods) and the power contracted. A bill is worked out
 * as Spanish ones are: power (kW × €/kW·day × days) and energy, the electricity tax on them, the
 * meter and the bono social, a monthly fee if the offer has one, and VAT on everything. What each
 * company adds or takes off besides (its own fee, an insurance, a discount) is not known for
 * another: so the same tariff as now, worked out, is shown beside what was paid, to see how near.
 * Worked out here, exactly: no AI.
 */

export type PeriodPrices = { P1: number; P2: number; P3: number };

export interface TariffOffer {
	name: string;
	/** €/kWh before taxes: one at all hours, or one per period (punta, llano, valle). */
	energy: { kind: 'fijo'; price: number } | ({ kind: 'periodos' } & PeriodPrices);
	/** € per kW and day before taxes, punta and valle. */
	powerPrice: { P1: number; P2: number };
	/** kW contracted; null, as each bill. */
	power: { P1: number; P2: number } | null;
	/** € a month before taxes: the company's fee, if any. */
	monthlyFee: number;
}

/** The meter's rent, € a day (Orden ITC/3860/2007), and the bono social, € a month: regulated. */
export const METER_PER_DAY = 0.02663;
export const BONO_SOCIAL_PER_MONTH = 0.75;
/** As in Spain since 2021 when a bill does not say them, in %. */
export const ELECTRICITY_TAX = 5.11269632;
export const VAT = 21;

/** What the bills say: a light bill as Facturas has it. */
export type SimBill = Pick<BillInput, 'periodStart' | 'periodEnd' | 'consumption' | 'details'> & {
	id: number;
	/** Paid, cents. */
	total: number;
};

export interface SimResult {
	/** Cents with taxes; null if the bill does not say enough (the reason). */
	cents: number | null;
	missing: string | null;
}

const PERIODS = ['P1', 'P2', 'P3'] as const;

/** «P1», «P1 (Punta)», «Valle»: which. */
function periodOf(name: string): (typeof PERIODS)[number] | null {
	const word = name.toLowerCase().match(/p[123]|punta|llano|valle/)?.[0];
	if (!word) return null;
	return word === 'punta'
		? 'P1'
		: word === 'llano'
			? 'P2'
			: word === 'valle'
				? 'P3'
				: (word.toUpperCase() as 'P1' | 'P2' | 'P3');
}

/** A list of periods as P1, P2, P3; null if one of `need` is not there. */
function byPeriod(list: BillPeriod[], need: readonly string[]) {
	const out: Partial<Record<string, number>> = {};
	for (const p of list) {
		const name = periodOf(p.name);
		if (name) out[name] = (out[name] ?? 0) + p.value;
	}
	return need.every((n) => out[n] !== undefined) ? (out as Record<string, number>) : null;
}

/** One bill with one tariff. */
export function simulateBill(bill: SimBill, offer: TariffOffer): SimResult {
	const days = billDays(bill);
	let energy: number;
	if (offer.energy.kind === 'fijo') {
		if (bill.consumption === null) return { cents: null, missing: 'no dice lo consumido' };
		energy = bill.consumption * offer.energy.price;
	} else {
		const used = byPeriod(bill.details.consumption, PERIODS);
		if (!used) return { cents: null, missing: 'no dice lo consumido en punta, llano y valle' };
		const prices = offer.energy;
		energy = PERIODS.reduce((sum, p) => sum + used[p]! * prices[p], 0);
	}
	const kw = offer.power ?? byPeriod(bill.details.power, ['P1', 'P2']);
	if (!kw) return { cents: null, missing: 'no dice la potencia contratada' };
	const power = (kw.P1 * offer.powerPrice.P1 + kw.P2 * offer.powerPrice.P2) * days;
	const months = (days * 12) / 365;
	const tax = power + energy;
	const electricityTax = tax * ((bill.details.electricityTax ?? ELECTRICITY_TAX) / 100);
	const base =
		tax +
		electricityTax +
		METER_PER_DAY * days +
		BONO_SOCIAL_PER_MONTH * months +
		offer.monthlyFee * months;
	const total = base * (1 + (bill.details.vat ?? VAT) / 100);
	return { cents: Math.round(total * 100), missing: null };
}

/**
 * The tariff a bill says it has, as an offer: its energy price (by period if it gives them) and
 * its power's. Null if it does not say them.
 */
export function offerFromBill(bill: SimBill, name = 'Tu tarifa'): TariffOffer | null {
	const d = bill.details;
	const powerPrice = byPeriod(d.powerPrice, ['P1', 'P2']);
	if (!powerPrice) return null;
	const prices = byPeriod(d.energyPrice, PERIODS);
	const energy: TariffOffer['energy'] | null =
		prices && d.pricing !== 'fijo'
			? { kind: 'periodos', P1: prices.P1!, P2: prices.P2!, P3: prices.P3! }
			: d.unitPrice
				? { kind: 'fijo', price: d.unitPrice }
				: null;
	if (!energy) return null;
	return {
		name,
		energy,
		powerPrice: { P1: powerPrice.P1!, P2: powerPrice.P2! },
		power: null,
		monthlyFee: 0
	};
}

export interface Simulation {
	/** The bills used, the latest first: what was paid and each tariff's. */
	bills: {
		id: number;
		periodStart: string;
		periodEnd: string;
		paid: number;
		offers: SimResult[];
	}[];
	/** Over the bills of the last year (all of them, if less): days, paid, each tariff's sum (null if one bill is missing). */
	year: { bills: number; days: number; paid: number; offers: (number | null)[] };
}

/** Bills within this many days of the latest's end count in the year. */
const YEAR_DAYS = 365;

/** Each light bill with each tariff, and the last year's sums. `bills`, the latest first. */
export function simulate(bills: SimBill[], offers: TariffOffer[]): Simulation {
	const rows = bills.map((b) => ({
		id: b.id,
		periodStart: b.periodStart,
		periodEnd: b.periodEnd,
		paid: b.total,
		offers: offers.map((o) => simulateBill(b, o))
	}));
	const latest = bills[0]?.periodEnd;
	const from = latest
		? new Date(Date.parse(`${latest}T12:00:00Z`) - YEAR_DAYS * 86_400_000)
				.toISOString()
				.slice(0, 10)
		: '';
	const inYear = rows.filter((r) => r.periodStart > from);
	return {
		bills: rows,
		year: {
			bills: inYear.length,
			days: inYear.reduce((sum, r) => sum + billDays(r), 0),
			paid: inYear.reduce((sum, r) => sum + r.paid, 0),
			offers: offers.map((_, i) =>
				inYear.every((r) => r.offers[i]!.cents !== null)
					? inYear.reduce((sum, r) => sum + r.offers[i]!.cents!, 0)
					: null
			)
		}
	};
}
