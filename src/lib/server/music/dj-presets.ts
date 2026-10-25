import { and, asc, eq, ne } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { djPreset } from '#lib/server/db/schema.ts';
import type { DjOptions } from '#lib/music.ts';

/** A person's saved Modo DJ setups (#117), by name. */
export function presetsOf(userId: string) {
	return db
		.select({ id: djPreset.id, name: djPreset.name, options: djPreset.options })
		.from(djPreset)
		.where(eq(djPreset.userId, userId))
		.orderBy(asc(djPreset.name));
}

/**
 * A new one without `id`, else that one changed. Null if the person already has another one with
 * that name; the id saved otherwise.
 */
export async function savePreset(
	userId: string,
	id: number | null,
	name: string,
	options: DjOptions
): Promise<number | null> {
	const [taken] = await db
		.select({ id: djPreset.id })
		.from(djPreset)
		.where(
			and(
				eq(djPreset.userId, userId),
				eq(djPreset.name, name),
				id === null ? undefined : ne(djPreset.id, id)
			)
		);
	if (taken) return null;
	if (id === null) {
		const [row] = await db
			.insert(djPreset)
			.values({ userId, name, options })
			.returning({ id: djPreset.id });
		return row.id;
	}
	await db
		.update(djPreset)
		.set({ name, options })
		.where(and(eq(djPreset.id, id), eq(djPreset.userId, userId)));
	return id;
}

export async function deletePreset(userId: string, id: number) {
	await db.delete(djPreset).where(and(eq(djPreset.id, id), eq(djPreset.userId, userId)));
}
