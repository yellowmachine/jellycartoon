import { addDays, mondayOf } from 'comun/agenda.ts';
import {
	addMonths,
	EXPENSE_CATEGORIES,
	lineKey,
	monthOf,
	type Expense,
	type ExpenseCategory
} from 'comun/expenses.ts';
import { priceAt, type KwhPrice } from '#lib/kwh-price.ts';

/**
 * Resumen: what there was in the last 7 days, always up to date, or in a week or a month already
 * over, beside the ones before. By rules, without the AI: figures, not advice.
 */

export const SUMMARY_VIEWS = {
	dias: 'Últimos 7 días',
	semana: 'Semanas',
	mes: 'Meses'
} as const;
export type SummaryView = keyof typeof SUMMARY_VIEWS;
export const isSummaryView = (v: unknown): v is SummaryView =>
	typeof v === 'string' && Object.hasOwn(SUMMARY_VIEWS, v);

/** What it may tell, and the section each comes from (nav.ts). */
export const SUMMARY_BLOCKS = {
	dinero: { label: 'Dinero', section: '/gastos' },
	compras: { label: 'Compras: lo que se repite y lo que sube', section: '/gastos' },
	fijos: { label: 'Fijos que vienen', section: '/gastos' },
	energia: { label: 'Energía de los enchufes', section: '/enchufes' },
	paseos: { label: 'Tus paseos', section: '/paseos' },
	agenda: { label: 'Agenda', section: '/agenda' }
} as const;
export type SummaryBlock = keyof typeof SUMMARY_BLOCKS;
export const isSummaryBlock = (v: unknown): v is SummaryBlock =>
	typeof v === 'string' && Object.hasOwn(SUMMARY_BLOCKS, v);

/** A person's (Ajustes → Para mí): the card on the home page, and the blocks they took out. */
export interface SummaryChoice {
	card: boolean;
	off: SummaryBlock[];
}
export const noSummaryChoice = (): SummaryChoice => ({ card: true, off: [] });

export interface SummaryPeriod {
	view: SummaryView;
	/** Its days, both included, and those of the one it is compared with. */
	from: string;
	to: string;
	prevFrom: string;
	prevTo: string;
	/** The first day of the one before and after it, to go there; null, there is none. */
	before: string | null;
	after: string | null;
	/** What is to come, told with the newest only: its last day. */
	until: string | null;
}

const monthEnd = (month: string) => addDays(`${addMonths(month, 1)}-01`, -1);

/** Of that view, the one `de` falls in; by default, or not over yet, the last one over. */
export function summaryPeriod(view: SummaryView, de: string | null, today: string): SummaryPeriod {
	if (view === 'dias') {
		const from = addDays(today, -6);
		return {
			view,
			from,
			to: today,
			prevFrom: addDays(from, -7),
			prevTo: addDays(from, -1),
			before: null,
			after: null,
			until: addDays(today, 7)
		};
	}
	if (view === 'semana') {
		const last = addDays(mondayOf(today), -7);
		const asked = de ? mondayOf(de) : last;
		const from = asked > last ? last : asked;
		return {
			view,
			from,
			to: addDays(from, 6),
			prevFrom: addDays(from, -7),
			prevTo: addDays(from, -1),
			before: addDays(from, -7),
			after: from < last ? addDays(from, 7) : null,
			until: from === last ? addDays(mondayOf(today), 6) : null
		};
	}
	const last = addMonths(monthOf(today), -1);
	const asked = de ? monthOf(de) : last;
	const month = asked > last ? last : asked;
	const prev = addMonths(month, -1);
	return {
		view,
		from: `${month}-01`,
		to: monthEnd(month),
		prevFrom: `${prev}-01`,
		prevTo: monthEnd(prev),
		before: `${prev}-01`,
		after: month < last ? `${addMonths(month, 1)}-01` : null,
		until: month === last ? monthEnd(monthOf(today)) : null
	};
}

export interface Money {
	/** Without the fixed ones. */
	total: number;
	count: number;
	/** The one before; null, nothing in it to compare with. */
	before: number | null;
	fixed: number;
	categories: { category: ExpenseCategory; total: number; before: number }[];
	/** The ones that changed most, at least by CHANGED. */
	up: { category: ExpenseCategory; by: number }[];
	down: { category: ExpenseCategory; by: number }[];
	largest: { id: number; date: string; store: string; total: number }[];
}
/** Cents: less, it is not told as a change. */
const CHANGED = 1000;
const LARGEST = 3;
/** With less before, no percentage: 20 €, 2 km. */
export const LEAST_MONEY = 2000;
export const LEAST_METRES = 2000;
const MOST_CHANGES = 2;

