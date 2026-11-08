import type { BillDetails, BillPricing } from 'comun/bills.ts';

/**
 * The price of a kWh for Enchufes (#396): what one more kWh costs, taxes included. Written by hand,
 * or taken from the family's last light bill (Gastos, #232), as each tariff prices it: one price
 * at all hours, one per period of the day (each hour of a plug at its own), or one that changes
 * each hour with the market, of which the bill gives the average (approximate). Not the bill's
 * total divided by its kWh: that carries the power contracted, the meter and the rest, paid with
 * nothing switched on.
 */

export type PeriodName = 'P1' | 'P2' | 'P3';

export interface KwhPrice {
	/** By hand, or from a bill (`from` says which). */
	source: 'mano' | 'factura';
	pricing: BillPricing;
	/** €/kWh with taxes: the one price, or the average of the periods (what is shown first). */
	flat: number;
	/** With `periodos`: each period's, with taxes. */
	periods: Record<PeriodName, number> | null;
	/** «Pepeenergy, septiembre 2026». */
	from: string | null;
}

/** As in Spain since 2021 when the bill does not say them: electricity tax and VAT, in %. */
export const ELECTRICITY_TAX = 5.11269632;
export const VAT = 21;

const TIME_ZONE = 'Europe/Madrid';
const partsFormat = new Intl.DateTimeFormat('en-GB', {
	timeZone: TIME_ZONE,
	weekday: 'short',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	hourCycle: 'h23'
});

/** National holidays on a fixed day (MM-DD), all valle in 2.0TD; Good Friday moves, left out. */
const HOLIDAYS = new Set([
	'01-01',
	'01-06',
	'05-01',
	'08-15',
	'10-12',
	'11-01',
	'12-06',
	'12-08',
	'12-25'
]);

/**
 * The 2.0TD period of an hour (the peninsula's homes, BOE Circular 3/2020): weekends and national
 * holidays valle; on weekdays valle 0–8, punta 10–14 and 18–22, llano the rest.
 */
export function periodAt(at: Date): PeriodName {
	const parts = Object.fromEntries(partsFormat.formatToParts(at).map((p) => [p.type, p.value]));
	const hour = Number(parts.hour);
	if (parts.weekday === 'Sat' || parts.weekday === 'Sun') return 'P3';
	if (HOLIDAYS.has(`${parts.month}-${parts.day}`)) return 'P3';
	if (hour < 8) return 'P3';
	if ((hour >= 10 && hour < 14) || (hour >= 18 && hour < 22)) return 'P1';
	return 'P2';
}

/** The price of a kWh used in the hour starting `at`. */
export const priceAt = (price: KwhPrice, at: Date) =>
	price.periods ? price.periods[periodAt(at)] : price.flat;

const PERIOD_OF: Record<string, PeriodName> = {
	p1: 'P1',
	punta: 'P1',
	p2: 'P2',
	llano: 'P2',
	p3: 'P3',
	valle: 'P3'
};

/** «P1», «P1 (Punta)», «Valle»: its period; null if none of the three. */
function periodNamed(name: string): PeriodName | null {
	const word = name.toLowerCase().match(/p[123]|punta|llano|valle/)?.[0];
	return word ? PERIOD_OF[word]! : null;
}

/**
 * A light bill's price; null if it does not say enough. Its pricing as read, or guessed for bills
 * read before it was asked: prices by period, `periodos`; otherwise one price, `fijo`.
 */
export function priceFromBill(details: BillDetails, from: string | null): KwhPrice | null {
	const taxes =
		(1 + (details.electricityTax ?? ELECTRICITY_TAX) / 100) * (1 + (details.vat ?? VAT) / 100);
	const round = (n: number) => Math.round(n * taxes * 10_000) / 10_000;
	const byPeriod: Partial<Record<PeriodName, number>> = {};
	for (const p of details.energyPrice) {
		const name = periodNamed(p.name);
		if (name && p.value > 0) byPeriod[name] = round(p.value);
	}
	const periods =
		byPeriod.P1 && byPeriod.P2 && byPeriod.P3 ? (byPeriod as Record<PeriodName, number>) : null;
	const pricing: BillPricing =
		details.pricing === 'indexado' ? 'indexado' : periods ? 'periodos' : 'fijo';
	if (pricing === 'periodos' && periods) {
		// Shown first: the average as this bill used them, or plain if it does not say.
		const used = details.consumption.flatMap((c) => {
			const name = periodNamed(c.name);
			return name ? [{ name, kwh: c.value }] : [];
		});
		const kwh = used.reduce((sum, u) => sum + u.kwh, 0);
		const flat = kwh
			? used.reduce((sum, u) => sum + periods[u.name] * u.kwh, 0) / kwh
			: (periods.P1 + periods.P2 + periods.P3) / 3;
		return { source: 'factura', pricing, flat: Math.round(flat * 10_000) / 10_000, periods, from };
	}
	if (!details.unitPrice) return null;
	return { source: 'factura', pricing, flat: round(details.unitPrice), periods: null, from };
}

/** «Pepeenergy, septiembre 2026»: the bill by its company and the month it ends. */
export function billName(store: string, periodEnd: string) {
	const month = new Date(`${periodEnd}T12:00:00Z`).toLocaleDateString('es-ES', {
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC'
	});
	return `${store}, ${month.replace(' de ', ' ')}`;
}

const eur = (n: number) => n.toLocaleString('es-ES', { maximumFractionDigits: 3 });

/**
 * The price in words, for Enchufes and the voice: «0,252 €/kWh con impuestos, precio fijo, de la
 * factura de Pepeenergy, septiembre 2026».
 */
export function kwhPriceText(price: KwhPrice) {
	const where = price.source === 'mano' ? 'puesto a mano' : `de la factura de ${price.from}`;
	if (price.periods)
		return `punta ${eur(price.periods.P1)}, llano ${eur(price.periods.P2)} y valle ${eur(price.periods.P3)} €/kWh con impuestos, cada hora a su precio, ${where}`;
	if (price.pricing === 'indexado')
		return `${eur(price.flat)} €/kWh con impuestos, la media de la factura: el precio cambia cada hora, así que es aproximado; ${where}`;
	return `${eur(price.flat)} €/kWh${price.source === 'factura' ? ' con impuestos, precio fijo' : ''}, ${where}`;
}
