import { and, asc, eq, ne, notExists, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { series, seriesTag, tag } from '#lib/server/db/schema.ts';

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

/** Every tag with its series, to manage them. */
export async function getTagsWithSeries() {
	const rows = await db
		.select({
			id: tag.id,
			name: tag.name,
			seriesId: series.id,
			seriesTitle: series.title
		})
		.from(tag)
		.leftJoin(seriesTag, eq(seriesTag.tagId, tag.id))
		.leftJoin(series, eq(series.id, seriesTag.seriesId))
		.orderBy(asc(tag.name), asc(series.title));
	const tags = new Map<
		number,
		{ id: number; name: string; series: { id: number; title: string }[] }
	>();
	for (const r of rows) {
		const t = tags.get(r.id) ?? { id: r.id, name: r.name, series: [] };
		tags.set(r.id, t);
		if (r.seriesId !== null) t.series.push({ id: r.seriesId, title: r.seriesTitle! });
	}
	return [...tags.values()];
}

/** Another tag already called `name`, which renaming to it would merge with. */
export async function otherTagNamed(tagId: number, name: string) {
	const [other] = await db
		.select({
			id: tag.id,
			series: sql<number>`(select count(*) from ${seriesTag} where ${seriesTag.tagId} = ${tag.id})::int`
		})
		.from(tag)
		.where(and(eq(tag.name, name), ne(tag.id, tagId)));
	return other;
}

/**
 * Renames the tag everywhere; if another tag already has that name, its series get this one's and
 * this one goes away: the way to fix a tag written two ways.
 */
export async function renameTag(tagId: number, name: string) {
	await db.transaction(async (tx) => {
		const [other] = await tx
			.select({ id: tag.id })
			.from(tag)
			.where(and(eq(tag.name, name), ne(tag.id, tagId)));
		if (!other) {
			await tx.update(tag).set({ name }).where(eq(tag.id, tagId));
			return;
		}
		await tx
			.insert(seriesTag)
			.select(
				tx
					.select({
						seriesId: seriesTag.seriesId,
						tagId: sql<number>`${other.id}::int`.as('tag_id')
					})
					.from(seriesTag)
					.where(eq(seriesTag.tagId, tagId))
			)
			.onConflictDoNothing();
		// Its series_tag rows go with it (on delete cascade).
		await tx.delete(tag).where(eq(tag.id, tagId));
	});
}

/** From every series. */
export async function deleteTag(tagId: number) {
	await db.delete(tag).where(eq(tag.id, tagId));
}
