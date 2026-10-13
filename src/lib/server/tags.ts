import { and, asc, eq, notExists, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { seriesTag, tag } from '#lib/server/db/schema.ts';

/** Trimmed and lowercase, so the same tag is not written two ways. */
export function tagName(name: string) {
	return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

/** Every tag, with how many series have it. */
export async function getTags() {
	return db
		.select({ id: tag.id, name: tag.name, series: sql<number>`count(${seriesTag.seriesId})::int` })
		.from(tag)
		.leftJoin(seriesTag, eq(seriesTag.tagId, tag.id))
		.groupBy(tag.id)
		.orderBy(asc(tag.name));
}

export async function seriesTags(seriesId: number) {
	return db
		.select({ id: tag.id, name: tag.name })
		.from(seriesTag)
		.innerJoin(tag, eq(tag.id, seriesTag.tagId))
		.where(eq(seriesTag.seriesId, seriesId))
		.orderBy(asc(tag.name));
}

/** Creates the tag if it does not exist yet. */
export async function addSeriesTag(seriesId: number, name: string) {
	await db.transaction(async (tx) => {
		await tx.insert(tag).values({ name }).onConflictDoNothing();
		const [t] = await tx.select({ id: tag.id }).from(tag).where(eq(tag.name, name));
		await tx.insert(seriesTag).values({ seriesId, tagId: t.id }).onConflictDoNothing();
	});
}

/** A tag no series has any more is deleted, so it is not suggested again. */
export async function removeSeriesTag(seriesId: number, tagId: number) {
	await db.transaction(async (tx) => {
		await tx
			.delete(seriesTag)
			.where(and(eq(seriesTag.seriesId, seriesId), eq(seriesTag.tagId, tagId)));
		await tx
			.delete(tag)
			.where(
				and(
					eq(tag.id, tagId),
					notExists(tx.select().from(seriesTag).where(eq(seriesTag.tagId, tagId)))
				)
			);
	});
}
