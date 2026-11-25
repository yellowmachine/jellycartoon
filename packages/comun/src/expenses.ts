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

export type ExpenseSource = 'ticket' | 'factura' | 'voz' | 'mano' | 'fijo' | 'banco';

export interface ExpenseLine {
	text: string;
	/** Units, or kg; null when the receipt does not say. */
	quantity: number | null;
	amount: number;
	tag: LineTag;
}

/**
 * Paid in another currency: what the receipt said, in its currency's cents, and the euros one of it
 * was worth that day (the ECB's, by Frankfurter). `rate` null, not changed into euros (no
 * connection, a currency without a rate): the amounts are still the receipt's.
 */
export interface ForeignAmount {
	/** ISO 4217, «USD». */
	currency: string;
	total: number;
	rate: number | null;
}

/** «USD», «GBP»: three capital letters, as ISO 4217 writes them. */
export const isCurrency = (value: unknown): value is string =>
	typeof value === 'string' && /^[A-Z]{3}$/.test(value);

/** What is saved: read from a receipt and corrected, or written by hand. */
export interface ExpenseInput {
	date: string;
	store: string;
	category: ExpenseCategory;
	total: number;
	lines: ExpenseLine[];
	/** Paid in another currency, its amounts already in euros; not said, as it was. */
	foreign?: ForeignAmount | null;
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
	foreign: ForeignAmount | null;
}

/**
 * A receipt or a bill read, to be checked before it is saved: its photo or PDF waits in the page,
 * which sends it with the expense.
 */
export interface ExpenseDraft extends ExpenseInput {
	/** Which model read it, for the Registro and to say so. */
	readBy: 'ollama' | 'openrouter';
	/** A bill's (#232), with what it says of the supply. */
	bill: BillInput | null;
}

/**
 * The fixed one a receipt or bill just read may be the month's of (#501): «¿Es el recibo de Luz de
 * noviembre?». Of its month or the one before (a bill comes late), without a receipt yet.
 */
