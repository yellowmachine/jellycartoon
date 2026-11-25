import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import { addDays, localDay } from 'comun/agenda.ts';
import { euros } from 'comun/expenses.ts';
import { expense, expenseLine, fuel, fuelEvent, fuelSpot, fuelUnit } from '../db/schema.ts';
import { searchExpenses } from '../expenses/expenses.ts';
import { familyPlace } from '../family-settings.ts';
import type { AnyDb } from '../family-scope.ts';
import { houseKitchen, type Kitchen } from '../fridge.ts';
import { tell } from '../inbox.ts';
import { familyAdults } from '../kids.ts';
import { heatingDegrees } from '../weather-read.ts';
import { nextDays, pastDays } from './forecast.ts';
import {
	FUEL_KINDS,
	fuelOutlook,
	guessedFuel,
	learnFuel,
	MIN_UNITS,
	wholeUnits,
	type FuelKind
} from '#lib/fuel.ts';
import { costIn, fuelSums, perDay, type FuelSums, type PaidExpense } from '#lib/fuel-cost.ts';
import { FORECAST_AHEAD, type Expected, type Fit } from '#lib/energy-forecast.ts';

/**
 * Butane and pellet (Energía → Previsión, #513 phase 2; #628): what is at home and how long it
 * lasts with the cold to come. Several can be going, each in its spot, which learns how long one
 * lasts there from the units put on; the full ones are for any. The purchases are offered from
 * Dinero's expenses that say «butano», «bombona» or «pellet», to take or not. Told to the adults
 * some days before one is missing.
 */

/** Days back the expenses are looked at, and the units learned from. */
const EXPENSE_DAYS = 120;
const LEARN_DAYS = 365;
/** Spots at most for a fuel. */
const MAX_SPOTS = 8;
/** Full ones at home, or bought at once, at most. */
const MAX_UNITS = 200;

export interface SpotState {
	id: number;
	name: string;
	heats: boolean;
	guessDays: number | null;
	/** The one going. */
	unit: { id: number; startedOn: string } | null;
	/** Units whole learned from. */
	learnedFrom: number;
	/** With what it reckons: learned, guessed (what the family said), or nothing yet. */
	by: 'aprendido' | 'dicho' | null;
	fit: Fit | null;
	/** Of the one going, what is left (0 to 1), and the day it runs out, if within the days. */
	left: number | null;
	ends: string | null;
	/** What those of the last year lasted and cost; null, none ended yet. */
	sums: FuelSums | null;
}

export interface FuelState {
	id: number;
	kind: FuelKind;
	startsOnBuy: boolean;
	alertDays: number;
	/** Full ones at home. */
	full: number;
	/** Nothing noted yet: what is at home is asked. */
	fresh: boolean;
	spots: SpotState[];
	/** Of the spots with one going and something to reckon with; null, none such. */
	outlook: { allEnds: string | null; needed: Expected; toBuy: number } | null;
	/** Cents one cost, of the last purchase whose price is known. */
	unitCost: number | null;
	/** Cents of the purchases of the last year whose price is known, and how many are not. */
	spent: { total: number; unpriced: number } | null;
	/** Names of those going that cannot be reckoned yet. */
	uncounted: string[];
	/** Expenses in Dinero that look like it, not yet taken nor left out. */
	pending: {
		id: number;
		date: string;
		store: string;
		total: string;
		/** Put on and with no purchase noted: this may be theirs. */
		units: { id: number; spot: string; startedOn: string }[];
	}[];
	history: {
		units: {
			id: number;
			spot: string;
			startedOn: string;
			endedOn: string | null;
			whole: boolean;
			/** The day it was bought, if known: it cannot be put on before. */
			boughtOn: string | null;
			/** Cents it cost, and a day of it; null, not known. */
			cost: number | null;
			perDay: number | null;
		}[];
		purchases: {
			id: number;
			day: string;
			quantity: number;
			fromExpense: boolean;
			/** Cents all of it cost; null, not known. */
			cost: number | null;
			/** It was written here, not what its expense says. */
			written: boolean;
		}[];
	};
}

/** What could not be done, as it is said to who asked. */
export class FuelProblem extends Error {}

type Purchase = typeof fuelEvent.$inferSelect;
type Unit = typeof fuelUnit.$inferSelect;

