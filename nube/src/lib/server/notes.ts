import { randomUUID } from 'node:crypto';
import {
	and,
	arrayContains,
	desc,
	eq,
	gte,
	isNotNull,
	isNull,
	like,
	lt,
	or,
	sql,
	type SQL
} from 'drizzle-orm';
import { note, user } from '#lib/server/db/schema.ts';
import { kindOf } from '#lib/server/expenses/income.ts';
import { likeOf, plain, plainText } from '#lib/server/expenses/plain.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { dayOf } from '#lib/server/fridge.ts';
import { putFile, readFile, removeFile } from '#lib/server/storage.ts';
import { hearAudio } from '#lib/server/voice/hear.ts';
import { walkStartedAt } from '#lib/server/walks/walks.ts';
import { audioKind, audioTypeOf, MAX_NOTE_TEXT, type Note, type NoteArticle } from '#lib/notes.ts';
import { readArticle } from '#lib/server/notes-reader.ts';

/**
 * Notes (#416): what someone dictates, to look it up when they ask for it. Not the voice's memory,
 * which it uses by itself when answering. A person's, only theirs unless they share it with the house;
 * those said to a satellite (no one known), of the whole house.
 */

/** In the family's storage. */
const AREA = 'notas';
/** Hearing a long note takes longer than an order. */
const HEAR_TIMEOUT_MS = 120_000;
/** What the voice is told, at most: read aloud, a few are enough. */
const SAID_TO_VOICE = 10;
/** The latest ones looked through for the days asked. */
const LOOKED_THROUGH = 500;

/** The whole house's: without a person, or shared by its own. */
const ofTheHouse = () => or(isNull(note.userId), eq(note.shared, true));
/** Those `userId` may see: their own and the house's; without a person, the house's. */
const visibleTo = (userId: string | null) =>
	userId ? or(eq(note.userId, userId), ofTheHouse()) : ofTheHouse();
/** Those they may change: their own and the house's without a person, not what another shares. */
const changeableBy = (userId: string) => or(eq(note.userId, userId), isNull(note.userId));

const IMAGES = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp'
} as const;

const VIEW = {
	id: note.id,
	at: note.at,
	text: note.text,
	hearing: note.hearing,
	audio: note.audio,
	photo: note.photo,
	shared: note.shared,
	author: user.name,
	source: note.source,
	userId: note.userId,
	lon: note.lon,
	lat: note.lat,
	link: note.link,
	tags: note.tags,
	// Not the article itself: only to say what it is (its page reads it).
	article: sql<{
		minutes: number;
		site: string | null;
	} | null>`case when ${note.article} is null then null else jsonb_build_object('minutes', (${note.article}->>'minutes')::int, 'site', ${note.article}->>'site') end`
};

type Row = Omit<Note, 'hasAudio' | 'mine' | 'canEdit'> & {
	audio: string | null;
	userId: string | null;
};

/** As `viewer` sees it. */
function viewOf({ audio, userId, author, photo, shared, ...n }: Row, viewer: string | null): Note {
	const mine = userId !== null && userId === viewer;
	return {
		...n,
		// Where, only to whose it is: sharing a note does not say where they were.
		lon: mine ? n.lon : null,
		lat: mine ? n.lat : null,
		hasAudio: audio !== null,
		photo: photo && `/notas/${n.id}/foto?v=${photo}`,
		mine,
		shared: shared || userId === null,
		author: mine ? null : author,
		canEdit: mine || userId === null
	};
}

/** Said to the voice: only its words. Null if there are none. */
export async function addSaidNote(k: Kitchen, userId: string | null, said: string) {
	const text = said.trim().slice(0, MAX_NOTE_TEXT);
	if (!text) return null;
	const [row] = await k.run((tx) =>
		tx
			.insert(note)
			.values({ familyId: k.familyId, userId, text, source: 'voz' })
			.returning({ id: note.id })
	);
	return row!.id;
}

/** Thrown for a file that is not a photo. */
export class NotAPhoto extends Error {
	constructor() {
		super('Tiene que ser una foto (JPG, PNG o WebP)');
	}
}