export interface FixedMatch {
	/** The expense the fixed one added that month. */
	id: number;
	date: string;
	store: string;
	category: ExpenseCategory;
	total: number;
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
	/** With `month`, every so many months from it: 2, 3, 4 or 6; null, every year. */
	every?: number | null;
	/** «Se paga desde»: the account to keep money in; null, not said. */
	paidFrom?: string | null;
	/** «Avísame», days before; 0, never; null, each one's usual (Ajustes). */
	notice?: number | null;
	/** Told to the other adults too, not only to who put it in. */
	noticeAll?: boolean;
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
export const MAX_CENTS = 100_000_000;

/** «12,30 €», as in Spain. */
export function euros(cents: number) {
	return `${(cents / 100).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

/** Cents of another currency, as it writes itself in Spanish: «25,00 US$», «12,00 £». */
export function money(cents: number, currency: string) {
	try {
		return (cents / 100).toLocaleString('es-ES', { style: 'currency', currency });
	} catch {
		return `${(cents / 100).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
	}
}

/** «12,00 US$», or «12,00 US$, sin pasar a euros». */
export const foreignText = (f: ForeignAmount) =>
	`${money(f.total, f.currency)}${f.rate === null ? ', sin pasar a euros' : ''}`;

/** A ForeignAmount sent by a page, if well formed. */
function parseForeign(value: unknown): ForeignAmount | null | undefined {
	if (value === undefined) return undefined;
	if (!value || typeof value !== 'object') return null;
	const { currency, total, rate } = value as Record<string, unknown>;
	const sum = cents(total);
	if (!isCurrency(currency) || currency === 'EUR' || sum === null) return null;
	if (rate !== null && (typeof rate !== 'number' || !(rate > 0) || !Number.isFinite(rate)))
		return null;
	return { currency, total: sum, rate };
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
	const { date, store, category, total, lines, foreign } = body as Record<string, unknown>;
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
	const input: ExpenseInput = {
		date,
		store: store.trim().slice(0, 120),
		category,
		total: sum,
		lines: parsed
	};
	// Not sent, left as it is on correcting; null, in euros.
	const paid = parseForeign(foreign);
	if (paid !== undefined) input.foreign = paid;
	return input;
}

/**
 * A line's text as an own tag's rule keeps it (#459): lowercase, without accents, its spaces one:
 * «Barra  Picos» and «BARRA PICOS» are the same line, «barra picos integral» another.
 */
export const lineKey = (text: string) =>
	text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim();

/** A family's own tags (#459) and its rules: each line's key → its tag's id. */
export interface OwnTags {
	tags: { id: number; name: string }[];
	rules: Record<string, number>;
}

/** The own tag of a line, if a rule gives it one. */
export function ownTagOf(own: OwnTags, text: string) {
	const id = own.rules[lineKey(text)];
	return id === undefined ? null : (own.tags.find((t) => t.id === id) ?? null);
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

/** The expenses with no shop written (said by voice, some fixed ones), as one more. */
export const NO_STORE = 'Sin tienda';

/**
 * The month's expenses by shop, largest first, to see Amazon apart from what it sold: the same
 * shop written differently («Amazon», « amazon ») together, with the spelling written most often;
 * the ones with no shop, last, so it adds up to the month's total.
 */
export function byStore(expenses: { store: string; total: number }[]) {
	const shops = new Map<string, { total: number; count: number; names: Map<string, number> }>();
	for (const e of expenses) {
		const name = e.store.replace(/\s+/g, ' ').trim();
		const key = lineKey(name);
		const shop = shops.get(key) ?? { total: 0, count: 0, names: new Map() };
		shop.total += e.total;
		shop.count += 1;
		shop.names.set(name, (shop.names.get(name) ?? 0) + 1);
		shops.set(key, shop);
	}
	return [...shops]
		.map(([key, s]) => ({
			store: key ? [...s.names].sort((a, b) => b[1] - a[1])[0]![0] : NO_STORE,
			total: s.total,
			count: s.count,
			none: !key
		}))
		.filter((s) => s.total !== 0)
		.sort((a, b) => (a.none ? 1 : b.none ? -1 : b.total - a.total))
		.map(({ none: _, ...s }) => s);
}

/** `YYYY-MM` of a day. */
export const monthOf = (day: string) => day.slice(0, 7);

/** The month before or after `month` (`YYYY-MM`). */
export function addMonths(month: string, by: number) {
	const [y, m] = month.split('-').map(Number);
	const at = new Date(Date.UTC(y!, m! - 1 + by, 1));
	return at.toISOString().slice(0, 7);
}

/** How often a fixed one comes, in months. */
export const EVERY = {
	mes: { months: 1, label: 'mes', short: 'cada mes', by: 'al mes' },
	bimestre: { months: 2, label: 'bimestre', short: 'bim.', by: 'al bimestre' },
	trimestre: { months: 3, label: 'trimestre', short: 'trim.', by: 'al trimestre' },
	cuatrimestre: { months: 4, label: 'cuatrimestre', short: 'cuatr.', by: 'al cuatrimestre' },
	semestre: { months: 6, label: 'semestre', short: 'sem.', by: 'al semestre' },
	año: { months: 12, label: 'año', short: '', by: 'al año' }
} as const;
export type Every = keyof typeof EVERY;
export const isEvery = (v: unknown): v is Every => typeof v === 'string' && Object.hasOwn(EVERY, v);

/** When it falls due: its day, and its month if it is not every month's. */
export interface FixedWhen {
	day: number;
	month: number | null;
	every?: number | null;
}
export const everyOf = (r: Pick<FixedWhen, 'month' | 'every'>): Every =>
	r.month === null
		? 'mes'
		: ((Object.keys(EVERY) as Every[]).find((e) => EVERY[e].months === r.every) ?? 'año');

/** As it is kept: every `every`, one of its months being `month`. */
export const whenOf = (every: Every, month: number) =>
	every === 'mes'
		? { month: null, every: null }
		: every === 'año'
			? { month, every: null }
			: { month: ((month - 1) % EVERY[every].months) + 1, every: EVERY[every].months as number };

/** Its months of the year, 1 to 12, from January: [2, 5, 8, 11]. */
export function monthsOf(r: Pick<FixedWhen, 'month' | 'every'>) {
	const step = EVERY[everyOf(r)].months;
	const first = r.month === null ? 1 : ((r.month - 1) % step) + 1;
	return Array.from({ length: 12 / step }, (_, i) => first + i * step);
}

/** Whether it falls due in that month (`YYYY-MM`). */
const fallsIn = (r: FixedWhen, month: string) => monthsOf(r).includes(Number(month.slice(5, 7)));

/**
 * The month (`YYYY-MM`) a fixed one last fell due by `today` (`YYYY-MM-DD`), its day included:
 * the last of its months whose day has come.
 */
export function lastDue(r: FixedWhen, today: string) {
	const passed = (month: string) => `${month}-${String(r.day).padStart(2, '0')}` <= today;
	let month = monthOf(today);
	while (!fallsIn(r, month) || !passed(month)) month = addMonths(month, -1);
	return month;
}

/**
 * The months a fixed one is to be added in by `today`, after `lastMonth` (the last added; null,
 * none yet: from this month on): also the ones missed while nobody looked.
 */
export function dueMonths(r: FixedWhen, lastMonth: string | null, today: string) {
	const last = lastDue(r, today);
	const due: string[] = [];
	let month = lastMonth ? addMonths(lastMonth, 1) : monthOf(today);
	for (; month <= last; month = addMonths(month, 1)) if (fallsIn(r, month)) due.push(month);
	return due;
}

/** The next day a fixed one falls due from `today`, its day included; not a month already added. */
export function nextDue(r: FixedWhen, lastMonth: string | null, today: string) {
	const day = String(r.day).padStart(2, '0');
	for (let month = monthOf(today), i = 0; i < 14; month = addMonths(month, 1), i++) {
		if (!fallsIn(r, month)) continue;
		if (lastMonth !== null && month <= lastMonth) continue;
		if (`${month}-${day}` >= today) return `${month}-${day}`;
	}
	return null;
}

/** The later of two `YYYY-MM`. */
export const laterMonth = (a: string, b: string) => (a > b ? a : b);

/** «enero»…«diciembre», for the yearly fixed ones. */
export const MONTH_NAMES = Array.from({ length: 12 }, (_, i) =>
	new Date(Date.UTC(2026, i, 15)).toLocaleDateString('es-ES', { month: 'long', timeZone: 'UTC' })
);

/** «octubre de 2026». */
export function monthName(month: string) {
	const [y, m] = month.split('-').map(Number);
	return new Date(Date.UTC(y!, m! - 1, 15)).toLocaleDateString('es-ES', {
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC'
	});
}
