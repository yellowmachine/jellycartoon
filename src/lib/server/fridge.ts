import { and, asc, desc, eq, gte, inArray, isNull, ne, or } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { user } from '#lib/server/db/auth.schema.ts';
import { fridgeItem, fridgeNote } from '#lib/server/db/schema.ts';
import { KIDS_ROLE } from '#lib/server/kids.ts';
import { notify } from '#lib/server/push.ts';
import { today } from '#lib/server/playlist.ts';
import { fold } from '#lib/music.ts';
import { MAX_ITEM, MAX_NOTE, paperFor, type FridgeAuthor, type FridgeState } from '#lib/fridge.ts';

/**
 * The fridge (#131): the house's post-its and its shopping list. Every change is told to the open
 * pages (SSE, `watchFridge`) and, with the app closed, to the other adults' phones (Web Push).
 */

const listeners = new Set<() => void>();

/** The open pages, told on every change. */
export function watchFridge(listener: () => void) {
	listeners.add(listener);
	return () => void listeners.delete(listener);
}

function changed() {
	for (const listener of listeners) listener();
}

const author = (id: string | null, name: string | null): FridgeAuthor | null =>
	id && name ? { name, paper: paperFor(id) } : null;

/** The shopping list's post-it: there is one, made the first time it is needed. */
async function listId() {
	const [found] = await db
		.select({ id: fridgeNote.id })
		.from(fridgeNote)
		.where(eq(fridgeNote.kind, 'list'))
		.orderBy(asc(fridgeNote.id))
		.limit(1);
	if (found) return found.id;
	const [made] = await db
		.insert(fridgeNote)
		.values({ kind: 'list', text: 'Lista de la compra' })
		.returning({ id: fridgeNote.id });
	return made!.id;
}

/** All of it, as it is now: the post-its still up (newest first) and the list. */
export async function fridgeState(): Promise<FridgeState> {
	const list = await listId();
	const [notes, items] = await Promise.all([
		db
			.select({
				id: fridgeNote.id,
				text: fridgeNote.text,
				until: fridgeNote.until,
				createdAt: fridgeNote.createdAt,
				userId: fridgeNote.userId,
				name: user.name
			})
			.from(fridgeNote)
			.leftJoin(user, eq(user.id, fridgeNote.userId))
			.where(
				and(
					eq(fridgeNote.kind, 'note'),
					or(isNull(fridgeNote.until), gte(fridgeNote.until, today()))
				)
			)
			.orderBy(desc(fridgeNote.createdAt)),
		db
			.select({
				id: fridgeItem.id,
				text: fridgeItem.text,
				done: fridgeItem.done,
				userId: fridgeItem.userId,
				name: user.name
			})
			.from(fridgeItem)
			.leftJoin(user, eq(user.id, fridgeItem.userId))
			.where(eq(fridgeItem.noteId, list))
			.orderBy(asc(fridgeItem.done), asc(fridgeItem.createdAt), asc(fridgeItem.id))
	]);
	return {
		notes: notes.map((n) => ({
			id: n.id,
			text: n.text,
			until: n.until,
			createdAt: n.createdAt.toISOString(),
			author: author(n.userId, n.name)
		})),
		list: {
			id: list,
			items: items.map((i) => ({
				id: i.id,
				text: i.text,
				done: i.done,
				author: author(i.userId, i.name)
			}))
		}
	};
}

/** The adults of the house but `except`: who is told, with the app closed. */
async function othersThan(except: string) {
	const rows = await db
		.select({ id: user.id })
		.from(user)
		.where(and(ne(user.id, except), or(isNull(user.role), ne(user.role, KIDS_ROLE))));
	return rows.map((r) => r.id);
}

async function nameOf(userId: string) {
	const [row] = await db.select({ name: user.name }).from(user).where(eq(user.id, userId));
	return row?.name ?? 'Alguien';
}

