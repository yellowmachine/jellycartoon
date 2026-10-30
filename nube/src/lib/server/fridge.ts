import { and, asc, desc, eq, gte, inArray, isNull, or } from 'drizzle-orm';
import { user } from '#lib/server/db/auth.schema.ts';
import { fridgeItem, fridgeNote } from '#lib/server/db/schema.ts';
import { asFamily, withFamily } from '#lib/server/family.ts';
import type { AnyDb } from '#lib/server/family-scope.ts';
import { agendaToday } from '#lib/server/agenda/agenda.ts';
import { ruleEvent } from '#lib/server/rule-events.ts';
import { MAX_ITEM, MAX_NOTE, paperFor, type FridgeAuthor, type FridgeState } from 'comun/fridge.ts';

/**
 * The family's fridge (#253; jellycartoon's #131): its post-its and its shopping list. Every change
 * is told to the family's open pages (SSE, `watchFridge`), with the agenda's «Hoy» (agenda.ts). Not
 * yet to the phones (Web Push) nor to Telegram, as jellycartoon does.
 */

/** Who is writing, and in which family: a person, or the family's house (by its key). */
export interface Kitchen {
	familyId: string;
	/** Null: the house (a voice satellite). */
	userId: string | null;
	run: <T>(fn: (tx: AnyDb) => Promise<T>) => Promise<T>;
}

/** This person's family's kitchen. */
export async function kitchenOf(userId: string): Promise<Kitchen> {
	const familyId = await withFamily(userId, async (_, m) => m.familyId);
	return { familyId, userId, run: (fn) => withFamily(userId, (tx) => fn(tx)) };
}

/** The family's, for its house: no person. */
export const houseKitchen = (familyId: string): Kitchen => ({
	familyId,
	userId: null,
	run: (fn) => asFamily(familyId, fn)
});

const listeners = new Map<string, Set<() => void>>();

/** The family's open pages, told on every change. */
export function watchFridge(familyId: string, listener: () => void) {
	const set = listeners.get(familyId) ?? new Set();
	set.add(listener);
	listeners.set(familyId, set);
	return () => void set.delete(listener);
}

function changed(familyId: string) {
	for (const listener of listeners.get(familyId) ?? []) listener();
}

/** The family's day, `YYYY-MM-DD`: post-its «hasta hoy» go at its midnight. */
const TIME_ZONE = process.env.TZ || 'Europe/Madrid';
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format();

/** Lower case and without accents: «Cebolla» is the «cebolla» already there. */
const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const same = (a: string, b: string) => fold(a).trim() === fold(b).trim();

const author = (id: string | null, name: string | null): FridgeAuthor | null =>
	id && name ? { name, paper: paperFor(id) } : null;

/** The shopping list's post-it: one per family, made the first time it is needed. */
async function listId(tx: AnyDb, familyId: string) {
	const [found] = await tx
		.select({ id: fridgeNote.id })
		.from(fridgeNote)
		.where(eq(fridgeNote.kind, 'list'))
		.orderBy(asc(fridgeNote.id))
		.limit(1);
	if (found) return found.id;
	const [made] = await tx
		.insert(fridgeNote)
		.values({ familyId, kind: 'list', text: 'Lista de la compra' })
		.returning({ id: fridgeNote.id });
	return made!.id;
}

/** All of it, as it is now: the post-its still up (newest first), the list, and the agenda's «Hoy». */
export async function fridgeState(k: Kitchen): Promise<FridgeState> {
	const [fridge, today] = await Promise.all([fridgeOnly(k), agendaToday(k)]);
	return { ...fridge, today };
}

function fridgeOnly(k: Kitchen): Promise<Omit<FridgeState, 'today'>> {
	return k.run(async (tx) => {
		const list = await listId(tx, k.familyId);
		const notes = await tx
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
			.orderBy(desc(fridgeNote.createdAt));
		const items = await tx
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
			.orderBy(asc(fridgeItem.done), asc(fridgeItem.createdAt), asc(fridgeItem.id));
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
	});
}

