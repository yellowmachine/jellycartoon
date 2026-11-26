import { addDays, dayEvents, daysBetween, timeOn } from 'comun/agenda.ts';
import { nextDue } from 'comun/expenses.ts';
import { and, eq, gte, lt } from 'drizzle-orm';
import { familyMember, plug, plugEnergy, recurringExpense } from '#lib/server/db/schema.ts';
import { agendaBetween } from '#lib/server/agenda/agenda.ts';
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
	moneyOf,
	noSummaryChoice,
	PRICE_LOOK_BACK_DAYS,
	shoppingOf,
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
	return { ...choice, off: choice.off.filter(isSummaryBlock) };
}

export async function setSummaryChoice(k: Kitchen, userId: string, summary: SummaryChoice) {
	await k.run((tx) =>
		tx.update(familyMember).set({ summary }).where(eq(familyMember.userId, userId))
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
async function energyIn(k: Kitchen, p: SummaryPeriod, now: Date) {
	const start = dayStart(p.from);
	const end = dayStart(addDays(p.to, 1));
	const prevStart = dayStart(p.prevFrom);
	const upTo = Math.min(end.getTime(), now.getTime());
	const prevEnd = new Date(
		Math.min(prevStart.getTime() + (upTo - start.getTime()), start.getTime())
	);
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
	const [expenses, foot, past, next, charges, energy] = await Promise.all([
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
		has('energia') ? energyIn(k, p, now) : null
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
		walks: walks.outings || before.outings ? { ...walks, before } : null,
		past,
		next,
		charges
	};
}

/** The home page's card; null, they took it out. Compras and Energía are not in it. */
export async function homeSummary(k: Kitchen, userId: string, today: string) {
	const { card, off } = await summaryChoice(k, userId);
	return card ? summaryOf(k, userId, 'dias', null, today, [...off, 'compras', 'energia']) : null;
}
