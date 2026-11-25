import { addDays, dayEvents, daysBetween, timeOn } from 'comun/agenda.ts';
import { nextDue } from 'comun/expenses.ts';
import { recurringExpense } from '#lib/server/db/schema.ts';
import { agendaBetween } from '#lib/server/agenda/agenda.ts';
import { searchExpenses } from '#lib/server/expenses/expenses.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { onFootBetween } from '#lib/server/walks/on-foot.ts';
import { addKcal } from '#lib/walk-kcal.ts';
import { moneyOf, summaryPeriod, type SummaryView } from '#lib/summary.ts';

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

/** Resumen (summary.ts) for `userId`: the family's money and agenda, and their own going on foot. */
export async function summaryOf(
	k: Kitchen,
	userId: string,
	view: SummaryView,
	de: string | null,
	today: string
) {
	const p = summaryPeriod(view, de, today);
	const [expenses, foot, past, next, charges] = await Promise.all([
		searchExpenses(k, { text: '', from: p.prevFrom, to: p.to }, { limit: null }),
		onFootBetween(k, userId, p.prevFrom, p.to),
		// Today's, with what is to come.
		agendaOf(k, p.from, p.view === 'dias' ? addDays(today, -1) : p.to),
		p.view === 'dias' ? agendaOf(k, today, p.until!) : null,
		p.until ? chargesUntil(k, today, p.until) : []
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
		money: moneyOf(
			expenses.filter((e) => e.date >= p.from),
			expenses.filter((e) => e.date < p.from)
		),
		walks: walks.outings || before.outings ? { ...walks, before } : null,
		past,
		next,
		charges
	};
}
