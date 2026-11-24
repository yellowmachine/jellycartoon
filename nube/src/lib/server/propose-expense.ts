import { dayName } from 'comun/agenda.ts';
import { euros } from 'comun/expenses.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { keepInInbox } from '#lib/server/inbox-store.ts';
import type { DoneEvent } from '#lib/server/rule-check.ts';
import type { RuleExpense } from '#lib/rules.ts';

const tagOf = (ruleId: number, done: Pick<DoneEvent, 'eventId' | 'day'>) =>
	`gasto-${ruleId}-${done.eventId}-${done.day}`;

/** Offered to who marked it, without their phone: they are looking at it. */
export async function proposeExpense(
	k: Kitchen,
	ruleId: number,
	expense: RuleExpense,
	done: DoneEvent
) {
	await keepInInbox(k, [done.userId], {
		kind: 'propuesta',
		title: `💶 ${expense.store}, ${euros(expense.total)}`,
		body: `¿Lo añado a Dinero? Por «${done.title}», ${dayName(done.day)}.`,
		tag: tagOf(ruleId, done),
		url: `/agenda?dia=${done.day}`,
		ttl: 0,
		proposal: {
			type: 'gasto',
			ruleId,
			eventId: done.eventId,
			day: done.day,
			...expense,
			because: `está hecho «${done.title}»`
		}
	});
}
