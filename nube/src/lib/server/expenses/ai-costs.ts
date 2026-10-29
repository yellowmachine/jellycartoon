import { desc, gte, sql } from 'drizzle-orm';
import { aiKind } from 'comun/ai-spend.ts';
import { addDays, localDay, mondayOf } from 'comun/agenda.ts';
import { addMonths, monthOf } from 'comun/expenses.ts';
import { aiCost } from '#lib/server/db/schema.ts';
import { houseKitchen, type Kitchen } from '#lib/server/fridge.ts';

/**
 * What the family's AI costs (#193), for Gastos → IA: each request's, noted as it comes back, the
 * cloud's own (ai-spend.ts) and the house's (/api/casa/gasto-ia); summed by kind, month and week.
 */

export type AiApp = 'nube' | 'casa';

/**
 * One request's cost, for its family. One the house sends again (`houseRef`, the house's id for it)
 * is not counted twice. Throws if not kept: the house keeps it, to send again.
 */
export async function addAiCost(
	familyId: string,
	app: AiApp,
	label: string,
	cost: number,
	at = new Date(),
	houseRef: string | null = null
) {
	await houseKitchen(familyId).run((tx) =>
		tx
			.insert(aiCost)
			.values({
				familyId,
				app,
				kind: aiKind(label),
				label: label.slice(0, 300),
				cost,
				at,
				houseRef
			})
			.onConflictDoNothing({ target: [aiCost.familyId, aiCost.houseRef] })
	);
}

/** The cloud's own: never in the way of what it was for. */
export async function noteAiCost(familyId: string, app: AiApp, label: string, cost: number) {
	await addAiCost(familyId, app, label, cost).catch((error) =>
		console.warn('[ia] No se pudo apuntar el coste', String(error))
	);
}

/** The months shown, this one the last; and the weeks. */
const MONTHS = 12;
const WEEKS = 8;
const RECENT = 20;

export async function aiCostStats(k: Kitchen) {
	const today = localDay();
	const thisMonth = monthOf(today);
	const thisWeek = mondayOf(today);
	const firstMonth = addMonths(thisMonth, -(MONTHS - 1));
	const firstWeek = addDays(thisWeek, -7 * (WEEKS - 1));
	const since = new Date(`${firstMonth < firstWeek ? firstMonth + '-01' : firstWeek}T00:00:00`);
	const month = sql<string>`to_char(${aiCost.at}, 'YYYY-MM')`;
	const week = sql<string>`to_char(date_trunc('week', ${aiCost.at}), 'YYYY-MM-DD')`;
	const sum = sql<number>`coalesce(sum(${aiCost.cost}), 0)`.mapWith(Number);
	const count = sql<number>`count(*)`.mapWith(Number);

	return k.run(async (tx) => {
		const [byMonth, byWeek, kindsMonth, kindsAll, [all], recent] = await Promise.all([
			tx.select({ month, cost: sum }).from(aiCost).where(gte(aiCost.at, since)).groupBy(month),
			tx.select({ week, cost: sum }).from(aiCost).where(gte(aiCost.at, since)).groupBy(week),
			tx
				.select({ kind: aiCost.kind, count, cost: sum })
				.from(aiCost)
				.where(gte(aiCost.at, new Date(`${thisMonth}-01T00:00:00`)))
				.groupBy(aiCost.kind),
			tx.select({ kind: aiCost.kind, count, cost: sum }).from(aiCost).groupBy(aiCost.kind),
			tx.select({ count, cost: sum, since: sql<Date | null>`min(${aiCost.at})` }).from(aiCost),
			tx
				.select({
					at: aiCost.at,
					app: aiCost.app,
					kind: aiCost.kind,
					label: aiCost.label,
					cost: aiCost.cost
				})
				.from(aiCost)
				.orderBy(desc(aiCost.at))
				.limit(RECENT)
		]);
		const months = Array.from({ length: MONTHS }, (_, i) => {
			const m = addMonths(firstMonth, i);
			return { month: m, cost: byMonth.find((r) => r.month === m)?.cost ?? 0 };
		});
		const weeks = Array.from({ length: WEEKS }, (_, i) => {
			const w = addDays(firstWeek, 7 * i);
			return { week: w, cost: byWeek.find((r) => r.week === w)?.cost ?? 0 };
		});
		const byCost = <T extends { cost: number }>(rows: T[]) => rows.sort((a, b) => b.cost - a.cost);
		return {
			month: months.at(-1)!.cost,
			week: weeks.at(-1)!.cost,
			total: all?.cost ?? 0,
			count: all?.count ?? 0,
			since: all?.since ? new Date(all.since).toISOString() : null,
			months,
			weeks,
			kinds: { month: byCost(kindsMonth), all: byCost(kindsAll) },
			recent: recent.map((r) => ({ ...r, at: r.at.toISOString(), app: r.app as AiApp }))
		};
	});
}
