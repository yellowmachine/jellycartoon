import { and, eq, inArray, ne, notExists, sql } from 'drizzle-orm';
import { seriesTag, tag } from './db/schema.ts';
import type { AnyDb } from './family-scope.ts';

/**
 * Piloto de Electric (#394): lo que la casa escribe en sus etiquetas, siempre dentro de `asFamily`,
 * con RLS. Las de películas y accesos siguen en la casa, y aquí no se ven: por eso, antes de borrar
 * una etiqueta sin series, la casa dice si la sigue usando (`usedHere`).
 */

/** Trimmed and lowercase, so the same tag is not written two ways. */
export const tagName = (name: string) => name.trim().replace(/\s+/g, ' ').toLocaleLowerCase();

/** Las etiquetas con estos nombres, creando las que falten. */
export async function ensureTags(tx: AnyDb, familyId: string, names: string[]) {
	if (!names.length) return [];
	await tx
		.insert(tag)
		.values(names.map((name) => ({ familyId, name })))
		.onConflictDoNothing();
	return tx.select({ id: tag.id, name: tag.name }).from(tag).where(inArray(tag.name, names));
}

export async function linkSeries(tx: AnyDb, familyId: string, seriesId: number, name: string) {
	const [t] = await ensureTags(tx, familyId, [name]);
	await tx.insert(seriesTag).values({ familyId, seriesId, tagId: t.id }).onConflictDoNothing();
	return t;
}

/** Fuera, si ya no la tiene ninguna serie ni la usa la casa. */
export async function releaseTag(tx: AnyDb, tagId: number, usedHere: boolean) {
	if (usedHere) return;
	await tx
		.delete(tag)
		.where(
			and(
				eq(tag.id, tagId),
				notExists(tx.select().from(seriesTag).where(eq(seriesTag.tagId, tagId)))
			)
		);
}

export async function unlinkSeries(tx: AnyDb, seriesId: number, tagId: number, usedHere: boolean) {
	await tx
		.delete(seriesTag)
		.where(and(eq(seriesTag.seriesId, seriesId), eq(seriesTag.tagId, tagId)));
	await releaseTag(tx, tagId, usedHere);
}

/** La renombra; si ya hay otra con ese nombre, sus series pasan a esa y esta se va. */
export async function renameTag(tx: AnyDb, familyId: string, tagId: number, name: string) {
	const [other] = await tx
		.select({ id: tag.id })
		.from(tag)
		.where(and(eq(tag.name, name), ne(tag.id, tagId)));
	if (!other) {
		await tx.update(tag).set({ name }).where(eq(tag.id, tagId));
		return { mergedInto: null };
	}
	await tx
		.insert(seriesTag)
		.select(
			tx
				.select({
					familyId: sql<string>`${familyId}`.as('family_id'),
					seriesId: seriesTag.seriesId,
					tagId: sql<number>`${other.id}::int`.as('tag_id')
				})
				.from(seriesTag)
				.where(eq(seriesTag.tagId, tagId))
		)
		.onConflictDoNothing();
	await tx.delete(tag).where(eq(tag.id, tagId));
	return { mergedInto: other.id };
}

export const deleteTag = (tx: AnyDb, tagId: number) => tx.delete(tag).where(eq(tag.id, tagId));
