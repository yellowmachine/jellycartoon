import { addDays, dayEvents, daysBetween, localDay, localTime, timeOn } from 'comun/agenda.ts';
import { nextDue } from 'comun/expenses.ts';
import { and, eq, gte, inArray, isNotNull, lt, lte } from 'drizzle-orm';
import {
	expense,
	familyMember,
	medicationDose,
	plug,
	plugEnergy,
	recurringExpense,
	trip
} from '#lib/server/db/schema.ts';
import { agendaBetween, agendaPeople } from '#lib/server/agenda/agenda.ts';
import { listMedication, toldFor } from '#lib/server/medication.ts';
import { listWishes } from '#lib/server/wishes.ts';
import { familySections } from '#lib/server/family-settings.ts';
import { sectionOn } from '#lib/nav.ts';
import { searchExpenses } from '#lib/server/expenses/expenses.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { onFootBetween } from '#lib/server/walks/on-foot.ts';
import { priceOf } from '#lib/server/plugs/plugs.ts';
import { isSensorDevice } from '#lib/server/plugs/shelly.ts';
import { dayStart } from '#lib/server/plugs/stats.ts';
import { addKcal } from '#lib/walk-kcal.ts';
import {
	energyOf,
	isSummaryBlock,
	medicationOf,
	moneyOf,
	noSummaryChoice,
	NOTICE_VIEWS,
	PRICE_LOOK_BACK_DAYS,
	shoppingOf,
	SUMMARY_BLOCKS,
	wishesOf,
	type Car,
	summaryPeriod,
	type SummaryBlock,
	type SummaryChoice,
	type SummaryPeriod,
	type SummaryView
} from '#lib/summary.ts';

export async function summaryChoice(k: Kitchen, userId: string): Promise<SummaryChoice> {
	const [row] = await k.run((tx) =>
		tx
			.select({ choice: familyMember.summary })
			.from(familyMember)
			.where(eq(familyMember.userId, userId))
	);
	const choice = { ...noSummaryChoice(), ...row?.choice };
	return {
		...choice,
		off: choice.off.filter(isSummaryBlock),
		notice: (choice.notice ?? []).filter((v) => (NOTICE_VIEWS as readonly string[]).includes(v))
	};
}

export async function setSummaryChoice(k: Kitchen, userId: string, summary: SummaryChoice) {
	await k.run((tx) =>
		tx.update(familyMember).set({ summary }).where(eq(familyMember.userId, userId))
	);
}

/**
 * The blocks not to show them: those they took out, and those of a section the family or they took
 * out (nav.ts sectionOn, as the page leaves them out).
 */
export async function summaryOff(k: Kitchen, userId: string): Promise<SummaryBlock[]> {
	const [{ off }, sections, [me]] = await Promise.all([
		summaryChoice(k, userId),
		familySections(k),
		k.run((tx) =>
			tx
				.select({ mine: familyMember.sections })
				.from(familyMember)
				.where(eq(familyMember.userId, userId))
		)
	]);
	return (Object.keys(SUMMARY_BLOCKS) as SummaryBlock[]).filter(
		(b) => off.includes(b) || !sectionOn(SUMMARY_BLOCKS[b].section, sections, me?.mine ?? {})
	);
}

/** Events told one by one; the rest, counted. */
const EVENTS_TOLD = 20;

/** Days' events, with what repeats every day or week left for the count. */
async function agendaOf(k: Kitchen, from: string, to: string) {
	const { occurrences } = await agendaBetween(k, from, to);
	const days: { day: string; events: string[] }[] = [];
	let told = 0;
	let more = 0;
	for (let day = from; day <= to; day = addDays(day, 1)) {
		const events: string[] = [];
		for (const o of dayEvents(occurrences, day)) {
			// Several days long, on its first.
			if (o.day !== day && !(day === from && o.day < from)) continue;
			if (told >= EVENTS_TOLD) {
				more++;
				continue;
			}
			told++;
			const time = timeOn(o, day);
			events.push(time ? `${time} ${o.title}` : o.title);
		}
		if (events.length) days.push({ day, events });
	}
	return { days, more, count: told + more };
}

