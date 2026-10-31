import { and, asc, eq, exists, inArray, ne, or, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { tag, tvShortcut, tvShortcutTag } from '#lib/server/db/schema.ts';
import { KIDS_TAG } from '#lib/kids-tag.ts';
import { deleteUnusedTags, tagName } from '#lib/server/tags.ts';
import { destinations, shortcutTarget, type Viewer } from '#lib/server/tv-shortcut-targets.ts';
import { isShortcutKind, type ShortcutKind } from '#lib/tv-shortcut-kinds.ts';

/**
 * The TV view's shortcuts (#327), made in Ajustes → Casa, each with its tags: to sites of elsewhere
 * (`url`), or to anything of the TV view's own (#343, tv-shortcut-targets.ts). A child's account
 * sees a site only if tagged «infantil», as with series and films; the rest, if the destination
 * is for it.
 */

export interface TvShortcut {
	id: number;
	name: string;
	kind: ShortcutKind;
	/** A site's address, for `url`. */
	url: string | null;
	/** Which one, for the other kinds. */
	target: string | null;
	/** Its icon's file (tv-shortcut-icons.ts); null, none. */
	icon: string | null;
	tags: string[];
}

/** A `where` condition: a site is for children if tagged so; the rest, by their destination. */
const forKids = or(
	ne(tvShortcut.kind, 'url'),
	exists(
		db
			.select({ one: sql`1` })
			.from(tvShortcutTag)
			.innerJoin(tag, eq(tag.id, tvShortcutTag.tagId))
			.where(and(eq(tvShortcutTag.shortcutId, tvShortcut.id), eq(tag.name, KIDS_TAG)))
	)
);

/** Every shortcut, by name; for a child, without the sites not for it. */
export async function tvShortcuts(kid: boolean): Promise<TvShortcut[]> {
	const rows = await db
		.select({
			id: tvShortcut.id,
			name: tvShortcut.name,
			kind: tvShortcut.kind,
			url: tvShortcut.url,
			target: tvShortcut.target,
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
		// Written only through saveTvShortcut.
		kind: r.kind as ShortcutKind,
		tags: tags.filter((t) => t.shortcutId === r.id).map((t) => t.name)
	}));
}

/** One the user may open: for a child, only a site that is a children's one. */
export async function openableShortcut(id: number, kid: boolean) {
	return (await tvShortcuts(kid)).find((s) => s.id === id) ?? null;
}

/** A shortcut's tile in the TV view. */
export interface TvShortcutTile {
	id: number;
	name: string;
	kind: ShortcutKind;
	target: string | null;
	icon: string | null;
	/** A site's, without `www.`; null, not a site. */
	host: string | null;
	/** Its page in the TV view; null, a site's window, or it starts on its tile. */
	href: string | null;
}

/** The TV view's tiles, by name: without those gone, nor those not for this viewer. */
export async function tvShortcutTiles(viewer: Viewer): Promise<TvShortcutTile[]> {
	const shortcuts = await tvShortcuts(viewer.kid);
	const found = await destinationsOf(shortcuts, viewer);
	return shortcuts.flatMap((s, i): TvShortcutTile[] => {
		const tile = { id: s.id, name: s.name, kind: s.kind, target: s.target };
		if (s.kind === 'url')
			return [
				{
					...tile,
					icon: s.icon && `/api/accesos/${s.id}/icono?${s.icon}`,
					host: new URL(s.url!).hostname.replace(/^www\./, ''),
					href: null
				}
			];
		const d = found[i];
		return d ? [{ ...tile, icon: d.icon, host: null, href: d.href }] : [];
	});
}

/**
 * Ajustes' list: every shortcut, with what it opens (its own name; null for a site), and whether it
 * is gone (a series deleted, a station taken out…), as an adult sees them.
 */
export async function settingsShortcuts(userId: string) {
	const shortcuts = await tvShortcuts(false);
	const found = await destinationsOf(shortcuts, { userId, kid: false });
	return shortcuts.map((s, i) => ({
		...s,
		opens: found[i]?.name ?? null,
		gone: s.kind !== 'url' && !found[i]
	}));
}

/** Each one's destination, in order; null for a site. */
async function destinationsOf(shortcuts: TvShortcut[], viewer: Viewer) {
	const own = shortcuts.flatMap((s, i) =>
		s.kind === 'url' ? [] : [{ i, kind: s.kind, target: s.target ?? '' }]
	);
	const found = await destinations(own, viewer);
	const byIndex = new Map(own.map((o, n) => [o.i, found[n]]));
	return shortcuts.map((_, i) => byIndex.get(i) ?? null);
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
 * New, or changed: its name, what it opens and its tags (those it no longer has, gone if nothing
 * else has them). A site's address; another kind's target, checked to be there as `userId` sees it
 * (a podcast is each person's), and with no name, the destination's. Whether its icon is to be
 * looked for (a site: new, another address, or none yet); the one it had, to delete, if no longer
 * a site.
 */
export async function saveTvShortcut(
	s: {
		id?: number;
		name: string;
		kind?: string;
		url?: string;
		target?: string;
		tags: string;
	},
	userId: string
) {
	const kind = s.kind ?? 'url';
	if (!isShortcutKind(kind)) throw new Error('Elige qué abre');
	let name = s.name.trim().slice(0, 40);
	let url: string | null = null;
	let target: string | null = null;
	if (kind === 'url') {
		if (!name) throw new Error('Ponle un nombre');
		url = shortcutUrl(s.url ?? '');
	} else {
		target = shortcutTarget(kind, s.target ?? '');
		const [found] = await destinations([{ kind, target }], { userId, kid: false });
		if (!found) throw new Error('Eso ya no está');
		name ||= found.name.slice(0, 40);
	}
	const tags = parseTags(s.tags);
	return db.transaction(async (tx) => {
		let id = s.id;
		let findIcon = kind === 'url';
		let oldIcon: string | null = null;
		if (id) {
			const [before] = await tx
				.select({ url: tvShortcut.url, icon: tvShortcut.icon })
				.from(tvShortcut)
				.where(eq(tvShortcut.id, id));
			if (!before) throw new Error('Ese acceso directo ya no está');
			findIcon &&= before.url !== url || !before.icon;
			if (kind !== 'url') oldIcon = before.icon;
			await tx
				.update(tvShortcut)
				.set({ name, kind, url, target, ...(kind === 'url' ? {} : { icon: null }) })
				.where(eq(tvShortcut.id, id));
		} else {
			[{ id }] = await tx
				.insert(tvShortcut)
				.values({ name, kind, url, target })
				.returning({ id: tvShortcut.id });
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
		return { id: id!, url, findIcon, oldIcon };
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
