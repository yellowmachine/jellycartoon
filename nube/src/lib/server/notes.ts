import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull, like, or, type SQL } from 'drizzle-orm';
import { note } from '#lib/server/db/schema.ts';
import { likeOf, plain, plainText } from '#lib/server/expenses/plain.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { dayOf } from '#lib/server/fridge.ts';
import { putFile, readFile, removeFile } from '#lib/server/storage.ts';
import { hearAudio } from '#lib/server/voice/hear.ts';
import { walkStartedAt } from '#lib/server/walks/walks.ts';
import { audioKind, audioTypeOf, MAX_NOTE_TEXT, type Note } from '#lib/notes.ts';

/**
 * Notes (#416): what someone dictates, to look it up when they ask for it. Not the voice's memory,
 * which it uses by itself when answering. A person's, only theirs; those said to a satellite (no one
 * known), of the whole house.
 */

/** In the family's storage. */
const AREA = 'notas';
/** Hearing a long note takes longer than an order. */
const HEAR_TIMEOUT_MS = 120_000;
/** What the voice is told, at most: read aloud, a few are enough. */
const SAID_TO_VOICE = 10;
/** The latest ones looked through for the days asked. */
const LOOKED_THROUGH = 500;

/** Those `userId` may see: their own and the house's; without a person, the house's. */
const visibleTo = (userId: string | null) =>
	userId ? or(eq(note.userId, userId), isNull(note.userId)) : isNull(note.userId);

const VIEW = {
	id: note.id,
	at: note.at,
	text: note.text,
	hearing: note.hearing,
	audio: note.audio,
	source: note.source,
	userId: note.userId,
	lon: note.lon,
	lat: note.lat
};

function viewOf({
	audio,
	userId,
	...n
}: { audio: string | null; userId: string | null } & Omit<Note, 'hasAudio' | 'mine'>): Note {
	return { ...n, hasAudio: audio !== null, mine: userId !== null };
}

/** Said to the voice, or written by hand: only its words. Null if there are none. */
export async function addSaidNote(
	k: Kitchen,
	userId: string | null,
	said: string,
	source: 'voz' | 'escrita' = 'voz'
) {
	const text = said.trim().slice(0, MAX_NOTE_TEXT);
	if (!text) return null;
	const [row] = await k.run((tx) =>
		tx
			.insert(note)
			.values({ familyId: k.familyId, userId, text, source })
			.returning({ id: note.id })
	);
	return row!.id;
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

/** Those found, the latest first; `words`, without caring for accents or capitals. */
function find(k: Kitchen, userId: string | null, words: string | null, limit: number) {
	const where: (SQL | undefined)[] = [visibleTo(userId)];
	if (words?.trim()) where.push(like(plain(note.text), likeOf(plainText(words.trim()))));
	return k.run((tx) =>
		tx
			.select(VIEW)
			.from(note)
			.where(and(...where))
			.orderBy(desc(note.at))
			.limit(limit)
	);
}

export async function listNotes(k: Kitchen, userId: string, words: string | null, limit = 200) {
	return (await find(k, userId, words, limit)).map(viewOf);
}

/** One's own walk's notes, in order. */
export async function walkNotes(k: Kitchen, walkId: number) {
	const rows = await k.run((tx) =>
		tx
			.select(VIEW)
			.from(note)
			.where(and(eq(note.walkId, walkId), eq(note.userId, k.userId!)))
			.orderBy(note.at)
	);
	return rows.map(viewOf);
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
	return rows.map((n) => `${dayOf(n.at)}: ${n.text || '(grabada, sin transcribir)'}`).join('\n');
}

/** What it says, corrected by hand: the transcription can mishear names. */
export async function editNote(k: Kitchen, userId: string, id: number, text: string) {
	const done = await k.run((tx) =>
		tx
			.update(note)
			.set({ text: text.trim().slice(0, MAX_NOTE_TEXT), hearing: 'ready' })
			.where(and(eq(note.id, id), visibleTo(userId)))
			.returning({ id: note.id })
	);
	return done.length > 0;
}

export async function deleteNote(k: Kitchen, userId: string, id: number) {
	const [gone] = await k.run((tx) =>
		tx
			.delete(note)
			.where(and(eq(note.id, id), visibleTo(userId)))
			.returning({ audio: note.audio })
	);
	if (gone?.audio)
		await removeFile(k.familyId, AREA, gone.audio).catch((err) =>
			console.warn('[notas] No se pudo borrar un audio', String(err))
		);
}

/** Its audio, to listen to it: only one's own. */
export async function noteAudio(k: Kitchen, userId: string, id: number) {
	const [row] = await k.run((tx) =>
		tx
			.select({ audio: note.audio })
			.from(note)
			.where(and(eq(note.id, id), eq(note.userId, userId)))
	);
	return row?.audio ?? null;
}

export const NOTES_AREA = AREA;