/** The fixed ones that fall due from today to that day. */
async function chargesUntil(k: Kitchen, today: string, until: string) {
	const fixed = await k.run((tx) => tx.select().from(recurringExpense));
	return fixed
		.flatMap((r) => {
			const day = nextDue(r, r.lastMonth, today);
			return day && day <= until
				? [
						{
							id: r.id,
							name: r.name,
							amount: r.amount,
							day,
							left: daysBetween(today, day),
							account: r.paidFrom
						}
					]
				: [];
		})
		.sort((a, b) => a.left - b.left || b.amount - a.amount);
}

/**
 * What the family's plugs used in the period, beside the one before only as far in: the last 7 days
 * with today going on are not set against 7 whole ones. Null, no plugs.
 */
function instantsOf(p: SummaryPeriod, now: Date) {
	const start = dayStart(p.from);
	const end = dayStart(addDays(p.to, 1));
	const prevStart = dayStart(p.prevFrom);
	const upTo = Math.min(end.getTime(), now.getTime());
	const prevEnd = new Date(
		Math.min(prevStart.getTime() + (upTo - start.getTime()), start.getTime())
	);
	return { start, end, prevStart, prevEnd };
}

async function energyIn(k: Kitchen, p: SummaryPeriod, now: Date) {
	const { start, end, prevStart, prevEnd } = instantsOf(p, now);
	return k.run(async (tx) => {
		// Sensors (#508) use nothing.
		const plugs = (
			await tx.select({ id: plug.id, name: plug.name, deviceId: plug.deviceId }).from(plug)
		).filter((x) => !isSensorDevice(x.deviceId));
		if (!plugs.length) return null;
		const [rows, price] = await Promise.all([
			tx
				.select({
					plugId: plugEnergy.plugId,
					hour: plugEnergy.hour,
					wh: plugEnergy.wh,
					mark: plugEnergy.mark
				})
				.from(plugEnergy)
				.where(and(gte(plugEnergy.hour, prevStart), lt(plugEnergy.hour, end))),
			priceOf(tx)
		]);
		return energyOf(rows, plugs, price, { start, end, prevStart, prevEnd });
	});
}

/** Their own trips in the road mode, and what they put in Gasolina. Null, neither. */
async function carOf(k: Kitchen, userId: string, p: SummaryPeriod, now: Date): Promise<Car | null> {
	const { start, end, prevStart, prevEnd } = instantsOf(p, now);
	const [trips, fuel] = await k.run((tx) =>
		Promise.all([
			tx
				.select({ startedAt: trip.startedAt, distance: trip.distance })
				.from(trip)
				.where(
					and(eq(trip.userId, userId), gte(trip.startedAt, prevStart), lt(trip.startedAt, end))
				),
			tx
				.select({ total: expense.total })
				.from(expense)
				.where(
					and(
						eq(expense.userId, userId),
						eq(expense.category, 'Gasolina'),
						gte(expense.date, p.from),
						lte(expense.date, p.to)
					)
				)
		])
	);
	const these = trips.filter((t) => t.startedAt >= start);
	const before = trips.filter((t) => t.startedAt < prevEnd);
	if (!these.length && !before.length && !fuel.length) return null;
	const metres = (list: typeof trips) => Math.round(list.reduce((s, t) => s + t.distance, 0));
	return {
		metres: metres(these),
		trips: these.length,
		before: before.length ? metres(before) : null,
		fuel: fuel.reduce((s, e) => s + e.total, 0),
		fuels: fuel.length
	};
}

/** The doses of their own medication and their children's (those told to them). */
async function medicationIn(k: Kitchen, userId: string, p: SummaryPeriod, now: Date) {
	const meds = await listMedication(k);
	if (!meds.length) return [];
	const mine = new Set<string>();
	for (const personId of new Set(meds.map((m) => m.personId)))
		if ((await toldFor(k, Number(personId))).includes(userId)) mine.add(personId);
	const theirs = meds.filter((m) => mine.has(m.personId));
	if (!theirs.length) return [];
	const [people, rows] = await Promise.all([
		agendaPeople(k),
		k.run((tx) =>
			tx
				.select({
					id: medicationDose.medicationId,
					day: medicationDose.day,
					time: medicationDose.time
				})
				.from(medicationDose)
				.where(
					and(
						inArray(
							medicationDose.medicationId,
							theirs.map((m) => m.id)
						),
						gte(medicationDose.day, p.from),
						lte(medicationDose.day, p.to),
						isNotNull(medicationDose.takenAt)
					)
				)
		)
	]);
	return medicationOf(
		theirs,
		new Set(rows.map((r) => `${r.id} ${r.day} ${r.time.slice(0, 5)}`)),
		people.filter((x) => mine.has(x.id)),
		p.from,
		p.to,
		{ day: localDay(now), time: localTime(now) }
	);
}

