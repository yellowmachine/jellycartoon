import { and, eq, gt, gte, inArray, isNull, sql } from 'drizzle-orm';
import { addDays, daysBetween, mondayOf } from 'comun/agenda.ts';
import { lineKey, LINE_TAGS } from 'comun/expenses.ts';
import {
	expense,
	expenseLine,
	familyMember,
	familyPerson,
	foodEstimate,
	walk
} from '#lib/server/db/schema.ts';
import type { AnyDb } from '#lib/server/family-scope.ts';
import { openRouterKey } from '#lib/server/family-settings.ts';
import { dayOf, houseKitchen, type Kitchen } from '#lib/server/fridge.ts';
import { completeJson } from '#lib/server/openrouter.ts';
import {
	isFoodTag,
	lineKcal,
	peopleWeight,
	type FoodEstimate,
	type People
} from '#lib/calories.ts';
import {
	CALORIES_SCHEMA,
	caloriesPrompt,
	estimatesFromAnswer,
	type ProductAsked
} from './calories-parse.ts';

/**
 * Calorías (#562): each product of the receipts estimated once by the AI (food_estimate, by its
 * text as lineKey leaves it), and the family's kcal bought by week and person, beside one's own
 * walks. The products not yet estimated, by themselves: when the page is opened, and after each
 * receipt once the family has used it.
 */

/** Only the lines of what was bought: not a bill's parts, a fixed one's or a bank's payment. */
const SOURCES = ['ticket', 'mano', 'voz'] as const;

interface FoodLine {
	text: string;
	quantity: number | null;
	amount: number;
	tag: string;
	date: string;
}

/** The lines that may be food, from `since` (a day) on, or all. */
async function foodLines(tx: AnyDb, since: string | null): Promise<FoodLine[]> {
	const rows = await tx
		.select({
			text: expenseLine.text,
			quantity: expenseLine.quantity,
			amount: expenseLine.amount,
			tag: expenseLine.tag,
			date: expense.date
		})
		.from(expenseLine)
		.innerJoin(
			expense,
			and(eq(expense.familyId, expenseLine.familyId), eq(expense.id, expenseLine.expenseId))
		)
		.where(
			and(
				inArray(expense.source, [...SOURCES]),
				gt(expenseLine.amount, 0),
				since ? gte(expense.date, since) : undefined
			)
		);
	return rows.filter((l) => isFoodTag(l.tag) && lineKey(l.text));
}

async function estimatesOf(tx: AnyDb) {
	const rows = await tx.select().from(foodEstimate);
	return new Map(rows.map((r) => [r.text, r]));
}

/** At most, the lines of a product shown to the AI. */
const EXAMPLES = 3;

/** The products with no estimate, the most bought first. */
export const pendingProducts = (k: Kitchen): Promise<ProductAsked[]> =>
	k.run(async (tx) => {
		const [lines, estimates] = await Promise.all([foodLines(tx, null), estimatesOf(tx)]);
		const byKey = new Map<string, ProductAsked & { count: number }>();
		for (const l of lines) {
			const key = lineKey(l.text);
			if (estimates.has(key)) continue;
			const p = byKey.get(key) ?? {
				key,
				text: l.text.replace(/\s+/g, ' ').trim(),
				examples: [],
				count: 0
			};
			p.count++;
			if (p.examples.length < EXAMPLES) p.examples.push({ quantity: l.quantity, amount: l.amount });
			byKey.set(key, p);
		}
		return [...byKey.values()].sort((a, b) => b.count - a.count).map(({ count: _, ...p }) => p);
	});

/** Products in one request, and requests in one go: the rest, the next time. */
const BATCH = 40;
const MAX_BATCHES = 10;

/** The families estimating now, and why the last time stopped, if it failed. */
const running = new Set<string>();
const lastProblem = new Map<string, string>();

export const isEstimating = (familyId: string) => running.has(familyId);
export const estimateProblem = (familyId: string) => lastProblem.get(familyId) ?? null;

/**
 * The products with no estimate, estimated by the AI with the family's key, a batch at a time; one
 * at a time per family. Never in the way: a failure is noted for the page and stops it.
 */