/** The full ones at home: bought and put right, less those put on from them. */
const fullOf = (events: Purchase[], units: Unit[]) =>
	Math.max(
		0,
		events
			.filter((e) => e.kind === 'compra' || e.kind === 'ajuste')
			.reduce((s, e) => s + e.quantity, 0) - units.filter((u) => u.fromStock).length
	);
/** What is left of a purchase. */
const remaining = (e: Purchase, units: Unit[]) =>
	e.quantity - units.filter((u) => u.purchaseId === e.id).length;

const spotLabel = (s: { name: string } | undefined, kind: FuelKind) =>
	s?.name || FUEL_KINDS[kind].name;

/** The expenses the purchases came from, by id; one in another currency, not in euros yet, is left out. */
async function paidExpenses(tx: AnyDb) {
	const ids = tx
		.select({ id: fuelEvent.expenseId })
		.from(fuelEvent)
		.where(and(eq(fuelEvent.kind, 'compra'), isNotNull(fuelEvent.expenseId)));
	const rows = await tx
		.select({
			id: expense.id,
			store: expense.store,
			total: expense.total,
			currency: expense.currency,
			rate: expense.rate
		})
		.from(expense)
		.where(inArray(expense.id, ids));
	const paid = new Map<number, PaidExpense>();
	for (const e of rows)
		if (!e.currency || e.rate !== null)
			paid.set(e.id, { store: e.store, total: e.total, lines: [] });
	if (!paid.size) return paid;
	const lines = await tx
		.select({ id: expenseLine.expenseId, text: expenseLine.text, amount: expenseLine.amount })
		.from(expenseLine)
		.where(inArray(expenseLine.expenseId, [...paid.keys()]));
	for (const l of lines) paid.get(l.id)!.lines.push({ text: l.text, amount: l.amount });
	return paid;
}

