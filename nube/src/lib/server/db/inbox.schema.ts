import { index, jsonb, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';
import { user } from './auth.schema.ts';
import { family, familyRows } from './family.schema.ts';

/**
 * Each person's «Buzón» (#331): what the app told them, kept after the phone's notice is gone
 * (the agenda, the alarms, the doses, the homework, the voice) and the messages left for them
 * («déjale un recado a Ana»). Only theirs: no one else sees it, not even the family's
 * administrator (inbox.ts, as memory.ts).
 */
export const inbox = pgTable(
	'inbox',
	{
		id: serial('id').primaryKey(),
		familyId: text('family_id')
			.notNull()
			.references(() => family.id, { onDelete: 'cascade' }),
		/** Whose. */
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		/** Where it comes from: agenda, alarma, medicacion, deberes, voz, recado, regla, propuesta. */
		kind: text('kind').notNull(),
		/** Urgent: by every way at once, whatever they chose (Ajustes). */
		level: text('level', { enum: ['normal', 'urgente'] })
			.notNull()
			.default('normal'),
		title: text('title').notNull(),
		body: text('body').notNull(),
		/** Opened from it. */
		url: text('url').notNull(),
		/** As the phone's: a new one with the same, still unread, takes its place. */
		tag: text('tag'),
		/** A message's: who left it; null, a satellite or the app itself. */
		fromUserId: text('from_user_id').references(() => user.id, { onDelete: 'set null' }),
		/**
		 * Something to remember, offered (#331, phase 5: from a Telegram message): kept with
		 * «Guardar», in their memory; gone once answered.
		 */
		proposal: jsonb('proposal').$type<{
			text: string;
			untilDay: string | null;
			because: string;
		}>(),
		createdAt: timestamp('created_at').notNull().defaultNow(),
		readAt: timestamp('read_at')
	},
	(t) => [
		index('inbox_user_idx').on(t.familyId, t.userId, t.createdAt),
		familyRows('inbox_own', t.familyId)
	]
).enableRLS();