export function estimateMissing(familyId: string): Promise<void> {
	if (running.has(familyId)) return Promise.resolve();
	running.add(familyId);
	return (async () => {
		const k = houseKitchen(familyId);
		try {
			const apiKey = await openRouterKey(k);
			if (!apiKey) {
				lastProblem.set(
					familyId,
					'Para estimarlas hace falta la clave de OpenRouter (Ajustes → IA)'
				);
				return;
			}
			const pending = (await pendingProducts(k)).slice(0, BATCH * MAX_BATCHES);
			for (let i = 0; i < pending.length; i += BATCH) {
				const batch = pending.slice(i, i + BATCH);
				const answer = await completeJson<unknown>({
					apiKey,
					label: `Calorías de la compra (${batch.length} productos)`,
					system: 'Estimas qué son los productos de tickets de compra y sus calorías.',
					prompt: caloriesPrompt(batch),
					name: 'calorias',
					schema: CALORIES_SCHEMA,
					timeoutMs: 120_000,
					maxTokens: 4_096
				});
				const found = estimatesFromAnswer(batch, answer);
				if (found.size)
					await k.run((tx) =>
						tx
							.insert(foodEstimate)
							.values([...found].map(([text, e]) => ({ familyId, text, ...e })))
							// One corrected by hand meanwhile stays.
							.onConflictDoNothing()
					);
			}
			lastProblem.delete(familyId);
		} catch (error) {
			console.warn('[calorias] No se pudieron estimar', String(error));
			lastProblem.set(familyId, error instanceof Error ? error.message : String(error));
		} finally {
			running.delete(familyId);
		}
	})();
}

/** After a receipt: its new products, if the family has used Calorías (it has some estimate). */
export async function estimateAfterReceipt(k: Kitchen) {
	try {
		const [any] = await k.run((tx) =>
			tx
				.select({ one: sql`1` })
				.from(foodEstimate)
				.limit(1)
		);
		if (any) void estimateMissing(k.familyId);
	} catch (error) {
		console.warn('[calorias] No se pudo mirar si estimar', String(error));
	}
}

/** A product as corrected by a person: the AI leaves it as it is. False: no such text. */
export async function correctEstimate(k: Kitchen, text: string, e: FoodEstimate) {
	const key = lineKey(text);
	if (!key) return false;
	const values = {
		food: e.food,
		byWeight: e.food && e.byWeight,
		grams: e.food ? e.grams : 0,
		kcal100: e.food ? e.kcal100 : 0,
		byHand: true,
		updatedAt: new Date()
	};
	await k.run((tx) =>
		tx
			.insert(foodEstimate)
			.values({ familyId: k.familyId, text: key, ...values })
			.onConflictDoUpdate({ target: [foodEstimate.familyId, foodEstimate.text], set: values })
	);
	return true;
}

/** Who the kcal are divided among: adults with an account; children, with one or without. */
export const familyPeople = (k: Kitchen): Promise<People> =>
	k.run(async (tx) => {
		const [members, without] = await Promise.all([
			tx.select({ role: familyMember.role }).from(familyMember),
			tx
				.select({ count: sql<number>`count(*)`.mapWith(Number) })
				.from(familyPerson)
				.where(isNull(familyPerson.userId))
		]);
		const kids = members.filter((m) => m.role === 'peque').length;
		return { adults: members.length - kids, children: kids + (without[0]?.count ?? 0) };
	});

/** Weeks shown, this one the last; and the whole ones the headline is the average of. */
export const WEEKS = 12;
const RECENT_WEEKS = 4;

export interface CaloriesWeek {
	/** Its Monday. */
	week: string;
	/** Bought, divided by its days (so far, this week) and the people. */
	perDay: number;
	/** The person's own walks, in km. */
	km: number;
	/** The days it has had: 7, or this week's so far. */
	days: number;
}

export interface CaloriesProduct {
	key: string;
	text: string;
	kcal: number;
	count: number;
	estimate: (FoodEstimate & { byHand: boolean }) | null;
}

/**
 * Paseos' card: the kcal bought by day and person, the average of the last RECENT_WEEKS whole
 * weeks, as the page's headline. Null if the family has not used Calorías (no estimate yet) or
 * nothing of it was food; it does not ask the AI for what is missing.
 */