/** The family's fuels, each with what is at home and how long it lasts; empty, none. */
export async function fuelStates(k: Kitchen): Promise<FuelState[]> {
	const rows = await k.run(async (tx) => {
		const fuels = await tx.select().from(fuel).orderBy(asc(fuel.id));
		if (!fuels.length) return null;
		return {
			fuels,
			spots: await tx.select().from(fuelSpot).orderBy(asc(fuelSpot.id)),
			units: await tx.select().from(fuelUnit).orderBy(asc(fuelUnit.startedOn), asc(fuelUnit.id)),
			events: await tx.select().from(fuelEvent).orderBy(asc(fuelEvent.day), asc(fuelEvent.id)),
			paid: await paidExpenses(tx)
		};
	});
	if (!rows) return [];
	const today = localDay();
	const since = addDays(today, -LEARN_DAYS);
	const place = await familyPlace(k);
	const recent = (u: Unit) => u.startedOn >= since;

	// The weather of the days learned from and those going, and the next days'.
	const firstStart = rows.units.filter(recent)[0]?.startedOn;
	const degrees = new Map<string, number>();
	let ahead: { day: string; degrees: number }[] = [];
	if (place) {
		const [gone, coming] = await Promise.all([
			firstStart && firstStart < today
				? pastDays(place.lat, place.lon, firstStart, addDays(today, -1), today)
				: Promise.resolve([]),
			nextDays(place.lat, place.lon, today)
		]);
		for (const d of gone ?? []) degrees.set(d.day, heatingDegrees(d.mean));
		ahead = (coming ?? []).map((d) => ({ day: d.day, degrees: heatingDegrees(d.mean) }));
	}
	// Without the weather, what does not heat is reckoned all the same.
	const weather = ahead.length > 0;
	if (!weather)
		ahead = Array.from({ length: FORECAST_AHEAD }, (_, i) => ({
			day: addDays(today, i),
			degrees: 0
		}));

	const taken = new Set(rows.events.map((e) => e.expenseId).filter((id) => id !== null));
	return Promise.all(
		rows.fuels.map(async (f) => {
			const events = rows.events.filter((e) => e.fuelId === f.id);
			const units = rows.units.filter((u) => u.fuelId === f.id);
			const allSpots = rows.spots.filter((s) => s.fuelId === f.id);
			const label = (id: number) =>
				spotLabel(
					allSpots.find((s) => s.id === id),
					f.kind
				);
			const full = fullOf(events, units);
			const costOf = (e: Purchase): number | null => {
				if (e.total !== null) return e.total;
				const paid = e.expenseId === null ? undefined : rows.paid.get(e.expenseId);
				return paid ? costIn(paid, f.kind) : null;
			};
			const purchases = new Map(events.map((e) => [e.id, e]));
			const costed = units.map((u) => {
				const from = u.purchaseId ? purchases.get(u.purchaseId) : undefined;
				const all = from ? costOf(from) : null;
				return { ...u, cost: all === null ? null : all / from!.quantity };
			});
			const bought = events.filter((e) => e.kind === 'compra');
			const spots = allSpots
				.filter((s) => !s.archivedAt)
				.map((s): SpotState => {
					const mine = units.filter((u) => u.spotId === s.id && recent(u));
					const going = units.find((u) => u.spotId === s.id && !u.endedOn) ?? null;
					const learned = learnFuel(mine, degrees, s.heats);
					const fit = learned ?? (s.guessDays ? guessedFuel(s.guessDays, s.heats) : null);
					return {
						id: s.id,
						name: s.name,
						heats: s.heats,
						guessDays: s.guessDays,
						unit: going && { id: going.id, startedOn: going.startedOn },
						learnedFrom: wholeUnits(mine).length,
						by: learned ? 'aprendido' : fit ? 'dicho' : null,
						fit,
						left: null,
						ends: null,
						sums: fuelSums(costed.filter((u) => u.spotId === s.id && recent(u)))
					};
				});
			const counted = spots.filter((s) => s.unit && s.fit && (weather || !s.heats));
			const o = fuelOutlook(
				counted.map((s) => ({ fit: s.fit!, heats: s.heats, startedOn: s.unit!.startedOn })),
				full,
				degrees,
				ahead
			);
			counted.forEach((s, i) => Object.assign(s, o.spots[i]!));
			const loose = units.filter((u) => !u.purchaseId);
			const year = bought.filter((e) => e.day >= since);
			const prices = year.map(costOf);
			const known = prices.filter((c) => c !== null);
			const last = bought.findLast((e) => costOf(e) !== null);
			return {
				id: f.id,
				kind: f.kind,
				startsOnBuy: f.startsOnBuy,
				alertDays: f.alertDays,
				full,
				fresh: !units.length && !events.some((e) => e.kind === 'compra' || e.kind === 'ajuste'),
				spots,
				outlook: counted.length ? { allEnds: o.allEnds, needed: o.needed, toBuy: o.toBuy } : null,
				unitCost: last ? costOf(last)! / last.quantity : null,
				spent: known.length
					? { total: known.reduce((t, c) => t + c, 0), unpriced: prices.length - known.length }
					: null,
				uncounted: spots
					.filter((s) => s.unit && !counted.includes(s))
					.map((s) => spotLabel(s, f.kind)),
				pending: (await pendingExpenses(k, f.kind, taken, today)).map((e) => ({
					...e,
					units: loose
						.filter((u) => u.startedOn >= e.date)
						.map((u) => ({ id: u.id, spot: label(u.spotId), startedOn: u.startedOn }))
				})),
				history: {
					units: costed
						.map((u) => ({
							id: u.id,
							spot: label(u.spotId),
							startedOn: u.startedOn,
							endedOn: u.endedOn,
							whole: u.whole,
							boughtOn: (u.purchaseId && purchases.get(u.purchaseId)?.day) || null,
							cost: u.cost,
							perDay: perDay(u)
						}))
						.reverse(),
					purchases: bought
						.map((e) => ({
							id: e.id,
							day: e.day,
							quantity: e.quantity,
							fromExpense: e.expenseId !== null,
							cost: costOf(e),
							written: e.total !== null
						}))
						.reverse()
				}
			} satisfies FuelState;
		})
	);
}

/** Dinero's expenses of the last months that say it (shop or a line), not yet answered. */
async function pendingExpenses(k: Kitchen, kind: FuelKind, taken: Set<number>, today: string) {
	const found = new Map<number, Awaited<ReturnType<typeof searchExpenses>>[number]>();
	for (const word of FUEL_KINDS[kind].words)
		for (const e of await searchExpenses(
			k,
			{ text: word, from: addDays(today, -EXPENSE_DAYS), to: null },
			{ limit: 20 }
		))
			if (!taken.has(e.id)) found.set(e.id, e);
	return [...found.values()]
		.sort((a, b) => a.date.localeCompare(b.date))
		.map((e) => ({ id: e.id, date: e.date, store: e.store, total: euros(e.total) }));
}

