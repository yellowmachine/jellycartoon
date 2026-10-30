import { and, asc, eq, exists, inArray, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { tag, tvShortcut, tvShortcutTag } from '#lib/server/db/schema.ts';
import { KIDS_TAG } from '#lib/kids-tag.ts';
import { deleteUnusedTags, tagName } from '#lib/server/tags.ts';

/**
 * The TV view's shortcuts to sites of elsewhere (#327): made in Ajustes → Casa, each with its tags;
 * a child's account sees only those tagged «infantil», as with series and films.
 */

export interface TvShortcut {
	id: number;
	name: string;
	url: string;
	tags: string[];
}

/** A `where` condition: the shortcut is one of the children's. */
const forKids = exists(
	db
		.select({ one: sql`1` })
		.from(tvShortcutTag)
		.innerJoin(tag, eq(tag.id, tvShortcutTag.tagId))
		.where(and(eq(tvShortcutTag.shortcutId, tvShortcut.id), eq(tag.name, KIDS_TAG)))
);

/** Every shortcut, by name; for a child, only the children's. */
export async function tvShortcuts(kid: boolean): Promise<TvShortcut[]> {
	const rows = await db
		.select({ id: tvShortcut.id, name: tvShortcut.name, url: tvShortcut.url })
		.from(tvShortcut)
		.where(kid ? forKids : undefined)
		.orderBy(asc(tvShortcut.name));
	if (!rows.length) return [];
	const tags = await db
		.select({ shortcutId: tvShortcutTag.shortcutId, name: tag.name })
		.from(tvShortcutTag)
		.innerJoin(tag, eq(tag.id, tvShortcutTag.tagId))
		.where(
			inArray(
				tvShortcutTag.shortcutId,
				rows.map((r) => r.id)
			)
		)
		.orderBy(asc(tag.name));
	return rows.map((r) => ({
		...r,
		tags: tags.filter((t) => t.shortcutId === r.id).map((t) => t.name)
	}));
}

/** One the user may open: for a child, only a children's one. */
export async function openableShortcut(id: number, kid: boolean) {
	return (await tvShortcuts(kid)).find((s) => s.id === id) ?? null;
}

/** «Infantil, deportes» → its tags, each written once. */
export function parseTags(text: string) {
	return [...new Set(text.split(',').map(tagName).filter(Boolean))];
}

/** Only a site's address, with https (or http, on the house's network). */
export function shortcutUrl(text: string) {
	let url: URL;
	try {
		url = new URL(text.trim());
	} catch {
		throw new Error('Escribe la dirección completa, con https://');
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:')
		throw new Error('Escribe la dirección completa, con https://');
	return url.href;
}

/** New, or changed: its name, address and tags (those it no longer has, gone if nothing else has them). */
export async function saveTvShortcut(s: { id?: number; name: string; url: string; tags: string }) {
	const name = s.name.trim().slice(0, 40);
	if (!name) throw new Error('Ponle un nombre');
	const url = shortcutUrl(s.url);
	const tags = parseTags(s.tags);
	await db.transaction(async (tx) => {
		let id = s.id;
		if (id) {
			const [found] = await tx
				.update(tvShortcut)
				.set({ name, url })
				.where(eq(tvShortcut.id, id))
				.returning({ id: tvShortcut.id });
			if (!found) throw new Error('Ese acceso directo ya no está');
		} else {
			[{ id }] = await tx.insert(tvShortcut).values({ name, url }).returning({ id: tvShortcut.id });
		}
		const before = await tx
			.select({ tagId: tvShortcutTag.tagId })
			.from(tvShortcutTag)
			.where(eq(tvShortcutTag.shortcutId, id!));
		await tx.delete(tvShortcutTag).where(eq(tvShortcutTag.shortcutId, id!));
		if (tags.length) {
			await tx
				.insert(tag)
				.values(tags.map((n) => ({ name: n })))
				.onConflictDoNothing();
			const ids = await tx.select({ id: tag.id }).from(tag).where(inArray(tag.name, tags));
			await tx.insert(tvShortcutTag).values(ids.map((t) => ({ shortcutId: id!, tagId: t.id })));
		}
		await deleteUnusedTags(
			tx,
			before.map((b) => b.tagId)
		);
	});
}

export async function deleteTvShortcut(id: number) {
	await db.transaction(async (tx) => {
		const before = await tx
			.select({ tagId: tvShortcutTag.tagId })
			.from(tvShortcutTag)
			.where(eq(tvShortcutTag.shortcutId, id));
		await tx.delete(tvShortcut).where(eq(tvShortcut.id, id));
		await deleteUnusedTags(
			tx,
			before.map((b) => b.tagId)
		);
	});
}