/** A post-it, from `userId`; `until` its last day. Told to the others. */
export async function addNote(userId: string, text: string, until: string | null) {
	const clean = text.trim().slice(0, MAX_NOTE);
	if (!clean) return null;
	const [note] = await db
		.insert(fridgeNote)
		.values({ kind: 'note', userId, text: clean, until })
		.returning({ id: fridgeNote.id });
	changed();
	void (async () => {
		const name = await nameOf(userId);
		await notify(await othersThan(userId), {
			title: `📌 ${name} ha dejado un post-it`,
			body: clean,
			tag: `nevera-nota-${note!.id}`,
			url: '/nevera',
			ttl: 24 * 3600
		});
	})();
	return note!.id;
}

/** Peeled off: a post-it, not the list. */
export async function peelNote(id: number) {
	await db.delete(fridgeNote).where(and(eq(fridgeNote.id, id), eq(fridgeNote.kind, 'note')));
	changed();
}

/** Its words, accents and case aside: «Cebolla» is the «cebolla» already there. */
const same = (a: string, b: string) => fold(a).trim() === fold(b).trim();

/**
 * Onto the list, from `userId`: one already there is left as it is, or back to buy if it was
 * ticked off. Those really new are told to the others, in one notice that replaces the last one.
 * Returns what was added.
 */
export async function addItems(userId: string, texts: string[]) {
	const wanted = texts.map((t) => t.trim().slice(0, MAX_ITEM)).filter(Boolean);
	if (!wanted.length) return [];
	const list = await listId();
	const there = await db
		.select({ id: fridgeItem.id, text: fridgeItem.text, done: fridgeItem.done })
		.from(fridgeItem)
		.where(eq(fridgeItem.noteId, list));
	const added: string[] = [];
	const again: number[] = [];
	for (const text of wanted) {
		const found = there.find((t) => same(t.text, text));
		if (found?.done) again.push(found.id);
		if (found || added.some((a) => same(a, text))) continue;
		added.push(text);
	}
	if (again.length)
		await db.update(fridgeItem).set({ done: false }).where(inArray(fridgeItem.id, again));
	if (added.length)
		await db.insert(fridgeItem).values(added.map((text) => ({ noteId: list, text, userId })));
	if (!added.length && !again.length) return [];
	changed();
	const told = [...added, ...there.filter((t) => again.includes(t.id)).map((t) => t.text)];
	void (async () => {
		const name = await nameOf(userId);
		await notify(await othersThan(userId), {
			title: `🛒 ${name} ha añadido a la lista`,
			body: told.join(', '),
			tag: 'nevera-lista',
			url: '/nevera',
			ttl: 12 * 3600
		});
	})();
	return told;
}

/** Ticked off (bought), or back to buy. */
export async function setItemDone(id: number, done: boolean) {
	await db.update(fridgeItem).set({ done }).where(eq(fridgeItem.id, id));
	changed();
}

export async function removeItem(id: number) {
	await db.delete(fridgeItem).where(eq(fridgeItem.id, id));
	changed();
}

/** What was bought, off the list. */
export async function clearDone() {
	await db
		.delete(fridgeItem)
		.where(and(eq(fridgeItem.noteId, await listId()), eq(fridgeItem.done, true)));
	changed();
}

/** For the voice: what is left to buy. */
export async function toBuy() {
	const rows = await db
		.select({ text: fridgeItem.text })
		.from(fridgeItem)
		.where(and(eq(fridgeItem.noteId, await listId()), eq(fridgeItem.done, false)))
		.orderBy(asc(fridgeItem.createdAt), asc(fridgeItem.id));
	return rows.map((r) => r.text);
}

/** For the voice: an item off the list by its name (bought, or not needed). */
export async function tickOffByName(text: string) {
	const rows = await db
		.select({ id: fridgeItem.id, text: fridgeItem.text })
		.from(fridgeItem)
		.where(and(eq(fridgeItem.noteId, await listId()), eq(fridgeItem.done, false)));
	const found = rows.find((r) => same(r.text, text));
	if (!found) return null;
	await setItemDone(found.id, true);
	return found.text;
}