/** Written by hand, with a photo or without; `shared`, for the whole house. Null if it has nothing. */
export async function addWrittenNote(
	k: Kitchen,
	userId: string,
	sent: {
		text: string;
		photo: Uint8Array | null;
		shared: boolean;
		/** When and where its photo was taken (#613), if known. */
		at?: Date | null;
		position?: [number, number] | null;
		tags?: string[];
	}
) {
	const text = sent.text.trim().slice(0, MAX_NOTE_TEXT);
	if (!text && !sent.photo) return null;
	let photo: string | null = null;
	if (sent.photo) {
		const kind = kindOf(sent.photo);
		if (!kind || !(kind in IMAGES)) throw new NotAPhoto();
		photo = `${randomUUID()}.${IMAGES[kind as keyof typeof IMAGES]}`;
		await putFile(k.familyId, AREA, photo, sent.photo, kind);
	}
	try {
		const [row] = await k.run((tx) =>
			tx
				.insert(note)
				.values({
					familyId: k.familyId,
					userId,
					text,
					photo,
					shared: sent.shared,
					...(sent.at ? { at: sent.at } : {}),
					lon: sent.position?.[0] ?? null,
					lat: sent.position?.[1] ?? null,
					source: 'escrita',
					tags: sent.tags ?? []
				})
				.returning({ id: note.id })
		);
		return row!.id;
	} catch (err) {
		if (photo) await removeFile(k.familyId, AREA, photo).catch(() => {});
		throw err;
	}
}

/** Shown to the whole house, or only to its person again: false if it is not one's own. */
export async function shareNote(k: Kitchen, userId: string, id: number, shared: boolean) {
	const done = await k.run((tx) =>
		tx
			.update(note)
			.set({ shared })
			.where(and(eq(note.id, id), eq(note.userId, userId)))
			.returning({ id: note.id })
	);
	return done.length > 0;
}

export class NotAudio extends Error {
	constructor() {
		super('Esa grabación no se puede guardar');
	}
}

/**
 * Recorded, here or on a walk: kept, then heard. Sent twice (the answer got lost), it is kept once.
 * Not heard, it is kept all the same, to try again. Throws NotAudio if it is not a recording.
 */
export async function addRecordedNote(
	k: Kitchen,
	who: { id: string; email: string },
	sent: {
		clientId: string;
		at: Date;
		lon: number | null;
		lat: number | null;
		/** The walk it was recorded on, by when it started. */
		walkStarted: Date | null;
		file: Uint8Array;
	}
) {
	const [known] = await k.run((tx) =>
		tx
			.select({ id: note.id })
			.from(note)
			.where(and(eq(note.userId, who.id), eq(note.clientId, sent.clientId)))
	);
	if (known) return known.id;
	const kind = audioKind(sent.file);
	if (!kind) throw new NotAudio();
	const walkId = sent.walkStarted ? await walkStartedAt(k, sent.walkStarted) : null;
	const audio = `${randomUUID()}.${kind.ext}`;
	await putFile(k.familyId, AREA, audio, sent.file, kind.type);
	const [row] = await k
		.run((tx) =>
			tx
				.insert(note)
				.values({
					familyId: k.familyId,
					userId: who.id,
					clientId: sent.clientId,
					hearing: 'pending',
					audio,
					source: sent.walkStarted ? 'paseo' : 'pagina',
					walkId,
					lon: sent.lon,
					lat: sent.lat,
					at: sent.at
				})
				.onConflictDoNothing()
				.returning({ id: note.id })
		)
		.catch(async (err) => {
			await removeFile(k.familyId, AREA, audio).catch(() => {});
			throw err;
		});
	if (!row) {
		await removeFile(k.familyId, AREA, audio).catch(() => {});
		return null;
	}
	await hear(k, who, row.id, sent.file, kind.type);
	return row.id;
}

/** What it says, or that it could not be heard: never a reason to lose the note. */
async function hear(
	k: Kitchen,
	who: { id: string; email: string },
	id: number,
	file: Uint8Array,
	type: string
) {
	let set: { text: string; hearing: 'ready' } | { hearing: 'failed' };
	try {
		const buffer = file.buffer.slice(
			file.byteOffset,
			file.byteOffset + file.byteLength
		) as ArrayBuffer;
		const heard = await hearAudio(k, who, buffer, type, HEAR_TIMEOUT_MS);
		set = { text: heard.trim().slice(0, MAX_NOTE_TEXT), hearing: 'ready' };
	} catch (err) {
		console.warn('[notas] No se pudo transcribir una nota', String(err));
		set = { hearing: 'failed' };
	}
	await k.run((tx) => tx.update(note).set(set).where(eq(note.id, id)));
}

