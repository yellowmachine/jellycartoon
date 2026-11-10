import { and, asc, eq, gte, lte, notExists, sql } from 'drizzle-orm';
import { expense, expenseLine, expenseTag, expenseTagRule } from '#lib/server/db/schema.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { lineKey, type OwnTags } from 'comun/expenses.ts';

/**
 * The family's own tags for receipt lines (#459): «barra picos» → Pan. A rule per line text (as
 * lineKey leaves it), for every receipt, before or after; a tag with no rule left goes.
 */

/** At most, a tag's name. */
export const TAG_NAME_MAX = 40;

export const ownTags = (k: Kitchen): Promise<OwnTags> =>
	k.run(async (tx) => {
		const [tags, rules] = await Promise.all([
			tx
				.select({ id: expenseTag.id, name: expenseTag.name })
				.from(expenseTag)
				.orderBy(asc(expenseTag.name)),
			tx.select({ text: expenseTagRule.text, tagId: expenseTagRule.tagId }).from(expenseTagRule)
		]);
		return { tags, rules: Object.fromEntries(rules.map((r) => [r.text, r.tagId])) };
	});

/** What a line is given: one of the family's tags, a new one by its name, or none. */
export type TagChoice = { tagId: number } | { name: string } | null;

/**
 * Every line with `text` has that tag from now on, or none. A name already there (case and accents
 * aside) is that tag, not another. False: an empty text or name, or a tag that is not there.
 */
export function tagLine(k: Kitchen, text: string, choice: TagChoice): Promise<boolean> {
	const key = lineKey(text);
	if (!key) return Promise.resolve(false);
	return k.run(async (tx) => {
		let tagId: number | null = null;
		if (choice && 'tagId' in choice) {
			const [found] = await tx
				.select({ id: expenseTag.id })
				.from(expenseTag)
				.where(eq(expenseTag.id, choice.tagId));
			if (!found) return false;
			tagId = found.id;
		} else if (choice) {
			const name = choice.name.replace(/\s+/g, ' ').trim().slice(0, TAG_NAME_MAX);
			if (!lineKey(name)) return false;
			const tags = await tx.select().from(expenseTag);
			tagId =
				tags.find((t) => lineKey(t.name) === lineKey(name))?.id ??
				(
					await tx
						.insert(expenseTag)
						.values({ familyId: k.familyId, name })
						.returning({ id: expenseTag.id })
				)[0].id;
		}
		if (tagId === null) await tx.delete(expenseTagRule).where(eq(expenseTagRule.text, key));
		else
			await tx
				.insert(expenseTagRule)
				.values({ familyId: k.familyId, text: key, tagId })
				.onConflictDoUpdate({
					target: [expenseTagRule.familyId, expenseTagRule.text],
					set: { tagId }
				});
		// The ones left with no line.
		await tx.delete(expenseTag).where(
			notExists(
				tx
					.select({ one: sql`1` })
					.from(expenseTagRule)
					.where(
						and(
							eq(expenseTagRule.tagId, expenseTag.id),
							eq(expenseTagRule.familyId, expenseTag.familyId)
						)
					)
			)
		);
		return true;
	});
}

/**
 * The expenses with a line of that tag between two days (both included, either may be missing):
 * their ids. The key made here, as the page makes it (lineKey), not in SQL.
 */
export const taggedExpenseIds = (
	k: Kitchen,
	tagId: number,
	{ from, to }: { from: string | null; to: string | null }
): Promise<number[]> =>
	k.run(async (tx) => {
		const texts = new Set(
			(
				await tx
					.select({ text: expenseTagRule.text })
					.from(expenseTagRule)
					.where(eq(expenseTagRule.tagId, tagId))
			).map((r) => r.text)
		);
		if (!texts.size) return [];
		const lines = await tx
			.select({ expenseId: expenseLine.expenseId, text: expenseLine.text })
			.from(expenseLine)
			.innerJoin(
				expense,
				and(eq(expense.familyId, expenseLine.familyId), eq(expense.id, expenseLine.expenseId))
			)
			.where(
				and(from ? gte(expense.date, from) : undefined, to ? lte(expense.date, to) : undefined)
			);
		return [...new Set(lines.filter((l) => texts.has(lineKey(l.text))).map((l) => l.expenseId))];
	});
