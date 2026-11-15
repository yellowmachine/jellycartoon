import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { addDays, localDay } from 'comun/agenda.ts';
import { euros } from 'comun/expenses.ts';
import { fuel, fuelEvent } from '../db/schema.ts';
import { searchExpenses } from '../expenses/expenses.ts';
import { familyPlace } from '../family-settings.ts';
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
	type FuelKind,
	type FuelOutlook
} from '#lib/fuel.ts';
import type { Fit } from '#lib/energy-forecast.ts';

/**
 * Butane and pellet (Energía → Previsión, #513 phase 2): what is at home and how long it lasts
 * with the cold to come. Learned from the units started (with «put on when bought», each purchase
 * starts one: a purchase in Dinero is enough); the purchases are offered from Dinero's expenses
 * that say «butano», «bombona» or «pellet», to take or not. Told to the adults some days before it
 * runs out.
 */

/** Days back the expenses are looked at, and the units learned from. */
const EXPENSE_DAYS = 120;
const LEARN_DAYS = 365;

export interface FuelState {
	id: number;
	kind: FuelKind;
	startsOnBuy: boolean;
	alertDays: number;
	guessDays: number | null;
	/** The one going: the day it was started. */
	startedOn: string | null;
	/** Full ones at home. */
	full: number;
	/** Units whole learned from (one started until the next). */
	learnedFrom: number;
	/** With what it reckons: learned, guessed (what the family said), or nothing yet. */
	by: 'aprendido' | 'dicho' | null;
	fit: Fit | null;
	outlook: FuelOutlook | null;
	/** Expenses in Dinero that look like it, not yet taken nor left out. */
	pending: { id: number; date: string; store: string; total: string }[];
}

/** The family's fuels, each with what is at home and how long it lasts; empty, none. */
export async function fuelStates(k: Kitchen): Promise<FuelState[]> {
	const fuels = await k.run((tx) => tx.select().from(fuel).orderBy(asc(fuel.id)));
	if (!fuels.length) return [];
	const today = localDay();
	const [events, place] = await Promise.all([
		k.run((tx) => tx.select().from(fuelEvent).orderBy(asc(fuelEvent.day), asc(fuelEvent.id))),
		familyPlace(k)
	]);
	const starts = (id: number) =>
		events
			.filter(
				(e) => e.fuelId === id && e.kind === 'empezada' && e.day >= addDays(today, -LEARN_DAYS)
			)
			.map((e) => e.day);
	const firstStart = events
		.filter((e) => e.kind === 'empezada' && e.day >= addDays(today, -LEARN_DAYS))
		.map((e) => e.day)
		.sort()[0];

	// The weather of the days learned from and the one going, and the next days'.
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

	const taken = new Set(events.map((e) => e.expenseId).filter((id) => id !== null));
	return Promise.all(
		fuels.map(async (f) => {
			const mine = events.filter((e) => e.fuelId === f.id);
			const started = mine.filter((e) => e.kind === 'empezada');
			const bought = mine.filter((e) => e.kind === 'compra').reduce((s, e) => s + e.quantity, 0);
			const used = started.reduce((s, e) => s + e.quantity, 0);
			const learned = learnFuel(starts(f.id), degrees);
			const fit = learned ?? (f.guessDays ? guessedFuel(f.guessDays) : null);
			const startedOn = started.at(-1)?.day ?? null;
			const full = Math.max(0, bought - used);
			return {
				id: f.id,
				kind: f.kind,
				startsOnBuy: f.startsOnBuy,
				alertDays: f.alertDays,
				guessDays: f.guessDays,
				startedOn,
				full,
				learnedFrom: Math.max(0, new Set(starts(f.id)).size - 1),
				by: learned ? 'aprendido' : fit ? 'dicho' : null,
				fit,
				outlook: fit && ahead.length ? fuelOutlook(fit, startedOn, full, degrees, ahead) : null,
				pending: await pendingExpenses(k, f.kind, taken, today)
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

/** Butane or pellet, added to the family (once each). */
export async function addFuel(k: Kitchen, kind: FuelKind) {
	await k.run((tx) =>
		tx
			.insert(fuel)
			.values({ familyId: k.familyId, kind, startsOnBuy: FUEL_KINDS[kind].startsOnBuy })
			.onConflictDoNothing()
	);
}

export async function removeFuel(k: Kitchen, id: number) {
	await k.run((tx) => tx.delete(fuel).where(eq(fuel.id, id)));
}

export async function saveFuel(
	k: Kitchen,
	id: number,
	set: { startsOnBuy: boolean; alertDays: number; guessDays: number | null }
) {
	await k.run((tx) =>
		tx
			.update(fuel)
			.set({
				startsOnBuy: set.startsOnBuy,
				alertDays: Math.min(Math.max(Math.round(set.alertDays), 1), 14),
				guessDays:
					set.guessDays && set.guessDays > 0 ? Math.min(Math.round(set.guessDays), 120) : null,
				notifiedFor: null
			})
			.where(eq(fuel.id, id))
	);
}

/** One started on `day`. */
export async function startedFuel(k: Kitchen, id: number, day: string) {
	await k.run(async (tx) => {
		const [f] = await tx.select({ id: fuel.id }).from(fuel).where(eq(fuel.id, id));
		if (!f) return;
		await tx.insert(fuelEvent).values({ familyId: k.familyId, fuelId: id, kind: 'empezada', day });
		await tx.update(fuel).set({ notifiedFor: null }).where(eq(fuel.id, id));
	});
}

/**
 * `quantity` bought on `day`, from an expense or not; put on at once if it is so, the one going
 * swapped for it. With `quantity` 0, that expense is not of it: not asked about again.
 */
export async function boughtFuel(
	k: Kitchen,
	id: number,
	day: string,
	quantity: number,
	expenseId: number | null = null
) {
	await k.run(async (tx) => {
		const [f] = await tx.select().from(fuel).where(eq(fuel.id, id));
		if (!f) return;
		if (expenseId !== null) {
			const [already] = await tx
				.select({ id: fuelEvent.id })
				.from(fuelEvent)
				.where(and(eq(fuelEvent.expenseId, expenseId), isNotNull(fuelEvent.expenseId)));
			if (already) return;
		}
		if (quantity <= 0) {
			await tx.insert(fuelEvent).values({
				familyId: k.familyId,
				fuelId: id,
				kind: 'descartada',
				day,
				quantity: 0,
				expenseId
			});
			return;
		}
		const n = Math.min(Math.round(quantity), 50);
		await tx
			.insert(fuelEvent)
			.values({ familyId: k.familyId, fuelId: id, kind: 'compra', day, quantity: n, expenseId });
		if (f.startsOnBuy)
			await tx
				.insert(fuelEvent)
				.values({ familyId: k.familyId, fuelId: id, kind: 'empezada', day });
		await tx.update(fuel).set({ notifiedFor: null }).where(eq(fuel.id, id));
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
					f.kind === 'butano' && f.startsOnBuy
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