export function moneyOf(now: Expense[], before: Expense[]): Money | null {
	if (!now.length && !before.length) return null;
	// One added by a fixed one taken away since, too.
	const isFixed = (e: Expense) => e.fixed || e.source === 'fijo';
	const loose = (list: Expense[]) => list.filter((e) => !isFixed(e));
	const sum = (list: Expense[]) => list.reduce((s, e) => s + e.total, 0);
	const [mine, theirs] = [loose(now), loose(before)];
	const categories = EXPENSE_CATEGORIES.map((category) => {
		const of = (list: Expense[]) => sum(list.filter((e) => e.category === category));
		return { category, total: of(mine), before: of(theirs) };
	});
	const changes = theirs.length
		? categories
				.map((c) => ({ category: c.category, by: c.total - c.before }))
				.sort((a, b) => b.by - a.by)
		: [];
	return {
		total: sum(mine),
		count: mine.length,
		before: theirs.length ? sum(theirs) : null,
		fixed: sum(now.filter(isFixed)),
		categories: categories.filter((c) => c.total > 0).sort((a, b) => b.total - a.total),
		up: changes.filter((c) => c.by >= CHANGED).slice(0, MOST_CHANGES),
		down: changes
			.filter((c) => c.by <= -CHANGED)
			.reverse()
			.slice(0, MOST_CHANGES),
		largest: [...mine]
			.sort((a, b) => b.total - a.total)
			.slice(0, LARGEST)
			.map(({ id, date, store, total }) => ({ id, date, store, total }))
	};
}

/** Compras: the lines of what was bought, not of bills, bank payments or fixed ones. */
const isPurchase = (e: Expense) =>
	!e.fixed && !e.foreign && (e.source === 'ticket' || e.source === 'mano' || e.source === 'voz');

/** Looked back for a product's price before the period: half a year. */
export const PRICE_LOOK_BACK_DAYS = 183;
/** Told at most, of each. */
const MOST_PRODUCTS = 5;
/** Dearer, at least by both: 5 cents and 5 %. */
const DEARER_CENTS = 5;
const DEARER_PERCENT = 5;

export interface Shopping {
	/** Bought in two purchases or more, the most often first: with the spelling written most. */
	repeated: { text: string; times: number; total: number }[];
	/** Dearer than the last time in that same shop: cents of one (or of a kg), with its percentage. */
	dearer: {
		text: string;
		store: string;
		was: number;
		now: number;
		percent: number;
		/** Where it was bought dearer, to open it. */
		id: number;
		date: string;
	}[];
}

/** Of one (or of a kg): without a quantity, the line is one. */
const unitPrice = (amount: number, quantity: number | null) =>
	Math.round(amount / (quantity && quantity > 0 ? quantity : 1));

/**
 * What the family bought in the period by the receipts' lines (`now`), and its prices beside the
 * last ones before it (`earlier`, any order). Null, nothing to say.
 */
export function shoppingOf(now: Expense[], earlier: Expense[]): Shopping | null {
	const lines = (list: Expense[]) =>
		list
			.filter(isPurchase)
			.flatMap((e) =>
				e.lines
					.filter((l) => l.amount > 0 && lineKey(l.text))
					.map((l) => ({ e, l, key: lineKey(l.text) }))
			);
	const mine = lines(now);

	const products = new Map<
		string,
		{ ids: Set<number>; total: number; names: Map<string, number> }
	>();
	for (const { e, l, key } of mine) {
		const p = products.get(key) ?? { ids: new Set(), total: 0, names: new Map() };
		p.ids.add(e.id);
		p.total += l.amount;
		const name = l.text.replace(/\s+/g, ' ').trim();
		p.names.set(name, (p.names.get(name) ?? 0) + 1);
		products.set(key, p);
	}
	const spelling = (names: Map<string, number>) => [...names].sort((a, b) => b[1] - a[1])[0]![0];
	const repeated = [...products.values()]
		.filter((p) => p.ids.size > 1)
		.sort((a, b) => b.ids.size - a.ids.size || b.total - a.total)
		.slice(0, MOST_PRODUCTS)
		.map((p) => ({ text: spelling(p.names), times: p.ids.size, total: p.total }));

	// The same line in the same shop: another shop's price is not the same one going up.
	const where = (e: Expense, key: string) => `${lineKey(e.store)}\u0000${key}`;
	const newest = <T extends { e: Expense }>(list: T[]) => {
		const last = new Map<string, T & { key: string }>();
		for (const x of list as (T & { key: string })[]) {
			const at = where(x.e, x.key);
			const had = last.get(at);
			if (!had || x.e.date > had.e.date || (x.e.date === had.e.date && x.e.id > had.e.id))
				last.set(at, x);
		}
		return last;
	};
	const before = newest(lines(earlier));
	const dearer = [...newest(mine)]
		.flatMap(([at, x]) => {
			const old = before.get(at);
			if (!old) return [];
			const was = unitPrice(old.l.amount, old.l.quantity);
			const price = unitPrice(x.l.amount, x.l.quantity);
			const percent = Math.round(((price - was) / was) * 100);
			return price - was >= DEARER_CENTS && percent >= DEARER_PERCENT
				? [
						{
							text: x.l.text.replace(/\s+/g, ' ').trim(),
							store: x.e.store.trim(),
							was,
							now: price,
							percent,
							id: x.e.id,
							date: x.e.date
						}
					]
				: [];
		})
		.sort((a, b) => b.percent - a.percent)
		.slice(0, MOST_PRODUCTS);
	return repeated.length || dearer.length ? { repeated, dearer } : null;
}

