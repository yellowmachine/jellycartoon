import type { BillInput } from './bills.ts';

/** The house's expenses (#194), shared by the server and the pages. Money in cents. */

export const EXPENSE_CATEGORIES = [
	'Supermercado',
	'Restaurantes',
	'Gasolina',
	'Coche',
	'Casa',
	'Facturas',
	'Seguros',
	'Suscripciones',
	'Farmacia y salud',
	'Ropa',
	'Ocio',
	'Niños',
	'Viajes',
	'Mascotas',
	'Otros'
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const isCategory = (value: unknown): value is ExpenseCategory =>
	EXPENSE_CATEGORIES.includes(value as ExpenseCategory);

/**
 * What each line of a receipt is, to see a month's spending by kind within each category: fixed,
 * at most some 20 and with no two alike, so the model does not hesitate between them and they add
 * up. For the lines of any receipt: a supermarket's, a bar's, a chemist's, a petrol station's.
 */
export const LINE_TAGS = [
	'Fruta y verdura',
	'Carne y pescado',
	'Lácteos y huevos',
	'Panadería',
	'Despensa',
	'Congelados',
	'Comida preparada',
	'Bebidas',
	'Alcohol',
	'Caprichos',
	'Limpieza',
	'Higiene',
	'Medicamentos',
	'Bebé y niños',
	'Mascotas',
	'Ropa y calzado',
	'Hogar y bricolaje',
	'Combustible',
	'Otros'
] as const;

export type LineTag = (typeof LINE_TAGS)[number];

export const isTag = (value: unknown): value is LineTag => LINE_TAGS.includes(value as LineTag);

export type ExpenseSource = 'ticket' | 'factura' | 'voz' | 'mano' | 'fijo';

export interface ExpenseLine {
	text: string;
	/** Units, or kg; null when the receipt does not say. */
	quantity: number | null;
	amount: number;
	tag: LineTag;
}

/** What is saved: read from a receipt and corrected, or written by hand. */
export interface ExpenseInput {
	date: string;
	store: string;
	category: ExpenseCategory;
	total: number;
	lines: ExpenseLine[];
}

export interface Expense extends ExpenseInput {
	id: number;
	source: ExpenseSource;
	/** Who put it in. */
	by: string | null;
	hasReceipt: boolean;
	/** A bill's (#232): its supply's period and consumption. */
	bill: BillInput | null;
	/** Added by a fixed one, or made one («🔁 Hacer fijo»). */
	fixed: boolean;
}

/**
 * A receipt or a bill read, to be checked before it is saved: its photo or PDF waits under
 * `receipt`.
 */
export interface ExpenseDraft extends ExpenseInput {
	receipt: string;
	/** Which model read it, for the Registro and to say so. */
	readBy: 'ollama' | 'openrouter';
	/** A bill's (#232), with what it says of the supply. */
	bill: BillInput | null;
}

export interface RecurringExpense {
	id: number;
	name: string;
	category: ExpenseCategory;
	amount: number;
	/** 1 to 28. */
	day: number;
	/** Every year, in this month (1 to 12): Prime, an insurance, the IBI. Null, every month. */
	month: number | null;
}

/** A favourite (#194): an expense to put in again, its amount changeable; `total` null, none. */
export interface ExpenseFavorite {
	id: number;
	store: string;
	category: ExpenseCategory;
	total: number | null;
	lines: ExpenseLine[];
}

/** The favourite of a place, one each: the one the voice puts in by its name. */
export const favoriteOf = (favorites: ExpenseFavorite[], store: string) =>
	favorites.find((f) => f.store.toLowerCase() === store.trim().toLowerCase());

/**
 * Whether an expense is its place's favourite as it is: the same category, amount and lines, not
 * just the same place (the kebab of 5 €, not another day's three things there). A favourite
 * without an amount is any amount.
 */
export function isFavorite(
	e: { store: string; category: ExpenseCategory; total: number | null; lines: ExpenseLine[] },
	f: ExpenseFavorite
) {
	const line = (l: ExpenseLine) => `${l.text.trim()}|${l.quantity ?? ''}|${l.amount}|${l.tag}`;
	const lines = e.lines.filter((l) => l.text.trim());
	return (
		f.store.toLowerCase() === e.store.trim().toLowerCase() &&
		f.category === e.category &&
		(f.total === null || f.total === e.total) &&
		lines.length === f.lines.length &&
		lines.every((l, i) => line(l) === line(f.lines[i]))
	);
}

export const MAX_LINES = 200;
/** A receipt's total in cents, at most: a million euros is not a receipt. */
const MAX_CENTS = 100_000_000;

/** «12,30 €», as in Spain. */
export function euros(cents: number) {
	return `${(cents / 100).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

/** «12,30», «12.30», «12» or «1.234,50» written in a box: cents; null if it is not an amount. */
export function parseEuros(text: string): number | null {
	let t = text.trim().replace(/\s|€/g, '');
	if (!t) return null;
	// «1.234,50»: dots for thousands; «12.30» alone: a decimal point.
	if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
	if (!/^-?\d+(\.\d{1,2})?$/.test(t)) return null;
	return Math.round(Number(t) * 100);
}

/** `YYYY-MM-DD` that is a real day. */
export const isDay = (value: unknown): value is string =>
	typeof value === 'string' &&
	/^\d{4}-\d{2}-\d{2}$/.test(value) &&
	!Number.isNaN(Date.parse(`${value}T12:00:00Z`)) &&
	new Date(`${value}T12:00:00Z`).toISOString().startsWith(value);

const cents = (value: unknown) =>
	Number.isInteger(value) && Math.abs(value as number) <= MAX_CENTS ? (value as number) : null;

/** What a page sends to be saved, only if well formed; lines without text are left out. */
export function parseExpenseInput(body: unknown): ExpenseInput | null {
	if (!body || typeof body !== 'object') return null;
	const { date, store, category, total, lines } = body as Record<string, unknown>;
	if (!isDay(date) || typeof store !== 'string' || !store.trim() || !isCategory(category))
		return null;
	const sum = cents(total);
	if (sum === null || !Array.isArray(lines) || lines.length > MAX_LINES) return null;
	const parsed: ExpenseLine[] = [];
	for (const line of lines) {
		if (!line || typeof line !== 'object') return null;
		const { text, quantity, amount, tag } = line as Record<string, unknown>;
		if (typeof text !== 'string') return null;
		const value = cents(amount);
		if (value === null) return null;
		if (quantity !== null && (typeof quantity !== 'number' || !(quantity >= 0))) return null;
		if (text.trim())
			parsed.push({
				text: text.trim().slice(0, 200),
				quantity: quantity as number | null,
				amount: value,
				tag: isTag(tag) ? tag : 'Otros'
			});
	}
	return { date, store: store.trim().slice(0, 120), category, total: sum, lines: parsed };
}

/** The lines' sum, to say when it is not the total (something misread, or a discount). */
export const linesSum = (lines: ExpenseLine[]) => lines.reduce((sum, l) => sum + l.amount, 0);

/** What is not in any line, in a month by tag: the totals without lines, and what lines miss. */
export const UNTAGGED = 'Sin desglose';

/**
 * A category's expenses by their lines' tags, largest first; what the lines do not cover (written
 * without lines, a discount not read), apart, so it adds up to the category's total.
 */
export function byTag(expenses: ExpenseInput[]) {
	const totals = new Map<string, number>();
	const add = (key: string, cents: number) => totals.set(key, (totals.get(key) ?? 0) + cents);
	for (const e of expenses) {
		for (const l of e.lines) add(l.tag, l.amount);
		add(UNTAGGED, e.total - linesSum(e.lines));
	}
	return [...totals]
		.map(([tag, total]) => ({ tag, total }))
		.filter((t) => t.total !== 0)
		.sort((a, b) => (a.tag === UNTAGGED ? 1 : b.tag === UNTAGGED ? -1 : b.total - a.total));
}

/** `YYYY-MM` of a day. */
export const monthOf = (day: string) => day.slice(0, 7);

/** The month before or after `month` (`YYYY-MM`). */
export function addMonths(month: string, by: number) {
	const [y, m] = month.split('-').map(Number);
	const at = new Date(Date.UTC(y!, m! - 1 + by, 1));
	return at.toISOString().slice(0, 7);
}

/**
 * The month (`YYYY-MM`) a fixed one last fell due by `today` (`YYYY-MM-DD`), its day included:
 * monthly, this month or the one before; yearly, this year's or last year's.
 */
export function lastDue(r: { day: number; month: number | null }, today: string) {
	const thisMonth = monthOf(today);
	const passed = (month: string) => `${month}-${String(r.day).padStart(2, '0')}` <= today;
	if (r.month === null) return passed(thisMonth) ? thisMonth : addMonths(thisMonth, -1);
	const thisYear = `${today.slice(0, 4)}-${String(r.month).padStart(2, '0')}`;
	return passed(thisYear) ? thisYear : addMonths(thisYear, -12);
}

/**
 * The months a fixed one is to be added in by `today`, after `lastMonth` (the last added; null,
 * none yet: from this month on): also the ones missed while nobody looked.
 */
export function dueMonths(
	r: { day: number; month: number | null },
	lastMonth: string | null,
	today: string
) {
	const last = lastDue(r, today);
	const due: string[] = [];
	let month = lastMonth ? addMonths(lastMonth, 1) : monthOf(today);
	for (; month <= last; month = addMonths(month, 1))
		if (r.month === null || Number(month.slice(5, 7)) === r.month) due.push(month);
	return due;
}

/** «octubre de 2026». */
export function monthName(month: string) {
	const [y, m] = month.split('-').map(Number);
	return new Date(Date.UTC(y!, m! - 1, 15)).toLocaleDateString('es-ES', {
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC'
	});
}