/** A fuel's row, held until the transaction ends (pressed twice, one after the other), and its rest. */
async function held(tx: AnyDb, fuelId: number) {
	const [f] = await tx.select().from(fuel).where(eq(fuel.id, fuelId)).for('update');
	if (!f) throw new FuelProblem('Ya no está');
	const events = await tx
		.select()
		.from(fuelEvent)
		.where(eq(fuelEvent.fuelId, fuelId))
		.orderBy(asc(fuelEvent.day), asc(fuelEvent.id));
	const units = await tx
		.select()
		.from(fuelUnit)
		.where(eq(fuelUnit.fuelId, fuelId))
		.orderBy(asc(fuelUnit.startedOn));
	// Whatever is noted, the notice starts over.
	await tx.update(fuel).set({ notifiedFor: null }).where(eq(fuel.id, fuelId));
	return { f, events, units };
}

const dayText = (day: string) =>
	new Date(`${day}T12:00:00Z`).toLocaleDateString('es-ES', {
		day: 'numeric',
		month: 'long',
		timeZone: 'UTC'
	});
const days = (from: string, to: string) =>
	Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

function notAhead(day: string) {
	if (day > localDay()) throw new FuelProblem('Ese día aún no ha llegado');
}

/**
 * Butane or pellet, added to the family (once each), with its spot; what is at home already, if it
 * is said: the full ones, and since when the one going was put on.
 */
export async function addFuel(
	k: Kitchen,
	kind: FuelKind,
	home: { full?: number; startedOn?: string | null } = {}
) {
	await k.run(async (tx) => {
		const [f] = await tx
			.insert(fuel)
			.values({ familyId: k.familyId, kind, startsOnBuy: FUEL_KINDS[kind].startsOnBuy })
			.onConflictDoNothing()
			.returning();
		if (!f) return;
		const [s] = await tx
			.insert(fuelSpot)
			.values({ familyId: k.familyId, fuelId: f.id })
			.returning();
		const full = Math.min(Math.max(Math.round(home.full ?? 0), 0), MAX_UNITS);
		if (full)
			await tx.insert(fuelEvent).values({
				familyId: k.familyId,
				fuelId: f.id,
				kind: 'ajuste',
				day: localDay(),
				quantity: full
			});
		if (home.startedOn) {
			notAhead(home.startedOn);
			await tx.insert(fuelUnit).values({
				familyId: k.familyId,
				fuelId: f.id,
				spotId: s!.id,
				startedOn: home.startedOn,
				fromStock: false
			});
		}
	});
}

export async function removeFuel(k: Kitchen, id: number) {
	await k.run((tx) => tx.delete(fuel).where(eq(fuel.id, id)));
}

export async function saveFuel(
	k: Kitchen,
	id: number,
	set: { startsOnBuy: boolean; alertDays: number; full: number | null }
) {
	await k.run(async (tx) => {
		const { events, units } = await held(tx, id);
		await tx
			.update(fuel)
			.set({
				startsOnBuy: set.startsOnBuy,
				alertDays: Math.min(Math.max(Math.round(set.alertDays), 1), 14)
			})
			.where(eq(fuel.id, id));
		if (set.full === null) return;
		const full = Math.min(Math.max(Math.round(set.full), 0), MAX_UNITS);
		const now = fullOf(events, units);
		if (full !== now)
			await tx.insert(fuelEvent).values({
				familyId: k.familyId,
				fuelId: id,
				kind: 'ajuste',
				day: localDay(),
				quantity: full - now
			});
	});
}

const spotName = (name: string) => name.trim().slice(0, 30);
const sameName = (a: string, b: string) => a.localeCompare(b, 'es', { sensitivity: 'base' }) === 0;

/** One more spot; one put away with that name, back with what it learned. */
export async function addSpot(k: Kitchen, fuelId: number, name: string) {
	await k.run(async (tx) => {
		await held(tx, fuelId);
		const clean = spotName(name);
		if (!clean) throw new FuelProblem('Ponle un nombre');
		const spots = await tx.select().from(fuelSpot).where(eq(fuelSpot.fuelId, fuelId));
		const active = spots.filter((s) => !s.archivedAt);
		if (active.some((s) => sameName(s.name, clean)))
			throw new FuelProblem(`Ya hay uno que se llama ${clean}`);
		if (active.some((s) => !s.name)) throw new FuelProblem('Pon antes nombre al que ya hay');
		if (active.length >= MAX_SPOTS) throw new FuelProblem('No caben más');
		const away = spots.find((s) => s.archivedAt && sameName(s.name, clean));
		if (away) await tx.update(fuelSpot).set({ archivedAt: null }).where(eq(fuelSpot.id, away.id));
		else await tx.insert(fuelSpot).values({ familyId: k.familyId, fuelId, name: clean });
	});
}

