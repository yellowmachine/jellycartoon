import {
	BILL_KINDS,
	BILL_UNITS,
	billDays,
	isBillKind,
	isBillUnit,
	parseBillDetails,
	type BillInput
} from '#lib/bills.ts';
import { isDay, linesSum, MAX_LINES, type ExpenseInput } from '#lib/expenses.ts';

/**
 * What the model is asked for, a bill as read (#232): its expense (who, when, the total and the
 * parts that make it up, as lines) and its supply. The same schema for Ollama and OpenRouter, which
 * wants every property required: what the bill does not say, null or empty.
 */

const PERIODS = {
	type: 'array',
	items: {
		type: 'object',
		properties: { name: { type: 'string' }, value: { type: 'number' } },
		required: ['name', 'value'],
		additionalProperties: false
	}
};

export const BILL_SCHEMA = {
	type: 'object',
	properties: {
		provider: { type: 'string' },
		kind: { type: 'string', enum: [...BILL_KINDS] },
		date: { type: 'string' },
		total: { type: 'number' },
		parts: {
			type: 'array',
			items: {
				type: 'object',
				properties: { text: { type: 'string' }, amount: { type: 'number' } },
				required: ['text', 'amount'],
				additionalProperties: false
			}
		},
		periodStart: { type: 'string' },
		periodEnd: { type: 'string' },
		consumption: { type: ['number', 'null'] },
		unit: { type: 'string', enum: [...BILL_UNITS] },
		tariff: { type: ['string', 'null'] },
		consumptionByPeriod: PERIODS,
		power: PERIODS,
		maxPower: PERIODS,
		unitPrice: { type: ['number', 'null'] },
		areaAverage: { type: ['number', 'null'] }
	},
	required: [
		'provider',
		'kind',
		'date',
		'total',
		'parts',
		'periodStart',
		'periodEnd',
		'consumption',
		'unit',
		'tariff',
		'consumptionByPeriod',
		'power',
		'maxPower',
		'unitPrice',
		'areaAverage'
	],
	additionalProperties: false
};

export const BILL_PROMPT =
	'Es una factura de un suministro de casa (luz, agua o gas), casi siempre española. Extrae: la ' +
	'compañía que factura (su nombre comercial, sin «S.L.»); qué es (Luz, Agua o Gas); la fecha del ' +
	'cargo en el banco, o si no la de emisión (YYYY-MM-DD); el total a pagar en euros; y las partes ' +
	'del desglose que suman ese total, cada una con su importe en euros: en la luz, potencia, energía, ' +
	'cuotas, otros costes, impuesto eléctrico, IVA, y los descuentos con importe negativo. Toma los ' +
	'importes del desglose detallado, no los del resumen de la primera página, que a veces no ' +
	'coinciden: las partes tienen que sumar el total. No pongas el total como parte. El periodo ' +
	'facturado, del primer al último día (YYYY-MM-DD): si solo dice el mes y los días, del 1 a su ' +
	'último. El consumo total del periodo y su unidad (kWh la luz y el gas; m³ el agua). La tarifa, ' +
	'como la nombra. El consumo de cada periodo de la tarifa, con su nombre corto (P1, P2, P3) y ' +
	'solo si la factura lo desglosa («P1: 91 kWh»); los de todos los periodos suman el consumo ' +
	'total. La potencia contratada (kW) solo de los periodos que la tienen (en la tarifa 2.0TD, P1 ' +
	'y P2), la máxima demandada si la dice (kW), el precio de la ' +
	'energía o del agua por unidad sin impuestos (€) y el consumo medio de la zona o del código ' +
	'postal si lo dice. Lo que no diga: null, o la lista vacía. Los números usan coma decimal: 8,18 ' +
	'es 8.18. Sin datos personales: ni nombre, ni DNI, ni cuenta, ni dirección.';

/**
 * The bill's text without what identifies the house (#232): DNI or NIE, IBAN, CUPS (the supply
 * point), phone numbers and contract numbers; to the model only what it reads. The name and the
 * address are not recognisable by their shape: the prompt asks for neither.
 */