/** The wishes bought in the period, as they may see them: never the gifts for them. */
async function wishesIn(k: Kitchen, userId: string, p: SummaryPeriod) {
	const { people, wishes } = await listWishes(k, userId, false, {
		from: p.from,
		to: p.to,
		text: null
	});
	const names = new Map(people.map((x) => [x.id, x.name]));
	const bought = wishes.flatMap((w) =>
		w.bought && w.bought.on >= p.from && w.bought.on <= p.to
			? [
					{
						id: w.id,
						title: w.title,
						person: names.get(w.personId) ?? '',
						shop: w.shop,
						on: w.bought.on,
						priceCents: w.priceCents,
						shippingCents: w.shippingCents,
						extraCents: w.extraCents,
						currency: w.currency,
						expenseId: w.bought.expenseId
					}
				]
			: []
	);
	const ids = [...new Set(bought.flatMap((w) => (w.expenseId === null ? [] : [w.expenseId])))];
	const totals = ids.length
		? await k.run((tx) =>
				tx
					.select({ id: expense.id, total: expense.total })
					.from(expense)
					.where(inArray(expense.id, ids))
			)
		: [];
	return wishesOf(bought, new Map(totals.map((t) => [t.id, t.total])));
}

/** Resumen (summary.ts) for `userId`: the family's money and agenda, and their own going on foot. */
export async function summaryOf(
	k: Kitchen,
	userId: string,
	view: SummaryView,
	de: string | null,
	today: string,
	off: SummaryBlock[] = [],
	now = new Date()
) {
	const has = (b: SummaryBlock) => !off.includes(b);
	const p = summaryPeriod(view, de, today);
	// Compras looks further back, for the prices before.
	const since = has('compras') ? addDays(p.from, -PRICE_LOOK_BACK_DAYS) : p.prevFrom;
	const [expenses, foot, past, next, charges, energy, car, medication, wishes] = await Promise.all([
		has('dinero') || has('compras')
			? searchExpenses(k, { text: '', from: since, to: p.to }, { limit: null })
			: [],
		has('paseos') ? onFootBetween(k, userId, p.prevFrom, p.to) : [],
		// Today's, with what is to come.
		has('agenda')
			? agendaOf(k, p.from, p.view === 'dias' ? addDays(today, -1) : p.to)
			: { days: [], more: 0, count: 0 },
		has('agenda') && p.view === 'dias' ? agendaOf(k, today, p.until!) : null,
		has('fijos') && p.until ? chargesUntil(k, today, p.until) : [],
		has('energia') ? energyIn(k, p, now) : null,
		has('coche') ? carOf(k, userId, p, now) : null,
		has('medicacion') ? medicationIn(k, userId, p, now) : [],
		has('deseos') ? wishesIn(k, userId, p) : null
	]);
	const walked = (from: string, to: string) => {
		const those = foot.filter((o) => o.day >= from && o.day <= to);
		return {
			outings: those.reduce((s, o) => s + o.outings, 0),
			metres: those.reduce((s, o) => s + o.distance, 0),
			seconds: those.reduce((s, o) => s + o.seconds, 0),
			kcal: addKcal(those.map((o) => o.kcal))
		};
	};
	const walks = walked(p.from, p.to);
	const before = walked(p.prevFrom, p.prevTo);
	return {
		period: p,
		money: has('dinero')
			? moneyOf(
					expenses.filter((e) => e.date >= p.from),
					expenses.filter((e) => e.date >= p.prevFrom && e.date < p.from)
				)
			: null,
		shopping: has('compras')
			? shoppingOf(
					expenses.filter((e) => e.date >= p.from),
					expenses.filter((e) => e.date < p.from)
				)
			: null,
		energy,
		car,
		medication,
		wishes,
		walks: walks.outings || before.outings ? { ...walks, before } : null,
		past,
		next,
		charges
	};
}

/** The home page's card; null, they took it out. Only money, walks and the agenda: the rest is not in it. */
export async function homeSummary(k: Kitchen, userId: string, today: string) {
	const { card, off } = await summaryChoice(k, userId);
	return card
		? summaryOf(k, userId, 'dias', null, today, [
				...off,
				'compras',
				'energia',
				'coche',
				'medicacion',
				'deseos'
			])
		: null;
}