/** Wh: with less before, no percentage. */
export const LEAST_WH = 1000;
const MOST_PLUGS = 3;

export interface EnergyHour {
	plugId: string;
	hour: Date;
	/** 0 when taken out («sin dato»). */
	wh: number;
	mark: string | null;
}

export interface Energy {
	wh: number;
	/** Null, no price of the kWh (neither written in Energía nor from a light bill). */
	cents: number | null;
	/** The one before, as far in; null, nothing in it. */
	before: { wh: number; cents: number | null } | null;
	/** The ones that used most. */
	plugs: { id: string; name: string; wh: number; cents: number | null }[];
	/** Hours taken out as wrong: they count as nothing. */
	noData: number;
}

/**
 * Energía (#396): what the family's plugs used from `start` to `end`, each hour at its price, beside
 * `prevStart`–`prevEnd`. Null, nothing in either.
 */
export function energyOf(
	rows: EnergyHour[],
	plugs: { id: string; name: string }[],
	price: KwhPrice | null,
	at: { start: Date; end: Date; prevStart: Date; prevEnd: Date }
): Energy | null {
	const names = new Map(plugs.map((p) => [p.id, p.name]));
	const now = { wh: 0, euros: 0 };
	const before = { wh: 0, euros: 0 };
	const byPlug = new Map<string, { wh: number; euros: number }>();
	let noData = 0;
	for (const r of rows) {
		if (!names.has(r.plugId)) continue;
		const euros = price ? (r.wh / 1000) * priceAt(price, r.hour) : 0;
		if (r.hour >= at.prevStart && r.hour < at.prevEnd) {
			before.wh += r.wh;
			before.euros += euros;
		}
		if (r.hour < at.start || r.hour >= at.end) continue;
		if (r.mark === 'sin_dato') noData++;
		now.wh += r.wh;
		now.euros += euros;
		const one = byPlug.get(r.plugId) ?? { wh: 0, euros: 0 };
		one.wh += r.wh;
		one.euros += euros;
		byPlug.set(r.plugId, one);
	}
	if (!now.wh && !before.wh && !noData) return null;
	const cents = (euros: number) => (price ? Math.round(euros * 100) : null);
	return {
		wh: now.wh,
		cents: cents(now.euros),
		before: before.wh ? { wh: before.wh, cents: cents(before.euros) } : null,
		plugs: [...byPlug]
			.filter(([, p]) => p.wh > 0)
			.sort((a, b) => b[1].wh - a[1].wh)
			.slice(0, MOST_PLUGS)
			.map(([id, p]) => ({ id, name: names.get(id)!, wh: p.wh, cents: cents(p.euros) })),
		noData
	};
}

/**
 * «−18 %», «+3 %», «igual»; null, when a percentage would say nothing: no one before, or so small
 * (`least`) that any change is a large one.
 */
export function changeText(now: number, before: number | null, least: number) {
	if (before === null || before < least) return null;
	const by = Math.round(((now - before) / before) * 100);
	if (by === 0) return 'igual';
	return `${by > 0 ? '+' : '−'}${Math.abs(by)} %`;
}

/** The home page's card: each thing in a few words. */
export function cardLines(s: {
	money: Pick<Money, 'total' | 'before'> | null;
	walks: { metres: number; before: { metres: number } } | null;
	next: { count: number } | null;
	/** How they are written here. */
	euros: (cents: number) => string;
	distance: (metres: number) => string;
}): { block: SummaryBlock; text: string }[] {
	const lines: { block: SummaryBlock; text: string }[] = [];
	const withChange = (text: string, change: string | null) =>
		change ? `${text} (${change})` : text;
	if (s.money)
		lines.push({
			block: 'dinero',
			text: withChange(
				s.euros(s.money.total),
				changeText(s.money.total, s.money.before, LEAST_MONEY)
			)
		});
	if (s.walks)
		lines.push({
			block: 'paseos',
			text: withChange(
				s.distance(s.walks.metres),
				changeText(s.walks.metres, s.walks.before.metres, LEAST_METRES)
			)
		});
	if (s.next?.count)
		lines.push({
			block: 'agenda',
			text: s.next.count === 1 ? '1 cita por venir' : `${s.next.count} citas por venir`
		});
	return lines;
}