export async function saveSpot(
	k: Kitchen,
	id: number,
	set: { name: string; heats: boolean; guessDays: number | null }
) {
	await k.run(async (tx) => {
		const [s] = await tx.select().from(fuelSpot).where(eq(fuelSpot.id, id));
		if (!s) throw new FuelProblem('Ya no está');
		await held(tx, s.fuelId);
		const name = spotName(set.name);
		const others = await tx.select().from(fuelSpot).where(eq(fuelSpot.fuelId, s.fuelId));
		const rest = others.filter((o) => o.id !== id && !o.archivedAt);
		if (rest.length && !name) throw new FuelProblem('Ponle un nombre');
		if (rest.some((o) => sameName(o.name, name)))
			throw new FuelProblem(`Ya hay uno que se llama ${name}`);
		await tx
			.update(fuelSpot)
			.set({
				name,
				heats: set.heats,
				guessDays:
					set.guessDays && set.guessDays > 0 ? Math.min(Math.round(set.guessDays), 200) : null
			})
			.where(eq(fuelSpot.id, id));
	});
}

/** Put away: the one going, taken away today, perhaps half full (nothing learned from it). */
export async function archiveSpot(k: Kitchen, id: number) {
	await k.run(async (tx) => {
		const [s] = await tx.select().from(fuelSpot).where(eq(fuelSpot.id, id));
		if (!s) throw new FuelProblem('Ya no está');
		const { units } = await held(tx, s.fuelId);
		const others = await tx.select().from(fuelSpot).where(eq(fuelSpot.fuelId, s.fuelId));
		if (!others.some((o) => o.id !== id && !o.archivedAt))
			throw new FuelProblem('Es el único que hay');
		const going = units.find((u) => u.spotId === id && !u.endedOn);
		if (going)
			await tx
				.update(fuelUnit)
				.set({ endedOn: localDay(), whole: false })
				.where(eq(fuelUnit.id, going.id));
		await tx.update(fuelSpot).set({ archivedAt: new Date() }).where(eq(fuelSpot.id, id));
	});
}

/** What «Deshacer» needs to leave things as they were. */
export interface FuelUndo {
	fuelId: number;
	/** The unit put on, to take away, and the one before it, with the end it had. */
	started?: number;
	before?: { id: number; endedOn: string | null };
	/** The one ended, to go on. */
	ended?: number;
	/** The purchase (or the expense left out), to take away. */
	event?: number;
}

/** What was done, as it is said, and how to undo it. */
export interface FuelDone {
	text: string;
	undo: FuelUndo;
}

/** Where a unit put on that day comes from: a purchase, the full ones put right, or neither. */
function sourceFor(events: Purchase[], units: Unit[], day: string) {
	if (!fullOf(events, units)) return { fromStock: false, purchaseId: null };
	const left = events.filter((e) => e.kind === 'compra' && remaining(e, units) > 0);
	const mine = left.find((e) => e.day <= day);
	if (mine) return { fromStock: true, purchaseId: mine.id };
	const put =
		events.filter((e) => e.kind === 'ajuste').reduce((s, e) => s + e.quantity, 0) -
		units.filter((u) => u.fromStock && !u.purchaseId).length;
	if (put > 0 || !left.length) return { fromStock: true, purchaseId: null };
	throw new FuelProblem(
		`La que hay en casa se compró el ${dayText(left[0]!.day)}: no puede empezar antes`
	);
}