export async function recentCalories(k: Kitchen, today: string): Promise<number | null> {
	const thisWeek = mondayOf(today);
	const first = addDays(thisWeek, -7 * RECENT_WEEKS);
	const [people, { lines, estimates }] = await Promise.all([
		familyPeople(k),
		k.run(async (tx) => {
			const [lines, estimates] = await Promise.all([foodLines(tx, first), estimatesOf(tx)]);
			return { lines, estimates };
		})
	]);
	if (!estimates.size) return null;
	let kcal = 0;
	for (const l of lines) {
		if (l.date >= thisWeek) continue;
		const row = estimates.get(lineKey(l.text));
		if (row) kcal += lineKcal(row, l.quantity);
	}
	return kcal > 0 ? kcal / (7 * RECENT_WEEKS) / peopleWeight(people) : null;
}

/**
 * The page's: the last WEEKS weeks by day and person, beside `userId`'s walks; the average of the
 * last whole ones; kcal by tag and by product; and what is still to estimate.
 */
export async function caloriesView(k: Kitchen, userId: string, today: string) {
	const thisWeek = mondayOf(today);
	const first = addDays(thisWeek, -7 * (WEEKS - 1));
	const people = await familyPeople(k);
	const weight = peopleWeight(people);
	const { lines, estimates, walks } = await k.run(async (tx) => {
		const [lines, estimates, walks] = await Promise.all([
			foodLines(tx, first),
			estimatesOf(tx),
			tx
				.select({ startedAt: walk.startedAt, distance: walk.distance })
				.from(walk)
				.where(and(eq(walk.userId, userId), gte(walk.startedAt, new Date(`${first}T00:00:00Z`))))
		]);
		return { lines, estimates, walks };
	});

	const byWeek = new Map<string, number>();
	const byTag = new Map<string, number>();
	const products = new Map<string, CaloriesProduct & { written: Map<string, number> }>();
	const pending = new Set<string>();
	let pendingLines = 0;
	for (const l of lines) {
		const key = lineKey(l.text);
		const row = estimates.get(key);
		const value = row ? lineKcal(row, l.quantity) : 0;
		if (!row) {
			pending.add(key);
			pendingLines++;
		}
		const week = mondayOf(l.date);
		byWeek.set(week, (byWeek.get(week) ?? 0) + value);
		if (value) byTag.set(l.tag, (byTag.get(l.tag) ?? 0) + value);
		const p = products.get(key) ?? {
			key,
			text: l.text,
			kcal: 0,
			count: 0,
			estimate: row
				? {
						food: row.food,
						byWeight: row.byWeight,
						grams: row.grams,
						kcal100: row.kcal100,
						byHand: row.byHand
					}
				: null,
			written: new Map()
		};
		p.kcal += value;
		p.count++;
		const written = l.text.replace(/\s+/g, ' ').trim();
		p.written.set(written, (p.written.get(written) ?? 0) + 1);
		products.set(key, p);
	}

	const kmByWeek = new Map<string, number>();
	for (const w of walks) {
		const week = mondayOf(dayOf(w.startedAt));
		kmByWeek.set(week, (kmByWeek.get(week) ?? 0) + w.distance / 1000);
	}

	const weeks: CaloriesWeek[] = Array.from({ length: WEEKS }, (_, i) => {
		const week = addDays(first, 7 * i);
		const days = week === thisWeek ? daysBetween(week, today) + 1 : 7;
		return {
			week,
			days,
			perDay: (byWeek.get(week) ?? 0) / days / weight,
			km: kmByWeek.get(week) ?? 0
		};
	});
	const whole = weeks.slice(-1 - RECENT_WEEKS, -1);
	const recent = whole.some((w) => w.perDay > 0)
		? whole.reduce((sum, w) => sum + w.perDay, 0) / whole.length
		: null;

	const total = [...byTag.values()].reduce((a, b) => a + b, 0);
	const tags = LINE_TAGS.filter((t) => byTag.get(t))
		.map((tag) => ({ tag, kcal: byTag.get(tag)!, share: byTag.get(tag)! / total }))
		.sort((a, b) => b.kcal - a.kcal);

	const list = [...products.values()].map(({ written, ...p }) => ({
		...p,
		text: [...written].sort((a, b) => b[1] - a[1])[0][0]
	}));
	return {
		people,
		weeks,
		recent,
		tags,
		products: list.filter((p) => p.estimate?.food).sort((a, b) => b.kcal - a.kcal),
		notFood: list.filter((p) => p.estimate && !p.estimate.food).sort((a, b) => b.count - a.count),
		pending: { products: pending.size, lines: pendingLines }
	};
}
