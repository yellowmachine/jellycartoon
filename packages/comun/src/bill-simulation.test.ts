import { describe, expect, test } from 'bun:test';
import { parseBillDetails } from './bills.ts';
import { offerFromBill, simulate, simulateBill, type SimBill } from './bill-simulation.ts';

/** Pepeenergy, September 2026, «Precio estable», 2.0TD: 83,09 € paid. */
const SEPT: SimBill = {
	id: 1,
	periodStart: '2026-09-01',
	periodEnd: '2026-09-30',
	consumption: 280,
	total: 8309,
	details: parseBillDetails({
		consumption: [
			{ name: 'P1', value: 91 },
			{ name: 'P2', value: 66 },
			{ name: 'P3', value: 123 }
		],
		power: [
			{ name: 'P1', value: 3.45 },
			{ name: 'P2', value: 3.45 }
		],
		// 2,308701 and 0,060452 €/kW·mes, by the day.
		powerPrice: [
			{ name: 'P1', value: 0.075902 },
			{ name: 'P2', value: 0.0019875 }
		],
		unitPrice: 0.198,
		pricing: 'fijo',
		electricityTax: 5.1127,
		vat: 21
	})
};

describe('¿Y si…?', () => {
	test('its own tariff, worked out: within 1 % of what was paid', () => {
		const own = offerFromBill(SEPT)!;
		expect(own).toMatchObject({ energy: { kind: 'fijo', price: 0.198 }, power: null });
		const { cents } = simulateBill(SEPT, own);
		expect(Math.abs(cents! - SEPT.total) / SEPT.total).toBeLessThan(0.01);
	});

	test('by periods: each period’s kWh at its price; less power, less paid', () => {
		const offer = {
			name: 'Tres periodos',
			energy: { kind: 'periodos' as const, P1: 0.25, P2: 0.18, P3: 0.12 },
			powerPrice: { P1: 0.075902, P2: 0.0019875 },
			power: null,
			monthlyFee: 0
		};
		const periods = simulateBill(SEPT, offer).cents!;
		const flat = simulateBill(SEPT, offerFromBill(SEPT)!).cents!;
		// 91 × 0,25 + 66 × 0,18 + 123 × 0,12 = 49,39 € of energy, against 55,44 €.
		expect(Math.abs(flat - periods - (55.44 - 49.39) * 1.051127 * 1.21 * 100)).toBeLessThanOrEqual(
			1
		);
		const lower = simulateBill(SEPT, { ...offer, power: { P1: 3.3, P2: 3.3 } }).cents!;
		expect(lower).toBeLessThan(periods);
	});

	test('what a bill does not say: not made up', () => {
		const bare = { ...SEPT, details: parseBillDetails({ unitPrice: 0.198 }) };
		const offer = offerFromBill(SEPT)!;
		expect(simulateBill(bare, offer)).toEqual({
			cents: null,
			missing: 'no dice la potencia contratada'
		});
		expect(
			simulateBill(bare, {
				...offer,
				power: { P1: 3.45, P2: 3.45 },
				energy: { kind: 'periodos', P1: 0.2, P2: 0.2, P3: 0.2 }
			}).missing
		).toBe('no dice lo consumido en punta, llano y valle');
		expect(offerFromBill(bare)).toBeNull();
	});

	test('the year: the bills of the last 365 days, and each tariff’s sum', () => {
		const old = { ...SEPT, id: 0, periodStart: '2025-08-01', periodEnd: '2025-08-31' };
		const aug = { ...SEPT, id: 2, periodStart: '2026-08-01', periodEnd: '2026-08-31' };
		const sim = simulate([SEPT, aug, old], [offerFromBill(SEPT)!]);
		expect(sim.bills).toHaveLength(3);
		expect(sim.year).toMatchObject({ bills: 2, days: 61, paid: 2 * 8309 });
		expect(sim.year.offers[0]).toBe(
			sim.bills[0]!.offers[0]!.cents! + sim.bills[1]!.offers[0]!.cents!
		);
	});
});