/** One put on in a spot: the one going there that day ends, and it lasts until the next one, if any. */
async function putOn(
	tx: AnyDb,
	familyId: string,
	{ f, events, units }: Awaited<ReturnType<typeof held>>,
	spotId: number,
	day: string,
	purchase?: Purchase
) {
	notAhead(day);
	const [spot] = await tx
		.select()
		.from(fuelSpot)
		.where(and(eq(fuelSpot.id, spotId), eq(fuelSpot.fuelId, f.id)));
	if (!spot) throw new FuelProblem('Ya no está');
	const meta = FUEL_KINDS[f.kind];
	const mine = units.filter((u) => u.spotId === spotId);
	if (mine.some((u) => u.startedOn === day))
		throw new FuelProblem(`Ya estaba apuntada: ${meta.unit} empezada el ${dayText(day)}`);
	const source = purchase
		? { fromStock: true, purchaseId: purchase.id }
		: sourceFor(events, units, day);
	const before = mine.find((u) => u.startedOn < day && (!u.endedOn || u.endedOn > day));
	const next = mine.find((u) => u.startedOn > day);
	if (before) await tx.update(fuelUnit).set({ endedOn: day }).where(eq(fuelUnit.id, before.id));
	const [unit] = await tx
		.insert(fuelUnit)
		.values({
			familyId,
			fuelId: f.id,
			spotId,
			startedOn: day,
			endedOn: next?.startedOn ?? null,
			...source
		})
		.returning();
	const one = f.kind === 'butano' ? 'Bombona empezada' : 'Saco empezado';
	const where = spot.name ? ` en ${spot.name}` : '';
	const when = day === localDay() ? ' hoy' : ` el ${dayText(day)}`;
	const lasted = before ? days(before.startedOn, day) : 0;
	return {
		unit: unit!,
		before: before && { id: before.id, endedOn: before.endedOn },
		text: `${one}${where}${when}${before ? `; ${f.kind === 'butano' ? 'la anterior' : 'el anterior'} duró ${lasted} ${lasted === 1 ? 'día' : 'días'}` : ''}.`
	};
}

export function startedFuel(
	k: Kitchen,
	fuelId: number,
	spotId: number,
	day: string
): Promise<FuelDone> {
	return k.run(async (tx) => {
		const now = await held(tx, fuelId);
		const { unit, before, text } = await putOn(tx, k.familyId, now, spotId, day);
		return { text, undo: { fuelId, started: unit.id, before } };
	});
}

/** The one going in a spot, run out on `day` and none put on yet: the days without it do not count. */
export function endedFuel(k: Kitchen, unitId: number, day: string): Promise<FuelDone> {
	return k.run(async (tx) => {
		const [u] = await tx.select().from(fuelUnit).where(eq(fuelUnit.id, unitId));
		if (!u) throw new FuelProblem('Ya no está');
		await held(tx, u.fuelId);
		notAhead(day);
		if (u.endedOn) throw new FuelProblem('Ya estaba acabada');
		if (day < u.startedOn)
			throw new FuelProblem(`Empezó el ${dayText(u.startedOn)}: no pudo acabarse antes`);
		await tx.update(fuelUnit).set({ endedOn: day }).where(eq(fuelUnit.id, unitId));
		const n = days(u.startedOn, day);
		return {
			text: `Apuntado que se acabó${day === localDay() ? ' hoy' : ` el ${dayText(day)}`}; duró ${n} ${n === 1 ? 'día' : 'días'}.`,
			undo: { fuelId: u.fuelId, ended: unitId }
		};
	});
}

/** What becomes of what is bought: put on in a spot, what was already put on without it, or kept full. */
export type BoughtFor = { spotId: number } | { unitId: number } | null;

/**
 * `quantity` bought on `day`, from an expense or not. With `quantity` 0, that expense is not of it:
 * not asked about again.
 */
export function boughtFuel(
	k: Kitchen,
	fuelId: number,
	day: string,
	quantity: number,
	{
		expenseId = null,
		use = null,
		total = null
	}: { expenseId?: number | null; use?: BoughtFor; total?: number | null } = {}
): Promise<FuelDone | null> {
	return k.run(async (tx) => {
		const now = await held(tx, fuelId);
		notAhead(day);
		if (expenseId !== null) {
			const [already] = await tx
				.select({ id: fuelEvent.id })
				.from(fuelEvent)
				.where(eq(fuelEvent.expenseId, expenseId));
			if (already) return null;
		}
		const out = quantity <= 0;
		const n = Math.min(Math.round(quantity), 50);
		const [bought] = await tx
			.insert(fuelEvent)
			.values({
				familyId: k.familyId,
				fuelId,
				kind: out ? 'descartada' : 'compra',
				day,
				quantity: out ? 0 : n,
				total: out ? null : total,
				expenseId
			})
			.returning();
		const undo: FuelUndo = { fuelId, event: bought!.id };
		if (out) return { text: 'Ese gasto no se cuenta.', undo };
		const meta = FUEL_KINDS[now.f.kind];
		const text = `${n === 1 ? `1 ${meta.unit}` : `${n} ${meta.units}`}, del ${dayText(day)}.`;
		if (use && 'unitId' in use) {
			const u = now.units.find((x) => x.id === use.unitId && !x.purchaseId);
			if (!u) throw new FuelProblem('Esa ya tiene su compra');
			if (u.startedOn < day)
				throw new FuelProblem(`Empezó el ${dayText(u.startedOn)}, antes de comprarla`);
			await tx
				.update(fuelUnit)
				.set({ purchaseId: bought!.id, fromStock: true })
				.where(eq(fuelUnit.id, u.id));
			return { text: `Apuntado: ${text} Es la empezada el ${dayText(u.startedOn)}.`, undo };
		}
		if (use) {
			const put = await putOn(tx, k.familyId, now, use.spotId, day, bought!);
			return {
				text: `Apuntado: ${text} ${put.text}`,
				undo: { ...undo, started: put.unit.id, before: put.before }
			};
		}
		return { text: `Apuntado: ${text}`, undo };
	});
}

