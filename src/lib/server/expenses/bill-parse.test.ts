import { expect, test } from 'bun:test';
import { billDraftFromAnswer, redact } from './bill-parse.ts';

const TODAY = '2026-10-27';

test('what identifies the house, out of the text; the amounts, kept', () => {
	const text = [
		'NIF: 12.345.678-Z                    Periodo P1 (Punta) — 2,308701 €/kW·mes × 3,45 kW   7,97 €',
		'NIE X1234567L',
		'IBAN **** **** **** **** **** 1725',
		'IBAN ES91 2100 0418 4502 0005 1332',
		'CUPS ES0031105323665001YG0F             Impuesto eléctrico 5,1127%   3,29 €',
		'Contrato 1011116',
		'Contrato de acceso 500024399995',
		'llámanos al teléfono gratuito 900 622 455 o al 644594511',
		'Total 83,09 €   280 kWh   0,198000 €/kWh'
	].join('\n');
	const out = redact(text);
	for (const gone of [
		'12.345.678-Z',
		'X1234567L',
		'1725',
		'ES91',
		'ES0031105323665001YG0F',
		'1011116',
		'500024399995',
		'900 622 455',
		'644594511'
	])
		expect(out).not.toContain(gone);
	for (const kept of [
		'2,308701 €/kW·mes × 3,45 kW   7,97 €',
		'5,1127%   3,29 €',
		'Total 83,09 €   280 kWh   0,198000 €/kWh'
	])
		expect(out).toContain(kept);
});

test("the model's answer: the parts as lines, the supply apart", () => {
	const draft = billDraftFromAnswer(
		{
			provider: 'Pepeenergy',
			kind: 'Luz',
			date: '2026-10-17',
			total: 83.09,
			parts: [
				{ text: 'Potencia', amount: 8.18 },
				{ text: 'Energía', amount: 55.44 },
				{ text: 'Descuento', amount: -3.14 }
			],
			periodStart: '2026-09-01',
			periodEnd: '2026-09-30',
			consumption: 280,
			unit: 'kWh',
			tariff: 'Precio estable · 2.0TD',
			consumptionByPeriod: [
				{ name: 'P1', value: 91 },
				{ name: 'P2', value: 66 },
				{ name: 'P3', value: 123 }
			],
			power: [
				{ name: 'P1', value: 3.45 },
				{ name: 'P2', value: 3.45 }
			],
			maxPower: [
				{ name: 'P1', value: 2.7 },
				{ name: 'P2', value: 2.52 }
			],
			unitPrice: 0.198,
			areaAverage: 199
		},
		TODAY
	);
	expect(draft).toEqual({
		date: '2026-10-17',
		store: 'Pepeenergy',
		category: 'Facturas',
		total: 8309,
		lines: [
			{ text: 'Potencia', quantity: null, amount: 818, tag: 'Otros' },
			{ text: 'Energía', quantity: null, amount: 5544, tag: 'Otros' },
			{ text: 'Descuento', quantity: null, amount: -314, tag: 'Otros' }
		],
		bill: {
			kind: 'Luz',
			periodStart: '2026-09-01',
			periodEnd: '2026-09-30',
			consumption: 280,
			unit: 'kWh',
			details: {
				tariff: 'Precio estable · 2.0TD',
				consumption: [
					{ name: 'P1', value: 91 },
					{ name: 'P2', value: 66 },
					{ name: 'P3', value: 123 }
				],
				power: [
					{ name: 'P1', value: 3.45 },
					{ name: 'P2', value: 3.45 }
				],
				maxPower: [
					{ name: 'P1', value: 2.7 },
					{ name: 'P2', value: 2.52 }
				],
				unitPrice: 0.198,
				areaAverage: 199
			}
		}
	});
});

test('what could not be read, guessed to correct: the month before, the unit of its kind', () => {
	const draft = billDraftFromAnswer(
		{ kind: 'Agua', date: '2026-10-14', periodStart: 'septiembre', total: null, parts: [] },
		TODAY
	);
	expect(draft.bill).toMatchObject({
		kind: 'Agua',
		periodStart: '2026-09-01',
		periodEnd: '2026-09-30',
		consumption: null,
		unit: 'm³'
	});
	expect(draft.total).toBe(0);
	expect(draft.category).toBe('Facturas');
});
