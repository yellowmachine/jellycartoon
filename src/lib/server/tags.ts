import { fail } from '@sveltejs/kit';
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

/**
 * Piloto de Electric (#394): con ELECTRIC_REPLICA, `tag` y `series_tag` son una copia de solo
 * lectura de Seilide. Se escribe allí y vuelve por Electric (replica.ts, que pone `cloud` al
 * arrancar), así que se espera a verlo aquí antes de contestar. Las de películas y accesos siguen
 * en esta base.
 */
export interface TagsCloud {
	ask<T>(body: Record<string, unknown>): Promise<T>;
	problem(message: string): Error;
	isProblem(error: unknown): boolean;
	note(message: string): void;
}

let cloud: TagsCloud | null = null;

export const useCloudTags = (it: TagsCloud | null) => {
	cloud = it;
};

export const tagsAreReplicated = () => cloud !== null;

const ARRIVAL_MS = 5_000;

/** Hasta que se cumple aquí lo que se acaba de escribir en Seilide. */
async function untilHere(it: TagsCloud, what: string, check: () => Promise<boolean>) {
	const start = Date.now();
	while (Date.now() - start < ARRIVAL_MS) {
		if (await check()) {
			it.note(`${what}: aquí en ${Date.now() - start} ms`);
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw it.problem('Guardado en Seilide, pero aún no ha llegado a la casa: recarga en un rato');
}

const tagHere = (id: number) => async () =>
	(await db.select({ id: tag.id }).from(tag).where(eq(tag.id, id))).length > 0;
const tagGone = (id: number) => async () => !(await tagHere(id)());
const seriesTagHere = (seriesId: number, tagId: number) => async () =>
	(
		await db
			.select({ id: seriesTag.tagId })
			.from(seriesTag)
			.where(and(eq(seriesTag.seriesId, seriesId), eq(seriesTag.tagId, tagId)))
	).length > 0;

/** Si la sigue usando algo que está en esta base: Seilide no lo sabe. */
async function usedHere(tagId: number) {
	const [row] = await db
		.select({
			used: sql<boolean>`exists (select 1 from ${movieTag} where ${movieTag.tagId} = ${tagId})
				or exists (select 1 from ${tvShortcutTag} where ${tvShortcutTag.tagId} = ${tagId})`
		})
		.from(sql`(select 1) as uno`);
	return row.used;
}

/** Los ids de estas etiquetas, creándolas en Seilide y esperando a tenerlas aquí. */
export async function ensureTagsHere(names: string[]) {
	const it = cloud;
	if (!it || !names.length) return [];
	const { tags } = await it.ask<{ tags: { id: number; name: string }[] }>({
		action: 'ensure',
		names
	});
	for (const t of tags) await untilHere(it, `etiqueta ${t.id}`, tagHere(t.id));
	return tags;
}

/** Estas etiquetas, en Seilide, si ya no las usa nada: tras quitarlas de un acceso o una película. */
export async function releaseTagsHere(tagIds: number[]) {
	for (const tagId of tagIds)
		await cloud?.ask({ action: 'release', tagId, usedHere: await usedHere(tagId) });
}

/** Sin Seilide no se puede cambiar una etiqueta: un mensaje en el formulario, no un error. */
export async function orCloudFail<T>(write: () => Promise<T>, extra: Record<string, unknown> = {}) {
	try {
		return await write();
	} catch (error) {
		if (!cloud?.isProblem(error)) throw error;
		return fail(503, { ...extra, message: (error as Error).message });
	}
}

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
	if (cloud) {
		const { tag: t } = await cloud.ask<{ tag: { id: number } }>({ action: 'link', seriesId, name });
		await untilHere(cloud, `serie ${seriesId}`, seriesTagHere(seriesId, t.id));
		return;
	}
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
	if (cloud) return; // Se hace después, en Seilide (releaseTagsHere).
	for (const id of tagIds) await deleteIfUnused(tx, id);
}

export async function removeSeriesTag(seriesId: number, tagId: number) {
	if (cloud) {
		await cloud.ask({ action: 'unlink', seriesId, tagId, usedHere: await usedHere(tagId) });
		const here = seriesTagHere(seriesId, tagId);
		await untilHere(cloud, `serie ${seriesId}`, async () => !(await here()));
		return;
	}
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
	if (cloud) {
		const [t] = await ensureTagsHere([name]);
		await db.insert(movieTag).values({ movieId, tagId: t.id }).onConflictDoNothing();
		return;
	}
	await db.transaction(async (tx) => {
		await tx.insert(tag).values({ name }).onConflictDoNothing();
		const [t] = await tx.select({ id: tag.id }).from(tag).where(eq(tag.name, name));
		await tx.insert(movieTag).values({ movieId, tagId: t.id }).onConflictDoNothing();
	});
}

export async function removeMovieTag(movieId: number, tagId: number) {
	if (cloud) {
		await db.delete(movieTag).where(and(eq(movieTag.movieId, movieId), eq(movieTag.tagId, tagId)));
		await releaseTagsHere([tagId]);
		return;
	}
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
	if (cloud) {
		const other = await otherTagNamed(tagId, name);
		// Lo de esta base, antes: al llegar el borrado de esta, se iría con ella en cascada.
		if (other) await moveLocalLinks(tagId, other.id);
		const { mergedInto } = await cloud.ask<{ mergedInto: number | null }>({
			action: 'rename',
			tagId,
			name
		});
		if (mergedInto) {
			await moveLocalLinks(tagId, mergedInto);
			await untilHere(cloud, `etiqueta ${tagId}`, tagGone(tagId));
		} else {
			await untilHere(
				cloud,
				`etiqueta ${tagId}`,
				async () =>
					(await db.select({ name: tag.name }).from(tag).where(eq(tag.id, tagId)))[0]?.name === name
			);
		}
		return;
	}
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

/** Lo de esta base, de una etiqueta a otra. */
async function moveLocalLinks(from: number, to: number) {
	await db.transaction(async (tx) => {
		await tx
			.insert(movieTag)
			.select(
				tx
					.select({ movieId: movieTag.movieId, tagId: sql<number>`${to}::int`.as('tag_id') })
					.from(movieTag)
					.where(eq(movieTag.tagId, from))
			)
			.onConflictDoNothing();
		await tx
			.insert(tvShortcutTag)
			.select(
				tx
					.select({
						shortcutId: tvShortcutTag.shortcutId,
						tagId: sql<number>`${to}::int`.as('tag_id')
					})
					.from(tvShortcutTag)
					.where(eq(tvShortcutTag.tagId, from))
			)
			.onConflictDoNothing();
	});
}

/** From every series and film. */
export async function deleteTag(tagId: number) {
	if (cloud) {
		await cloud.ask({ action: 'delete', tagId });
		await untilHere(cloud, `etiqueta ${tagId}`, tagGone(tagId));
		return;
	}
	await db.delete(tag).where(eq(tag.id, tagId));
}
