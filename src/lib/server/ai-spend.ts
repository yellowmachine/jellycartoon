import { and, desc, eq, sql } from 'drizzle-orm';
import { spendTracker, RECENT_COSTS, type AiSpend } from 'comun/ai-spend.ts';
import { db } from '#lib/server/db/index.ts';
import { logEntry } from '#lib/server/db/schema.ts';
import { keyBalance, watchCost } from '#lib/server/openrouter.ts';

/**
 * The AI's spending under the header (#193), live: OpenRouter's own figures for the house's key
 * (`usage`, `usage_monthly`, `usage_weekly`) and the last requests' costs, the ones from before a
 * restart read from the Registro (openrouter.ts writes one line for each).
 */

/** The usage `describeUsage` puts after the label, in lines written before the label had its own. */
const USAGE = /: [\d.]+ \+ [\d.]+ tokens.*$/s;

const tracker = spendTracker({
	read: async () => {
		const balance = await keyBalance();
		return (
			balance && {
				total: balance.spent.total,
				month: balance.spent.month,
				week: balance.spent.week
			}
		);
	},
	recent: async () => {
		const cost = sql`(${logEntry.details}->'usage'->>'cost')::numeric`;
		const rows = await db
			.select({ at: logEntry.at, message: logEntry.message, details: logEntry.details, cost })
			.from(logEntry)
			.where(and(eq(logEntry.source, 'ia'), sql`${cost} > 0`))
			.orderBy(desc(logEntry.at))
			.limit(RECENT_COSTS);
		return rows.map((row) => ({
			label:
				typeof row.details?.label === 'string' ? row.details.label : row.message.replace(USAGE, ''),
			cost: Number(row.cost),
			at: row.at.toISOString()
		}));
	}
});

watchCost((label, cost) => tracker.add(label, cost));

/** A page showing the line: told now and on every change; OpenRouter asked only while any does. */
export const watchAiSpend = (listener: (spend: AiSpend | null) => void) => tracker.watch(listener);