/** A unit taken away: the one before it, if it ended that day, goes on until this one's end. */
async function takeAway(tx: AnyDb, units: Unit[], u: Unit, before?: FuelUndo['before']) {
	await tx.delete(fuelUnit).where(eq(fuelUnit.id, u.id));
	const prev = before
		? units.find((x) => x.id === before.id && x.spotId === u.spotId)
		: units.find((x) => x.spotId === u.spotId && x.id !== u.id && x.endedOn === u.startedOn);
	if (!prev) return;
	// Only where it does not run into another one, put on since.
	const next = units.find(
		(x) => x.spotId === u.spotId && x.id !== u.id && x.startedOn > prev.startedOn
	);
	const end = before ? before.endedOn : u.endedOn;
	const safe = next && (!end || end > next.startedOn) ? next.startedOn : end;
	await tx.update(fuelUnit).set({ endedOn: safe }).where(eq(fuelUnit.id, prev.id));
}

/** A purchase (or an expense left out) taken away: what was put on from it stays, without it. */
async function forget(tx: AnyDb, fuelId: number, eventId: number) {
	const own = and(eq(fuelUnit.fuelId, fuelId), eq(fuelUnit.purchaseId, eventId));
	await tx.update(fuelUnit).set({ purchaseId: null, fromStock: false }).where(own);
	await tx
		.delete(fuelEvent)
		.where(
			and(
				eq(fuelEvent.id, eventId),
				eq(fuelEvent.fuelId, fuelId),
				inArray(fuelEvent.kind, ['compra', 'descartada'])
			)
		);
}

export async function undoFuel(k: Kitchen, undo: FuelUndo) {
	await k.run(async (tx) => {
		const { units } = await held(tx, undo.fuelId);
		if (undo.started) {
			const u = units.find((x) => x.id === undo.started);
			if (u) await takeAway(tx, units, u, undo.before);
		}
		if (undo.ended) {
			const u = units.find((x) => x.id === undo.ended);
			if (u && units.some((x) => x.spotId === u.spotId && x.startedOn > u.startedOn))
				throw new FuelProblem('Ya hay otra empezada después: corrígelo en el historial');
			if (u) await tx.update(fuelUnit).set({ endedOn: null }).where(eq(fuelUnit.id, u.id));
		}
		if (undo.event) await forget(tx, undo.fuelId, undo.event);
	});
}

/** A unit's days put right. Never before its purchase, nor over another one of its spot. */
export async function editUnit(
	k: Kitchen,
	id: number,
	set: { startedOn: string; endedOn: string | null; whole: boolean }
) {
	await k.run(async (tx) => {
		const [found] = await tx.select().from(fuelUnit).where(eq(fuelUnit.id, id));
		if (!found) throw new FuelProblem('Ya no está');
		const { events, units } = await held(tx, found.fuelId);
		const { startedOn, endedOn, whole } = set;
		notAhead(startedOn);
		if (endedOn) notAhead(endedOn);
		if (endedOn && endedOn < startedOn) throw new FuelProblem('Se acaba antes de empezar');
		const bought = events.find((e) => e.id === found.purchaseId);
		if (bought && startedOn < bought.day)
			throw new FuelProblem(`Se compró el ${dayText(bought.day)}: no puede empezar antes`);
		for (const o of units.filter((x) => x.spotId === found.spotId && x.id !== id)) {
			if (o.startedOn === startedOn)
				throw new FuelProblem(`Ya hay una empezada el ${dayText(startedOn)}`);
			if ((!o.endedOn || startedOn < o.endedOn) && (!endedOn || o.startedOn < endedOn))
				throw new FuelProblem(
					`Se pisa con la empezada el ${dayText(o.startedOn)}: corrige antes esa`
				);
		}
		const archived = await tx
			.select({ at: fuelSpot.archivedAt })
			.from(fuelSpot)
			.where(eq(fuelSpot.id, found.spotId));
		if (!endedOn && archived[0]?.at) throw new FuelProblem('Ese puesto está quitado');
		await tx.update(fuelUnit).set({ startedOn, endedOn, whole }).where(eq(fuelUnit.id, id));
	});
}

