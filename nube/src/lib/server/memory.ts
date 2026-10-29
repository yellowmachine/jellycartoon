import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { memory } from '#lib/server/db/schema.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { pickLearned, wordsOf } from '#lib/server/voice/learned.ts';

/**
 * What the family asks the voice to remember (phase 1): «recuerda que la llave de
 * repuesto está en la maceta», and later «¿dónde está la llave?». Each person's, seen only by them
 * (not even by the family's administrator); the house's, by everyone. Found before the model by
 * the words of the order, as what the voice learned (voice/learned.ts): a family has a few dozen.
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
	updatedAt: Date;
}

const COLUMNS = {
	id: memory.id,
	userId: memory.userId,
	text: memory.text,
	words: memory.words,
	updatedAt: memory.updatedAt
};

/** The house's, and this person's if any: never another's. */
const visibleTo = (userId: string | null) =>
	userId ? or(isNull(memory.userId), eq(memory.userId, userId)) : isNull(memory.userId);

/** What `userId` may see (null, a satellite: only the house's), newest first. */
export async function listMemories(k: Kitchen, userId: string | null): Promise<Memory[]> {
	return k.run((tx) =>
		tx
			.select(COLUMNS)
			.from(memory)
			.where(and(eq(memory.familyId, k.familyId), visibleTo(userId)))
			.orderBy(desc(memory.updatedAt))
	);
}

/** Kept, for `userId` (null, the house). Its id; null if empty. */
export async function remember(k: Kitchen, userId: string | null, text: string) {
	const clean = text.trim().slice(0, MAX_MEMORY);
	if (!clean) return null;
	const [row] = await k.run((tx) =>
		tx
			.insert(memory)
			.values({ familyId: k.familyId, userId, text: clean, words: [...new Set(wordsOf(clean))] })
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

/** As the voice is told it: «12 (tuyo): …», «13 (de la casa): …». */
const line = (m: Memory) => `${m.id} (${m.userId ? 'suyo' : 'de la casa'}): ${m.text}`;

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
	const all = await listMemories(k, userId);
	return all.length
		? `Lo que recuerdas: ${all.map(line).join(' · ')}`
		: 'No te han pedido recordar nada todavía.';
}