/** A post-it; `until` its last day. */
export async function addNote(k: Kitchen, text: string, until: string | null) {
	const clean = text.trim().slice(0, MAX_NOTE);
	if (!clean) return null;
	const [note] = await k.run((tx) =>
		tx
			.insert(fridgeNote)
			.values({ familyId: k.familyId, kind: 'note', userId: k.userId, text: clean, until })
			.returning({ id: fridgeNote.id })
	);
	changed(k.familyId);
	ruleEvent(k, 'nevera', clean);
	return note!.id;
}

/** A post-it's words changed (by any adult, as peeling it off). False if it is no longer up. */
export async function editNote(k: Kitchen, id: number, text: string) {
	const clean = text.trim().slice(0, MAX_NOTE);
	if (!clean) return false;
	const [note] = await k.run((tx) =>
		tx
			.update(fridgeNote)
			.set({ text: clean })
			.where(and(eq(fridgeNote.id, id), eq(fridgeNote.kind, 'note')))
			.returning({ id: fridgeNote.id })
	);
	if (!note) return false;
	changed(k.familyId);
	ruleEvent(k, 'nevera', clean);
	return true;
}

/** Peeled off: a post-it, not the list. */
export async function peelNote(k: Kitchen, id: number) {
	await k.run((tx) =>
		tx.delete(fridgeNote).where(and(eq(fridgeNote.id, id), eq(fridgeNote.kind, 'note')))
	);
	changed(k.familyId);
}

/**
 * Onto the list: one already there is left as it is, or back to buy if it was ticked off. Returns
 * what was added, or put back to buy.
 */
export async function addItems(k: Kitchen, texts: string[]) {
	const wanted = texts.map((t) => t.trim().slice(0, MAX_ITEM)).filter(Boolean);
	if (!wanted.length) return [];
	const told = await k.run(async (tx) => {
		const list = await listId(tx, k.familyId);
		const there = await tx
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
			await tx.update(fridgeItem).set({ done: false }).where(inArray(fridgeItem.id, again));
		if (added.length)
			await tx
				.insert(fridgeItem)
				.values(
					added.map((text) => ({ familyId: k.familyId, noteId: list, text, userId: k.userId }))
				);
		return [...added, ...there.filter((t) => again.includes(t.id)).map((t) => t.text)];
	});
	if (told.length) changed(k.familyId);
	for (const text of told) ruleEvent(k, 'nevera', text);
	return told;
}

/** Ticked off (bought), or back to buy. */
export async function setItemDone(k: Kitchen, id: number, done: boolean) {
	await k.run((tx) => tx.update(fridgeItem).set({ done }).where(eq(fridgeItem.id, id)));
	changed(k.familyId);
}

export async function removeItem(k: Kitchen, id: number) {
	await k.run((tx) => tx.delete(fridgeItem).where(eq(fridgeItem.id, id)));
	changed(k.familyId);
}

/** What was bought, off the list. */
export async function clearDone(k: Kitchen) {
	await k.run(async (tx) =>
		tx
			.delete(fridgeItem)
			.where(and(eq(fridgeItem.noteId, await listId(tx, k.familyId)), eq(fridgeItem.done, true)))
	);
	changed(k.familyId);
}

/** For the voice: what is left to buy. */
export function toBuy(k: Kitchen) {
	return k.run(async (tx) => {
		const rows = await tx
			.select({ text: fridgeItem.text })
			.from(fridgeItem)
			.where(and(eq(fridgeItem.noteId, await listId(tx, k.familyId)), eq(fridgeItem.done, false)))
			.orderBy(asc(fridgeItem.createdAt), asc(fridgeItem.id));
		return rows.map((r) => r.text);
	});
}

/** For the voice: an item off the list by its name (bought, or not needed); null if not there. */
export async function tickOffByName(k: Kitchen, text: string) {
	const found = await k.run(async (tx) => {
		const rows = await tx
			.select({ id: fridgeItem.id, text: fridgeItem.text })
			.from(fridgeItem)
			.where(and(eq(fridgeItem.noteId, await listId(tx, k.familyId)), eq(fridgeItem.done, false)));
		const match = rows.find((r) => same(r.text, text));
		if (match) await tx.update(fridgeItem).set({ done: true }).where(eq(fridgeItem.id, match.id));
		return match?.text ?? null;
	});
	if (found) changed(k.familyId);
	return found;
}