export async function removeUnit(k: Kitchen, id: number) {
	await k.run(async (tx) => {
		const [u] = await tx.select().from(fuelUnit).where(eq(fuelUnit.id, id));
		if (!u) return;
		const { units } = await held(tx, u.fuelId);
		await takeAway(tx, units, u);
	});
}

/** A purchase put right: never after what was put on from it, nor fewer than those. */
export async function editPurchase(
	k: Kitchen,
	id: number,
	set: { day: string; quantity: number; total: number | null }
) {
	await k.run(async (tx) => {
		const [found] = await tx.select().from(fuelEvent).where(eq(fuelEvent.id, id));
		if (!found || found.kind !== 'compra') throw new FuelProblem('Ya no está');
		const { units } = await held(tx, found.fuelId);
		notAhead(set.day);
		const own = units.filter((u) => u.purchaseId === id);
		const first = own[0];
		if (first && first.startedOn < set.day)
			throw new FuelProblem(
				`De esa compra se empezó una el ${dayText(first.startedOn)}: no pudo comprarse después`
			);
		if (set.quantity < Math.max(1, own.length))
			throw new FuelProblem(`De esa compra se han empezado ${own.length}`);
		await tx
			.update(fuelEvent)
			.set({
				day: set.day,
				quantity: Math.min(Math.round(set.quantity), 50),
				total: set.total
			})
			.where(eq(fuelEvent.id, id));
	});
}

export async function removePurchase(k: Kitchen, id: number) {
	await k.run(async (tx) => {
		const [found] = await tx.select().from(fuelEvent).where(eq(fuelEvent.id, id));
		if (!found || found.kind !== 'compra') return;
		await held(tx, found.fuelId);
		await forget(tx, found.fuelId, id);
	});
}

const dayName = (day: string) =>
	new Date(`${day}T12:00:00Z`).toLocaleDateString('es-ES', {
		weekday: 'long',
		day: 'numeric',
		timeZone: 'UTC'
	});

/**
 * Once a day (scheduler.ts): each fuel that runs out within its days, told to the adults; again
 * only if the day comes sooner than the one told.
 */
export async function fuelAlerts(familyId: string) {
	const k = houseKitchen(familyId);
	const today = localDay();
	for (const f of await fuelStates(k)) {
		const ends = f.outlook?.allEnds;
		if (!ends || ends > addDays(today, f.alertDays)) continue;
		const [row] = await k.run((tx) =>
			tx.select({ notifiedFor: fuel.notifiedFor }).from(fuel).where(eq(fuel.id, f.id))
		);
		if (row?.notifiedFor && row.notifiedFor <= ends) continue;
		const meta = FUEL_KINDS[f.kind];
		const when = ends <= today ? 'hoy' : `el ${dayName(ends)}`;
		await tell(
			familyId,
			(await familyAdults(k)).map((a) => a.id),
			{
				kind: 'energia',
				title: `${meta.name}: se acaba ${when}`,
				body:
					f.kind === 'butano' && f.startsOnBuy && f.spots.length === 1
						? `Con el frío que viene, la ${meta.unit} de ahora llega hasta ${when}. Llama al repartidor.`
						: `Con el frío que viene, lo que hay en casa llega hasta ${when}: compra ${meta.units}.`,
				tag: `energia-${f.id}`,
				url: '/enchufes/prevision',
				ttl: 24 * 3600
			}
		);
		await k.run((tx) => tx.update(fuel).set({ notifiedFor: ends }).where(eq(fuel.id, f.id)));
	}
}

export { MIN_UNITS };
