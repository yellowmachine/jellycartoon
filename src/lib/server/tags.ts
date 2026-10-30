import { and, asc, eq, ne, notExists, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	movie,
	movieTag,
	movieTitle,
	series,
	seriesTag,
	tag,
	tvShortcutTag
} from '#lib/server/db/schema.ts';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

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

/**
 * A tag no series, film nor TV shortcut (#327) has any more is deleted, so it is not suggested
 * again.
 */
async function deleteIfUnused(tx: Tx, tagId: number) {
	await tx
		.delete(tag)
		.where(
			and(
				eq(tag.id, tagId),
				notExists(tx.select().from(seriesTag).where(eq(seriesTag.tagId, tagId))),
				notExists(tx.select().from(movieTag).where(eq(movieTag.tagId, tagId))),
				notExists(tx.select().from(tvShortcutTag).where(eq(tvShortcutTag.tagId, tagId)))
			)
		);
}

/** Those of these tags nothing has any more, deleted. */
export async function deleteUnusedTags(tx: Tx, tagIds: number[]) {
	for (const id of tagIds) await deleteIfUnused(tx, id);
}

export async function removeSeriesTag(seriesId: number, tagId: number) {
	await db.transaction(async (tx) => {
		await tx
			.delete(seriesTag)
			.where(and(eq(seriesTag.seriesId, seriesId), eq(seriesTag.tagId, tagId)));
		await deleteIfUnused(tx, tagId);
	});
}

export async function movieTags(movieId: number) {
	return db
		.select({ id: tag.id, name: tag.name })
		.from(movieTag)
		.innerJoin(tag, eq(tag.id, movieTag.tagId))
		.where(eq(movieTag.movieId, movieId))
		.orderBy(asc(tag.name));
}

/** Creates the tag if it does not exist yet. */
export async function addMovieTag(movieId: number, name: string) {
	await db.transaction(async (tx) => {
		await tx.insert(tag).values({ name }).onConflictDoNothing();
		const [t] = await tx.select({ id: tag.id }).from(tag).where(eq(tag.name, name));
		await tx.insert(movieTag).values({ movieId, tagId: t.id }).onConflictDoNothing();
	});
}

export async function removeMovieTag(movieId: number, tagId: number) {
	await db.transaction(async (tx) => {
		await tx.delete(movieTag).where(and(eq(movieTag.movieId, movieId), eq(movieTag.tagId, tagId)));
		await deleteIfUnused(tx, tagId);
	});
}

/** Every tag with its series and films, to manage them. */
export async function getTagsWithItems() {
	const [tags, seriesRows, movieRows] = await Promise.all([
		db.select({ id: tag.id, name: tag.name }).from(tag).orderBy(asc(tag.name)),
		db
			.select({ tagId: seriesTag.tagId, id: series.id, title: series.title })
			.from(seriesTag)
			.innerJoin(series, eq(series.id, seriesTag.seriesId))
			.orderBy(asc(series.title)),
		db
			.select({ tagId: movieTag.tagId, id: movie.id, title: movieTitle })
			.from(movieTag)
			.innerJoin(movie, eq(movie.id, movieTag.movieId))
			.orderBy(asc(movieTitle))
	]);
	const items = (rows: { tagId: number; id: number; title: string }[], tagId: number) =>
		rows.filter((r) => r.tagId === tagId).map(({ id, title }) => ({ id, title }));
	return tags.map((t) => ({
		...t,
		series: items(seriesRows, t.id),
		films: items(movieRows, t.id)
	}));
}

/** Another tag already called `name`, which renaming to it would merge with. */
export async function otherTagNamed(tagId: number, name: string) {
	const [other] = await db
		.select({
			id: tag.id,
			series: sql<number>`(select count(*) from ${seriesTag} where ${seriesTag.tagId} = ${tag.id})::int`,
			films: sql<number>`(select count(*) from ${movieTag} where ${movieTag.tagId} = ${tag.id})::int`
		})
		.from(tag)
		.where(and(eq(tag.name, name), ne(tag.id, tagId)));
	return other;
}

/**
 * Renames the tag everywhere; if another tag already has that name, its series and films get this one's and
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
		await tx
			.insert(movieTag)
			.select(
				tx
					.select({
						movieId: movieTag.movieId,
						tagId: sql<number>`${other.id}::int`.as('tag_id')
					})
					.from(movieTag)
					.where(eq(movieTag.tagId, tagId))
			)
			.onConflictDoNothing();
		await tx
			.insert(tvShortcutTag)
			.select(
				tx
					.select({
						shortcutId: tvShortcutTag.shortcutId,
						tagId: sql<number>`${other.id}::int`.as('tag_id')
					})
					.from(tvShortcutTag)
					.where(eq(tvShortcutTag.tagId, tagId))
			)
			.onConflictDoNothing();
		// Its series_tag, movie_tag and tv_shortcut_tag rows go with it (on delete cascade).
		await tx.delete(tag).where(eq(tag.id, tagId));
	});
}

/** From every series and film. */
export async function deleteTag(tagId: number) {
	await db.delete(tag).where(eq(tag.id, tagId));
}
