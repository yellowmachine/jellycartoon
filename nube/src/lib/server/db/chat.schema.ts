import { date, index, jsonb, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';
import type { ChatCard } from '#lib/chat.ts';
import type { ReportPiece } from '#lib/reports.ts';
import { user } from './auth.schema.ts';
import { family, familyRows } from './family.schema.ts';

/**
 * «Preguntar» (#470): each person's chat with the family's AI, what they wrote and what it
 * answered, with its cards (a shopping list to tick, a recipe to save). Only theirs: no one else
 * sees it, not even the family's administrator. Children have no chat.
 */
export const chatMessage = pgTable(
	'chat_message',
	{
		id: serial('id').primaryKey(),
		familyId: text('family_id')
			.notNull()
			.references(() => family.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		role: text('role', { enum: ['user', 'assistant'] }).notNull(),
		text: text('text').notNull(),
		/** What the answer proposed, and what of it was taken (`added`, `savedId`). */
		cards: jsonb('cards').$type<ChatCard[]>().notNull().default([]),
		createdAt: timestamp('created_at').notNull().defaultNow()
	},
	(t) => [
		index('chat_message_user_idx').on(t.userId, t.id),
		familyRows('chat_message_own', t.familyId)
	]
).enableRLS();

/**
 * A report (#505, Preguntar → Informes): asked for in the chat, kept as it was made, the figures of
 * its blocks taken again only with «Actualizar». Only its person's, as the chat.
 */
export const report = pgTable(
	'report',
	{
		id: serial('id').primaryKey(),
		familyId: text('family_id')
			.notNull()
			.references(() => family.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		/** The days it is about, both included. */
		fromDay: date('from_day').notNull(),
		toDay: date('to_day').notNull(),
		/** The AI's words and the blocks, with their figures as they were taken. */
		pieces: jsonb('pieces').$type<ReportPiece[]>().notNull().default([]),
		/** The expenses taken away by the person: not of this trip. */
		excluded: jsonb('excluded').$type<number[]>().notNull().default([]),
		createdAt: timestamp('created_at').notNull().defaultNow(),
		/** When its figures were taken: made, or «Actualizar». */
		refreshedAt: timestamp('refreshed_at').notNull().defaultNow()
	},
	(t) => [index('report_user_idx').on(t.userId, t.id), familyRows('report_own', t.familyId)]
).enableRLS();
