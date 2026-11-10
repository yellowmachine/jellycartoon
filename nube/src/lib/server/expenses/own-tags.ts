import { and, asc, eq, gte, inArray, lte, notExists, sql } from 'drizzle-orm';
import { expense, expenseLine, expenseTag, expenseTagRule } from '#lib/server/db/schema.ts';
import type { AnyDb } from '#lib/server/family-scope.ts';
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

/** A tag's name as kept: its spaces one, at most TAG_NAME_MAX. */
const cleanName = (name: string) => name.replace(/\s+/g, ' ').trim().slice(0, TAG_NAME_MAX);

/** The tags left with no rule, deleted. */
const dropUnused = (tx: AnyDb) =>
	tx.delete(expenseTag).where(
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

/**
 * Every line with any of `texts` has that tag from now on, or none. A name already there (case and
 * accents aside) is that tag, not another. False: no text or an empty name, or a tag not there.
 */
export function tagLines(k: Kitchen, texts: string[], choice: TagChoice): Promise<boolean> {
	const keys = [...new Set(texts.map(lineKey).filter(Boolean))];
	if (!keys.length) return Promise.resolve(false);
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
			const name = cleanName(choice.name);
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
		if (tagId === null) await tx.delete(expenseTagRule).where(inArray(expenseTagRule.text, keys));
		else
			await tx
				.insert(expenseTagRule)
				.values(keys.map((text) => ({ familyId: k.familyId, text, tagId })))
				.onConflictDoUpdate({
					target: [expenseTagRule.familyId, expenseTagRule.text],
					set: { tagId }
				});
		await dropUnused(tx);
		return true;
	});
}

/** The same, for the lines with one text. */
export const tagLine = (k: Kitchen, text: string, choice: TagChoice) => tagLines(k, [text], choice);

/**
 * Its new name; another's (case and accents aside), the two become that one, with all their lines.
 * False: an empty name, or a tag not there.
 */
export function renameTag(k: Kitchen, id: number, name: string): Promise<boolean> {
	const clean = cleanName(name);
	if (!lineKey(clean)) return Promise.resolve(false);
	return k.run(async (tx) => {
		const tags = await tx.select().from(expenseTag);
		if (!tags.some((t) => t.id === id)) return false;
		const other = tags.find((t) => t.id !== id && lineKey(t.name) === lineKey(clean));
		if (other) {
			await tx.update(expenseTagRule).set({ tagId: other.id }).where(eq(expenseTagRule.tagId, id));
			await dropUnused(tx);
		} else await tx.update(expenseTag).set({ name: clean }).where(eq(expenseTag.id, id));
		return true;
	});
}

/** Gone, and its lines with no own tag. */
export const deleteTag = (k: Kitchen, id: number) =>
	k.run((tx) => tx.delete(expenseTag).where(eq(expenseTag.id, id)));

/** Each text of the family's lines (#459, to tag many at once): as lineKey leaves it. */
export interface LineText {
	key: string;
	/** As written the most times. */
	text: string;
	/** How many lines, and what they add up to. */
	count: number;
	total: number;
	/** The last day it was bought. */
	last: string;
}

/** All of them: the most bought first. */
export const lineTexts = (k: Kitchen): Promise<LineText[]> =>
	k.run(async (tx) => {
		const lines = await tx
			.select({ text: expenseLine.text, amount: expenseLine.amount, date: expense.date })
			.from(expenseLine)
			.innerJoin(
				expense,
				and(eq(expense.familyId, expenseLine.familyId), eq(expense.id, expenseLine.expenseId))
			);
		const byKey = new Map<string, LineText & { written: Map<string, number> }>();
		for (const l of lines) {
			const key = lineKey(l.text);
			if (!key) continue;
			const t = byKey.get(key) ?? {
				key,
				text: l.text.trim(),
				count: 0,
				total: 0,
				last: l.date,
				written: new Map<string, number>()
			};
			t.count++;
			t.total += l.amount;
			if (l.date > t.last) t.last = l.date;
			const written = l.text.replace(/\s+/g, ' ').trim();
			t.written.set(written, (t.written.get(written) ?? 0) + 1);
			byKey.set(key, t);
		}
		return [...byKey.values()]
			.map(({ written, ...t }) => ({
				...t,
				text: [...written].sort((a, b) => b[1] - a[1])[0][0]
			}))
			.sort((a, b) => b.count - a.count || b.last.localeCompare(a.last));
	});

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

/** An own tag's lines by month (#459, in Análisis): `YYYY-MM` → cents. */
export interface TagMonths {
	id: number;
	name: string;
	months: Record<string, number>;
	total: number;
}

/**
 * Each own tag's lines by month from `since` (a day) on, the largest first; those with nothing in
 * it too, at 0, so a tag just made is there. The key made here, as the page makes it (lineKey).
 */
export const tagMonths = (k: Kitchen, since: string): Promise<TagMonths[]> =>
	k.run(async (tx) => {
		const [tags, rules, lines] = await Promise.all([
			tx.select({ id: expenseTag.id, name: expenseTag.name }).from(expenseTag),
			tx.select({ text: expenseTagRule.text, tagId: expenseTagRule.tagId }).from(expenseTagRule),
			tx
				.select({ text: expenseLine.text, amount: expenseLine.amount, date: expense.date })
				.from(expenseLine)
				.innerJoin(
					expense,
					and(eq(expense.familyId, expenseLine.familyId), eq(expense.id, expenseLine.expenseId))
				)
				.where(gte(expense.date, since))
		]);
		const ruleOf = new Map(rules.map((r) => [r.text, r.tagId]));
		const byTag = new Map<number, TagMonths>(
			tags.map((t) => [t.id, { ...t, months: {}, total: 0 }])
		);
		for (const l of lines) {
			const id = ruleOf.get(lineKey(l.text));
			const t = id === undefined ? undefined : byTag.get(id);
			if (!t) continue;
			const month = l.date.slice(0, 7);
			t.months[month] = (t.months[month] ?? 0) + l.amount;
			t.total += l.amount;
		}
		return [...byTag.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
	});
