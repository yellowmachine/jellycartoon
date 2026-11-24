import { desc, gte, sql } from 'drizzle-orm';
import { aiKind } from 'comun/ai-spend.ts';
import { addDays, localDay, mondayOf } from 'comun/agenda.ts';
import { addMonths, monthOf } from 'comun/expenses.ts';
import { aiCost } from '#lib/server/db/schema.ts';
import { openRouterKey } from '#lib/server/family-settings.ts';
import { keyUsage } from '#lib/server/openrouter-usage.ts';
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

/** Its kind: one noted as «Otros», by its label now. */
const kindOf = (kind: string, label: string | null) =>
	kind === 'Otros' && label ? aiKind(label) : kind;

/** Summed by their kind as it is now. */
function named(rows: { kind: string; label: string | null; count: number; cost: number }[]) {
	const sums = new Map<string, { kind: string; count: number; cost: number }>();
	for (const r of rows) {
		const kind = kindOf(r.kind, r.label);
		const sum = sums.get(kind) ?? { kind, count: 0, cost: 0 };
		sum.count += r.count;
		sum.cost += r.cost;
		sums.set(kind, sum);
	}
	return [...sums.values()];
}

/**
 * This month's spending of the key that is not noted here: the speech (OpenRouter does not say what
 * it costs) and whatever else uses the key. Its month is UTC's, so about; null, nothing to say (not
 * noted since before the month, or within what that hour or two can be).
 */
export function unnoted(
	stats: { month: number; since: string | null },
	openRouterMonth: number | null,
	today = localDay()
) {
	if (openRouterMonth === null || !stats.since) return null;
	if (localDay(new Date(stats.since)) > `${monthOf(today)}-01`) return null;
	const rest = openRouterMonth - stats.month;
	return rest >= 0.01 && rest > stats.month * 0.01 ? rest : null;
}

const dollars = (n: number) => `${n.toFixed(n < 1 ? 3 : 2).replace('.', ',')} $`;

/** Preguntar's «read_ai_spending»: what the AI costs, as Dinero → IA has it. */
export async function describeAiSpending(k: Kitchen) {
	const stats = await aiCostStats(k);
	if (!stats.count) return 'Aún no hay apuntado ningún gasto de IA.';
	const key = await openRouterKey(k);
	const rest = unnoted(stats, key ? ((await keyUsage(key))?.month ?? null) : null);
	const kinds = (rows: { kind: string; count: number; cost: number }[]) =>
		rows
			.map((r) => `${r.kind} ${dollars(r.cost)} (${r.count} ${r.count === 1 ? 'vez' : 'veces'})`)
			.join(', ') || 'nada';
	return [
		`Gasto en IA de la familia, en dólares, apuntado desde el ${stats.since?.slice(0, 10)}: esta semana ${dollars(stats.week)}, este mes ${dollars(stats.month)}, en total ${dollars(stats.total)}.`,
		`Este mes, por tipo: ${kinds(stats.kinds.month)}.`,
		...(rest
			? [
					`Además, unos ${dollars(rest)} este mes sin apuntar, según OpenRouter: la voz hablada (no dice lo que cuesta) y lo demás que use la clave.`
				]
			: []),
		`Desde siempre, por tipo: ${kinds(stats.kinds.all)}.`,
		`Por meses: ${stats.months
			.filter((m) => m.cost)
			.map((m) => `${m.month} ${dollars(m.cost)}`)
			.join(', ')}.`,
		'No se sabe quién de la familia hizo cada petición.'
	].join('\n');
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
	/** The label of those noted as «Otros»: they may have a kind of their own by now. */
	const unnamed = sql<string | null>`case when ${aiCost.kind} = 'Otros' then ${aiCost.label} end`;

	return k.run(async (tx) => {
		const [byMonth, byWeek, kindsMonth, kindsAll, [all], recent] = await Promise.all([
			tx.select({ month, cost: sum }).from(aiCost).where(gte(aiCost.at, since)).groupBy(month),
			tx.select({ week, cost: sum }).from(aiCost).where(gte(aiCost.at, since)).groupBy(week),
			tx
				.select({ kind: aiCost.kind, label: unnamed, count, cost: sum })
				.from(aiCost)
				.where(gte(aiCost.at, new Date(`${thisMonth}-01T00:00:00`)))
				.groupBy(aiCost.kind, unnamed),
			tx
				.select({ kind: aiCost.kind, label: unnamed, count, cost: sum })
				.from(aiCost)
				.groupBy(aiCost.kind, unnamed),
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
			kinds: { month: byCost(named(kindsMonth)), all: byCost(named(kindsAll)) },
			recent: recent.map((r) => ({
				...r,
				kind: kindOf(r.kind, r.label),
				at: r.at.toISOString(),
				app: r.app as AiApp
			}))
		};
	});
}
