import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { family, familyRows } from './family.schema.ts';

/**
 * The family's Telegram bot (#253; jellycartoon's #243): made by its administrator with @BotFather,
 * its token kept encrypted (secret-box.ts), the group it tells among those it has been added to, and
 * what it tells (telegram-bot.ts). One bot listens from one place only: here, for the family's
 * house too (/api/casa/telegram).
 */
export const telegramBot = pgTable(
	'telegram_bot',
	{
		familyId: text('family_id')
			.primaryKey()
			.references(() => family.id, { onDelete: 'cascade' }),
		token: text('token').notNull(),
		username: text('username'),
		/** The group it tells; null, none chosen yet. */
		chat: jsonb('chat').$type<{ id: number; title: string } | null>(),
		/** The groups it has been added to. */
		chats: jsonb('chats').$type<{ id: number; title: string }[]>().notNull().default([]),
		events: jsonb('events').$type<Record<string, boolean>>().notNull().default({}),
		updatedAt: timestamp('updated_at')
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date())
	},
	(t) => [familyRows('telegram_bot_own', t.familyId)]
).enableRLS();
