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
	/** Its icon's file (tv-shortcut-icons.ts); null, none. */
	icon: string | null;
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
		.select({
			id: tvShortcut.id,
			name: tvShortcut.name,
			url: tvShortcut.url,
			icon: tvShortcut.icon
		})
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

/**
 * New, or changed: its name, address and tags (those it no longer has, gone if nothing else has
 * them). Whether its icon is to be looked for: new, another address, or none yet.
 */
export async function saveTvShortcut(s: { id?: number; name: string; url: string; tags: string }) {
	const name = s.name.trim().slice(0, 40);
	if (!name) throw new Error('Ponle un nombre');
	const url = shortcutUrl(s.url);
	const tags = parseTags(s.tags);
	return db.transaction(async (tx) => {
		let id = s.id;
		let findIcon = true;
		if (id) {
			const [before] = await tx
				.select({ url: tvShortcut.url, icon: tvShortcut.icon })
				.from(tvShortcut)
				.where(eq(tvShortcut.id, id));
			if (!before) throw new Error('Ese acceso directo ya no está');
			findIcon = before.url !== url || !before.icon;
			await tx.update(tvShortcut).set({ name, url }).where(eq(tvShortcut.id, id));
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
		return { id: id!, url, findIcon };
	});
}

/** Out, with its tags nothing else has; its icon's file, to delete. */
export async function deleteTvShortcut(id: number) {
	return db.transaction(async (tx) => {
		const before = await tx
			.select({ tagId: tvShortcutTag.tagId })
			.from(tvShortcutTag)
			.where(eq(tvShortcutTag.shortcutId, id));
		const [gone] = await tx
			.delete(tvShortcut)
			.where(eq(tvShortcut.id, id))
			.returning({ icon: tvShortcut.icon });
		await deleteUnusedTags(
			tx,
			before.map((b) => b.tagId)
		);
		return gone?.icon ?? null;
	});
}

/** Its icon's file, or none; the one before, to delete. */
export async function setShortcutIcon(id: number, icon: string | null) {
	const [before] = await db
		.select({ icon: tvShortcut.icon })
		.from(tvShortcut)
		.where(eq(tvShortcut.id, id));
	await db.update(tvShortcut).set({ icon }).where(eq(tvShortcut.id, id));
	return before?.icon ?? null;
}
