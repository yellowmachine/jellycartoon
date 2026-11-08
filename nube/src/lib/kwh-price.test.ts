import { describe, expect, test } from 'bun:test';
import { parseBillDetails } from 'comun/bills.ts';
import { billName, kwhPriceText, periodAt, priceAt, priceFromBill } from './kwh-price.ts';

/** The light bill of September 2026 (Pepeenergy, «Precio estable», 2.0TD), as read. */
const ESTABLE = parseBillDetails({
	tariff: 'Precio estable · 2.0TD',
	consumption: [
		{ name: 'P1', value: 91 },
		{ name: 'P2', value: 66 },
		{ name: 'P3', value: 123 }
	],
	unitPrice: 0.198,
	pricing: 'fijo',
	energyPrice: [],
	electricityTax: 5.1127,
	vat: 21
});

describe('precio del kWh', () => {
	test('2.0TD: valle at night, weekends and holidays; punta and llano on weekdays', () => {
		// Madrid time is UTC+1 in November.
		const at = (iso: string) => periodAt(new Date(iso));
		expect(at('2026-11-09T06:00:00Z')).toBe('P3'); // Monday 7:00
		expect(at('2026-11-09T07:00:00Z')).toBe('P2'); // 8:00
		expect(at('2026-11-09T09:00:00Z')).toBe('P1'); // 10:00
		expect(at('2026-11-09T13:00:00Z')).toBe('P2'); // 14:00
		expect(at('2026-11-09T17:00:00Z')).toBe('P1'); // 18:00
		expect(at('2026-11-09T21:00:00Z')).toBe('P2'); // 22:00
		expect(at('2026-11-08T11:00:00Z')).toBe('P3'); // Sunday noon
		expect(at('2026-12-08T11:00:00Z')).toBe('P3'); // a Tuesday, a holiday
		// Summer, UTC+2: 10:00 is 08:00 UTC.
		expect(at('2026-07-06T08:00:00Z')).toBe('P1');
	});

	test('one price at all hours: the energy with its taxes, not the total by the kWh', () => {
		const price = priceFromBill(ESTABLE, billName('Pepeenergy', '2026-09-30'))!;
		expect(price).toEqual({
			source: 'factura',
			pricing: 'fijo',
			flat: 0.2518,
			periods: null,
			from: 'Pepeenergy, septiembre 2026'
		});
		expect(priceAt(price, new Date('2026-11-09T09:00:00Z'))).toBe(0.2518);
		expect(kwhPriceText(price)).toBe(
			'0,252 €/kWh con impuestos, precio fijo, de la factura de Pepeenergy, septiembre 2026'
		);
	});

	test('by periods: each hour at its own; shown, the average as the bill used them', () => {
		const price = priceFromBill(
			parseBillDetails({
				...ESTABLE,
				pricing: 'periodos',
				energyPrice: [
					{ name: 'P1 (Punta)', value: 0.3 },
					{ name: 'P2 (Llano)', value: 0.2 },
					{ name: 'P3 (Valle)', value: 0.1 }
				]
			}),
			null
		)!;
		expect(price.pricing).toBe('periodos');
		expect(price.periods).toEqual({ P1: 0.3816, P2: 0.2544, P3: 0.1272 });
		expect(priceAt(price, new Date('2026-11-09T09:00:00Z'))).toBe(0.3816);
		expect(priceAt(price, new Date('2026-11-09T04:00:00Z'))).toBe(0.1272);
		// (91 × 0,3816 + 66 × 0,2544 + 123 × 0,1272) / 280
		expect(price.flat).toBeCloseTo(0.2399, 4);
	});

	test('indexed: the bill’s average, said to be approximate; without a price, none', () => {
		const price = priceFromBill(parseBillDetails({ ...ESTABLE, pricing: 'indexado' }), 'X')!;
		expect(price).toMatchObject({ pricing: 'indexado', flat: 0.2518, periods: null });
		expect(kwhPriceText(price)).toContain('aproximado');
		expect(priceFromBill(parseBillDetails({ tariff: 'PVPC' }), null)).toBeNull();
	});

	test('a bill read before: no pricing nor taxes, one price and Spain’s taxes', () => {
		const old = parseBillDetails({ unitPrice: 0.198 });
		expect(old).toMatchObject({ pricing: null, energyPrice: [], electricityTax: null, vat: null });
		expect(priceFromBill(old, null)).toMatchObject({ pricing: 'fijo', flat: 0.2518 });
	});
});
