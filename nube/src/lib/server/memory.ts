import { and, desc, eq, gte, inArray, isNull, lt, lte, or } from 'drizzle-orm';
import { localDay } from 'comun/agenda.ts';
import { memory } from '#lib/server/db/schema.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { ruleEvent } from '#lib/server/rule-events.ts';
import { pickLearned, wordsOf } from '#lib/server/voice/learned.ts';

/**
 * What the family asks the voice to remember (phase 1): «recuerda que la llave de
 * repuesto está en la maceta», and later «¿dónde está la llave?». Each person's, seen only by them
 * (not even by the family's administrator); the house's, by everyone. Found before the model by
 * the words of the order, as what the voice learned (voice/learned.ts): a family has a few dozen.
 * Some only for a while (#331): «hasta el viernes, el coche está en el taller» is told from its
 * first day to its last, and then forgotten.
 */

export const MAX_MEMORY = 300;
/** More than this and the oldest go: a family's notebook, not an archive. */
const MAX_MEMORIES = 500;

export interface Memory {
	id: number;
	/** Null: the house's. */
	userId: string | null;
	text: string;
	words: string[];
	/** Its first and last days; null, from now and for good. */
	fromDay: string | null;
	untilDay: string | null;
	updatedAt: Date;
}

/** Its days, when it has them: from YYYY-MM-DD, until YYYY-MM-DD (each optional). */
export interface MemoryDays {
	fromDay?: string | null;
	untilDay?: string | null;
}

const COLUMNS = {
	id: memory.id,
	userId: memory.userId,
	text: memory.text,
	words: memory.words,
	fromDay: memory.fromDay,
	untilDay: memory.untilDay,
	updatedAt: memory.updatedAt
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const dayOrNull = (day: string | null | undefined) => (day && DAY.test(day) ? day : null);

/** Not over yet; with `today`, begun too. */
const current = (today: string, begun: boolean) =>
	and(
		or(isNull(memory.untilDay), gte(memory.untilDay, today)),
		begun ? or(isNull(memory.fromDay), lte(memory.fromDay, today)) : undefined
	);

/** The house's, and this person's if any: never another's. */
const visibleTo = (userId: string | null) =>
	userId ? or(isNull(memory.userId), eq(memory.userId, userId)) : isNull(memory.userId);

/**
 * What `userId` may see (null, a satellite: only the house's), newest first: what holds today, or
 * with `later`, what is still to begin too (Ajustes).
 */
export async function listMemories(
	k: Kitchen,
	userId: string | null,
	later = false
): Promise<Memory[]> {
	return k.run((tx) =>
		tx
			.select(COLUMNS)
			.from(memory)
			.where(and(eq(memory.familyId, k.familyId), visibleTo(userId), current(localDay(), !later)))
			.orderBy(desc(memory.updatedAt))
	);
}

/** What has had its last day: forgotten (at midnight, scheduler.ts). How many. */
export async function forgetOver(k: Kitchen) {
	const gone = await k.run((tx) =>
		tx
			.delete(memory)
			.where(and(eq(memory.familyId, k.familyId), lt(memory.untilDay, localDay())))
			.returning({ id: memory.id })
	);
	return gone.length;
}

/** Kept, for `userId` (null, the house), maybe for some days only. Its id; null if empty. */
export async function remember(
	k: Kitchen,
	userId: string | null,
	text: string,
	days: MemoryDays = {}
) {
	const clean = text.trim().slice(0, MAX_MEMORY);
	if (!clean) return null;
	const fromDay = dayOrNull(days.fromDay);
	let untilDay = dayOrNull(days.untilDay);
	// Over before it begins: the order said the other way round.
	if (fromDay && untilDay && untilDay < fromDay) untilDay = null;
	const [row] = await k.run((tx) =>
		tx
			.insert(memory)
			.values({
				familyId: k.familyId,
				userId,
				text: clean,
				words: [...new Set(wordsOf(clean))],
				fromDay,
				untilDay
			})
			.returning({ id: memory.id })
	);
	const all = await k.run((tx) =>
		tx
			.select({ id: memory.id })
			.from(memory)
			.where(eq(memory.familyId, k.familyId))
			.orderBy(desc(memory.updatedAt))
			.offset(MAX_MEMORIES)
	);
	if (all.length)
		await k.run((tx) =>
			tx.delete(memory).where(
				inArray(
					memory.id,
					all.map((r) => r.id)
				)
			)
		);
	// The rules that wait for it (#331).
	ruleEvent(k, 'recuerdo', clean, userId);
	return row!.id;
}

/** Forgotten, if `userId` may see it: the house's, or their own. Its text; null if none. */
export async function forget(k: Kitchen, userId: string | null, id: number) {
	const [gone] = await k.run((tx) =>
		tx
			.delete(memory)
			.where(and(eq(memory.familyId, k.familyId), eq(memory.id, id), visibleTo(userId)))
			.returning({ text: memory.text })
	);
	return gone?.text ?? null;
}

/** As the voice is told it: «12 (suyo): …», «13 (de la casa, hasta el 2026-11-06): …». */
const line = (m: Memory) => {
	const days = [
		m.fromDay ? `desde el ${m.fromDay}` : null,
		m.untilDay ? `hasta el ${m.untilDay}` : null
	].filter(Boolean);
	return `${m.id} (${[m.userId ? 'suyo' : 'de la casa', ...days].join(', ')}): ${m.text}`;
};

/** For the order's message: what was asked to be remembered that may matter; null if nothing. */
export async function recallMemories(k: Kitchen, userId: string | null, said: string) {
	const all = await listMemories(k, userId);
	const picked = pickLearned(
		all.map((m) => ({ ...m, title: m.text })),
		said
	);
	if (!picked.length) return null;
	return `[Lo que te han pedido recordar, por su número (puede que nada venga al caso; úsalo para contestar, sin decirlo si no lo pregunta): ${picked.map(line).join(' · ')}]`;
}

/** For «¿qué te he pedido que recuerde?»: all of it, as the voice is told it. */
export async function describeMemories(k: Kitchen, userId: string | null) {
	const all = await listMemories(k, userId, true);
	return all.length
		? `Lo que recuerdas: ${all.map(line).join(' · ')}`
		: 'No te han pedido recordar nada todavía.';
}