export function redact(text: string) {
	return (
		text
			// IBAN, also masked («IBAN **** 1725» or «ES12 3456 …»).
			.replace(/\bIBAN\b[\s:]*(?:[A-Z]{2}\d{2}|\*{2,})[\d* ]*\d/g, 'IBAN ·')
			.replace(/\b[A-Z]{2}\d{2}(?: ?[\dA-Z]{4}){4,7}\b/g, '·')
			// CUPS: ES, 16 digits, 2 letters, and maybe a digit and a letter.
			.replace(/\bES\d{16}[A-Z]{2}(?:\d[A-Z])?\b/g, '·')
			// DNI («48.427.674-R») and NIE («X1234567L»), with dots and a dash or not.
			.replace(/\b\d{2}\.?\d{3}\.?\d{3}[- ]?[A-Z]\b/g, '·')
			.replace(/\b[XYZ][- ]?\d{7}[- ]?[A-Z]\b/g, '·')
			// Contract numbers, and Spanish phone numbers.
			.replace(/\b(contrato(?: de acceso)?)\s+\d{5,}/gi, '$1 ·')
			.replace(/(?<![\d,.])(?:\+34 ?)?[6789]\d{2} ?\d{3} ?\d{3}(?![\d,.])/g, '·')
	);
}

/** Euros as the model says them, to cents; nonsense, null. */
const toCents = (value: unknown) =>
	typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 1_000_000
		? Math.round(value * 100)
		: null;

/** The day `days` before or after `day`. */
const addDays = (day: string, days: number) =>
	new Date(Date.parse(`${day}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * The model's answer, to what the page shows to check: what it could not read is left empty or
 * guessed (today, the parts' sum, the month before the bill), for a person to correct.
 */
export function billDraftFromAnswer(
	answer: unknown,
	today: string
): ExpenseInput & { bill: BillInput } {
	const a = (answer && typeof answer === 'object' ? answer : {}) as Record<string, unknown>;
	const lines = (Array.isArray(a.parts) ? a.parts : [])
		.slice(0, MAX_LINES)
		.flatMap((p: unknown) => {
			const l = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
			const text = typeof l.text === 'string' ? l.text.trim().slice(0, 200) : '';
			const amount = toCents(l.amount);
			return text && amount !== null
				? [{ text, quantity: null, amount, tag: 'Otros' as const }]
				: [];
		});
	const kind = isBillKind(a.kind) ? a.kind : 'Luz';
	const date = isDay(a.date) && a.date <= today ? a.date : today;
	let periodStart = isDay(a.periodStart) ? a.periodStart : null;
	let periodEnd = isDay(a.periodEnd) ? a.periodEnd : null;
	if (
		!periodStart ||
		!periodEnd ||
		periodEnd < periodStart ||
		billDays({ periodStart, periodEnd }) > 366
	) {
		// Not read: the month before the bill, to correct.
		periodEnd = addDays(date, -Number(date.slice(8, 10)));
		periodStart = `${periodEnd.slice(0, 7)}-01`;
	}
	const consumption =
		typeof a.consumption === 'number' && Number.isFinite(a.consumption) && a.consumption >= 0
			? a.consumption
			: null;
	const details = parseBillDetails({ ...a, consumption: a.consumptionByPeriod });
	// The periods' consumption that does not add up to the total was made up (the total in each):
	// better none than a wrong one.
	const byPeriod = details.consumption.reduce((sum, p) => sum + p.value, 0);
	if (consumption === null || Math.abs(byPeriod - consumption) > Math.max(1, consumption * 0.02))
		details.consumption = [];
	return {
		date,
		store: typeof a.provider === 'string' ? a.provider.trim().slice(0, 120) : '',
		category: 'Facturas',
		total: toCents(a.total) || linesSum(lines),
		lines,
		bill: {
			kind,
			periodStart,
			periodEnd,
			consumption,
			unit: isBillUnit(a.unit) ? a.unit : kind === 'Agua' ? 'm³' : 'kWh',
			details
		}
	};
}
