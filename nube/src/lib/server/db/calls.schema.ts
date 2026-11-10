import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { CallOutcome } from '#lib/calls.ts';
import { user } from './auth.schema.ts';
import { family, familyRows } from './family.schema.ts';

/**
 * The family's calls (#330), for the history: who called whom, when, and how long they talked.
 * The call itself, while it rings and lasts, lives in the server's memory (calls.ts); this row is
 * made when it starts and closed when it ends. A person gone, their side stays without a name.
 */
export const call = pgTable(
	'call',
	{
		/** Random: it is in the call's address (/llamada/…). */
		id: text('id').primaryKey(),
		familyId: text('family_id')
			.notNull()
			.references(() => family.id, { onDelete: 'cascade' }),
		callerId: text('caller_id').references(() => user.id, { onDelete: 'set null' }),
		calleeId: text('callee_id').references(() => user.id, { onDelete: 'set null' }),
		startedAt: timestamp('started_at').notNull().defaultNow(),
		answeredAt: timestamp('answered_at'),
		endedAt: timestamp('ended_at'),
		/** Null while it rings or lasts. */
		outcome: text('outcome').$type<CallOutcome>()
	},
	(t) => [
		index('call_family_started_idx').on(t.familyId, t.startedAt),
		familyRows('call_own', t.familyId)
	]
).enableRLS();