/** One not heard, tried again. False if it is not one's own, or there is nothing to hear. */
export async function hearAgain(k: Kitchen, who: { id: string; email: string }, id: number) {
	const [row] = await k.run((tx) =>
		tx
			.select({ audio: note.audio })
			.from(note)
			.where(and(eq(note.id, id), eq(note.userId, who.id)))
	);
	const type = row?.audio ? audioTypeOf(row.audio) : null;
	if (!row?.audio || !type) return false;
	const file = await readFile(k.familyId, AREA, row.audio);
	if (!file) return false;
	await hear(k, who, id, file, type);
	return true;
}

/** Of «Notas» or «Para leer» (#634), and with a tag; undefined, any. */
export interface NoteFilter {
	pages?: boolean;
	tag?: string | null;
}

/**
 * Those found, the latest first; `words`, without caring for accents or capitals, in what it says
 * and in its article.
 */
function find(
	k: Kitchen,
	userId: string | null,
	words: string | null,
	limit: number,
	house = false,
	filter: NoteFilter = {}
) {
	const where: (SQL | undefined)[] = [house ? ofTheHouse() : visibleTo(userId)];
	if (words?.trim()) {
		const pattern = likeOf(plainText(words.trim()));
		where.push(
			or(
				like(plain(note.text), pattern),
				like(plain(sql`coalesce(${note.article}->>'text', '')`), pattern)
			)
		);
	}
	if (filter.pages !== undefined)
		where.push(filter.pages ? isNotNull(note.link) : isNull(note.link));
	if (filter.tag) where.push(arrayContains(note.tags, [filter.tag]));
	return k.run((tx) =>
		tx
			.select(VIEW)
			.from(note)
			.leftJoin(user, eq(user.id, note.userId))
			.where(and(...where))
			.orderBy(desc(note.at))
			.limit(limit)
	);
}

/** Those a person sees; `house`, only the whole house's. */
export async function listNotes(
	k: Kitchen,
	userId: string,
	words: string | null,
	{ house = false, limit = 200, ...filter }: { house?: boolean; limit?: number } & NoteFilter = {}
) {
	return (await find(k, userId, words, limit, house, filter)).map((n) => viewOf(n, userId));
}

/**
 * «Guardar en Notas» of a web (#633, #634): its name and the link, private, with its article read
 * now (Readability) when it can be. `read`, whether it could.
 */
export async function addWebNote(
	k: Kitchen,
	userId: string,
	sent: { link: string; title: string; tags?: string[] }
) {
	const article = await readArticle(sent.link);
	const title = (sent.title.trim() || article?.title || sent.link).slice(0, MAX_NOTE_TEXT);
	const [row] = await k.run((tx) =>
		tx
			.insert(note)
			.values({
				familyId: k.familyId,
				userId,
				text: title,
				shared: false,
				source: 'escrita',
				link: sent.link,
				article,
				tags: sent.tags ?? []
			})
			.returning({ id: note.id })
	);
	return { id: row!.id, read: article !== null };
}

/** A web's note with its article, as `userId` may see it; null, not theirs to see. */
export async function noteArticle(k: Kitchen, userId: string, id: number) {
	const [row] = await k.run((tx) =>
		tx
			.select({ ...VIEW, full: note.article })
			.from(note)
			.leftJoin(user, eq(user.id, note.userId))
			.where(and(eq(note.id, id), visibleTo(userId), isNotNull(note.link)))
	);
	if (!row) return null;
	const { full, ...rest } = row;
	return { note: viewOf(rest, userId), article: full as NoteArticle | null };
}

/** Its tags, by who may change it. */
export async function setNoteTags(k: Kitchen, userId: string, id: number, tags: string[]) {
	const done = await k.run((tx) =>
		tx
			.update(note)
			.set({ tags })
			.where(and(eq(note.id, id), changeableBy(userId)))
			.returning({ id: note.id })
	);
	return done.length > 0;
}

/** The tags they use, the most used first: to suggest and to filter by. */
export async function noteTags(k: Kitchen, userId: string) {
	const rows = await k.run((tx) =>
		tx
			.select({ tag: sql<string>`unnest(${note.tags})` })
			.from(note)
			.where(visibleTo(userId))
	);
	const count = new Map<string, number>();
	for (const { tag } of rows) count.set(tag, (count.get(tag) ?? 0) + 1);
	return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es')).map(([t]) => t);
}

/** One's own walk's notes, in order. */
export async function walkNotes(k: Kitchen, walkId: number) {
	const rows = await k.run((tx) =>
		tx
			.select(VIEW)
			.from(note)
			.leftJoin(user, eq(user.id, note.userId))
			.where(and(eq(note.walkId, walkId), eq(note.userId, k.userId!)))
			.orderBy(note.at)
	);
	return rows.map((n) => viewOf(n, k.userId));
}

/** One's own between two moments, in order (#613): the day's, beside where one was. */
export async function notesBetween(k: Kitchen, userId: string, from: Date, to: Date) {
	const rows = await k.run((tx) =>
		tx
			.select(VIEW)
			.from(note)
			.leftJoin(user, eq(user.id, note.userId))
			.where(and(eq(note.userId, userId), gte(note.at, from), lt(note.at, to)))
			.orderBy(note.at)
	);
	return rows.map((n) => viewOf(n, userId));
}

/** With a walk, if it is asked (#613): its notes and their files. */
export async function deleteWalkNotes(k: Kitchen, userId: string, walkId: number) {
	const rows = await k.run((tx) =>
		tx
			.select({ id: note.id })
			.from(note)
			.where(and(eq(note.walkId, walkId), eq(note.userId, userId)))
	);
	for (const { id } of rows) await deleteNote(k, userId, id);
}

/** For the voice, when asked: with their day, the latest first; days in the family's time. */
export async function describeNotes(
	k: Kitchen,
	userId: string | null,
	asked: { words: string | null; fromDay: string | null; untilDay: string | null }
) {
	const rows = (await find(k, userId, asked.words, LOOKED_THROUGH))
		.filter((n) => {
			const day = dayOf(n.at);
			return (!asked.fromDay || day >= asked.fromDay) && (!asked.untilDay || day <= asked.untilDay);
		})
		.slice(0, SAID_TO_VOICE);
	if (!rows.length) return 'No hay ninguna nota así.';
	return rows
		.map((n) => {
			// Another's: «mi coche» is theirs, not who asks'.
			const whose = n.userId && n.userId !== userId && n.author ? ` (de ${n.author})` : '';
			const photo = n.photo ? ' (con foto)' : '';
			return `${dayOf(n.at)}${whose}: ${n.text || (n.photo ? 'solo una foto' : '(grabada, sin transcribir)')}${n.text ? photo : ''}`;
		})
		.join('\n');
}

/** What it says, corrected by hand: the transcription can mishear names. */
export async function editNote(k: Kitchen, userId: string, id: number, text: string) {
	const done = await k.run((tx) =>
		tx
			.update(note)
			.set({ text: text.trim().slice(0, MAX_NOTE_TEXT), hearing: 'ready' })
			.where(and(eq(note.id, id), changeableBy(userId)))
			.returning({ id: note.id })
	);
	return done.length > 0;
}

export async function deleteNote(k: Kitchen, userId: string, id: number) {
	const [gone] = await k.run((tx) =>
		tx
			.delete(note)
			.where(and(eq(note.id, id), changeableBy(userId)))
			.returning({ audio: note.audio, photo: note.photo })
	);
	for (const file of [gone?.audio, gone?.photo])
		if (file)
			await removeFile(k.familyId, AREA, file).catch((err) =>
				console.warn('[notas] No se pudo borrar un fichero', String(err))
			);
}

/** Its audio, to listen to it: of those they may see. */
export async function noteAudio(k: Kitchen, userId: string, id: number) {
	const [row] = await k.run((tx) =>
		tx
			.select({ audio: note.audio })
			.from(note)
			.where(and(eq(note.id, id), visibleTo(userId)))
	);
	return row?.audio ?? null;
}

/** Its photo's file, of those they may see. */
export async function notePhoto(k: Kitchen, userId: string, id: number) {
	if (!Number.isInteger(id)) return null;
	const [row] = await k.run((tx) =>
		tx
			.select({ photo: note.photo })
			.from(note)
			.where(and(eq(note.id, id), visibleTo(userId)))
	);
	return row?.photo ?? null;
}

export const NOTES_AREA = AREA;
