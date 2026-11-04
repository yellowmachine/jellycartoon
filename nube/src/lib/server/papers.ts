import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import {
	isPaperCategory,
	type EventPaper,
	type Paper,
	type PaperEvent,
	type PaperInput
} from 'comun/papers.ts';
import { calendarEvent, paper, paperEvent, user } from '#lib/server/db/schema.ts';
import { kindOf, MAX_DOCUMENT_BYTES, typeOf } from '#lib/server/expenses/income.ts';
import { kmsOn, openFileFor, openFor, sealFileFor, sealFor } from '#lib/server/family-secret.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { putFile, readFile, removeFile, storageReady } from '#lib/server/storage.ts';

/**
 * The family's Papeles (#384): every adult sees and changes all of them, and a child cannot open
 * them (kids.ts lets it open only what it names). Its name, notes and file sealed with the
 * family's data key before they leave here: without the KMS, nothing can be kept or read
 * (`kmsOn`). Never to the AI, nor in the log. One can belong to the agenda's events (#399), for
 * the same adults: nothing of it goes to the .ics, the fridge, the TV or the voice.
 */

export const PAPERS_AREA = 'papeles';

export const MAX_PAPER_BYTES = MAX_DOCUMENT_BYTES;

/** Only with the KMS and somewhere to keep the files. */
export const papersReady = () => kmsOn && storageReady;

const EXTENSIONS = {
	'application/pdf': 'pdf',
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp'
} as const;

export class NotAPaper extends Error {
	constructor() {
		super('Tiene que ser un PDF o una foto (JPG, PNG o WebP)');
	}
}

/** Its file, sealed and kept, by what it is; its name. */
async function keepFile(k: Kitchen, file: Uint8Array) {
	const kind = kindOf(file);
	if (!kind) throw new NotAPaper();
	const name = `${randomUUID()}.${EXTENSIONS[kind]}`;
	const sealed = await sealFileFor(k.familyId, file);
	await putFile(k.familyId, PAPERS_AREA, name, sealed, 'application/octet-stream');
	return name;
}

async function forgetFile(k: Kitchen, name: string) {
	await removeFile(k.familyId, PAPERS_AREA, name).catch((err) =>
		console.warn('[papeles] No se pudo borrar un fichero', String(err))
	);
}

const fileKind = (name: string): Paper['file'] => (name.endsWith('.pdf') ? 'pdf' : 'image');

const sealed = async (k: Kitchen, input: PaperInput) => ({
	name: await sealFor(k.familyId, input.name),
	category: input.category,
	notes: input.notes ? await sealFor(k.familyId, input.notes) : null
});

/** The family's, by name: read here, as the database cannot sort what it cannot read. */
export async function familyPapers(k: Kitchen): Promise<Paper[]> {
	const { rows, links } = await k.run(async (tx) => ({
		rows: await tx
			.select({
				id: paper.id,
				name: paper.name,
				category: paper.category,
				notes: paper.notes,
				file: paper.file,
				by: user.name
			})
			.from(paper)
			.leftJoin(user, eq(user.id, paper.userId)),
		links: await tx
			.select({
				paperId: paperEvent.paperId,
				id: calendarEvent.id,
				title: calendarEvent.title,
				day: calendarEvent.startDay,
				repeat: calendarEvent.repeat
			})
			.from(paperEvent)
			.innerJoin(calendarEvent, eq(calendarEvent.id, paperEvent.eventId))
			.orderBy(calendarEvent.startDay)
	}));
	const events = new Map<number, PaperEvent[]>();
	for (const { paperId, repeat, ...event } of links)
		events.set(paperId, [...(events.get(paperId) ?? []), { ...event, repeats: repeat !== null }]);
	const papers = await Promise.all(
		rows.map(async (r): Promise<Paper> => ({
			id: r.id,
			name: await openFor(k.familyId, r.name),
			category: isPaperCategory(r.category) ? r.category : 'Otros',
			notes: r.notes ? await openFor(k.familyId, r.notes) : null,
			file: fileKind(r.file),
			by: r.by,
			events: events.get(r.id) ?? []
		}))
	);
	return papers.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'es'));
}

/** The papers of these events, by event, only for a grown-up's agenda (#399). */
export async function papersOfEvents(k: Kitchen, eventIds: number[]) {
	const by: Record<number, EventPaper[]> = {};
	if (!eventIds.length) return by;
	const rows = await k.run((tx) =>
		tx
			.select({
				eventId: paperEvent.eventId,
				id: paper.id,
				name: paper.name,
				file: paper.file
			})
			.from(paperEvent)
			.innerJoin(paper, eq(paper.id, paperEvent.paperId))
			.where(inArray(paperEvent.eventId, eventIds))
	);
	const read = await Promise.all(
		rows.map(async (r) => ({
			eventId: r.eventId,
			paper: {
				id: r.id,
				name: await openFor(k.familyId, r.name),
				file: fileKind(r.file)
			} satisfies EventPaper
		}))
	);
	for (const { eventId, paper: one } of read) (by[eventId] ??= []).push(one);
	for (const papers of Object.values(by))
		papers.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'es'));
	return by;
}

/** The paper in that event too. False if either is not one of this family's now. */
export function linkPaper(k: Kitchen, paperId: number, eventId: number) {
	return k.run(async (tx) => {
		const [one] = await tx
			.select({ id: paper.id })
			.from(paper)
			.where(and(eq(paper.familyId, k.familyId), eq(paper.id, paperId)));
		const [event] = await tx
			.select({ id: calendarEvent.id })
			.from(calendarEvent)
			.where(and(eq(calendarEvent.familyId, k.familyId), eq(calendarEvent.id, eventId)));
		if (!one || !event) return false;
		await tx
			.insert(paperEvent)
			.values({ familyId: k.familyId, paperId, eventId })
			.onConflictDoNothing();
		return true;
	});
}

/** Out of that event: the paper stays in Papeles. */
export async function unlinkPaper(k: Kitchen, paperId: number, eventId: number) {
	await k.run((tx) =>
		tx
			.delete(paperEvent)
			.where(and(eq(paperEvent.paperId, paperId), eq(paperEvent.eventId, eventId)))
	);
}

export async function addPaper(k: Kitchen, input: PaperInput, file: Uint8Array) {
	const values = await sealed(k, input);
	const name = await keepFile(k, file);
	try {
		const [row] = await k.run((tx) =>
			tx
				.insert(paper)
				.values({ familyId: k.familyId, ...values, file: name, userId: k.userId })
				.returning({ id: paper.id })
		);
		return row!.id;
	} catch (err) {
		await forgetFile(k, name);
		throw err;
	}
}

/** Corrected; with `file`, its file changed for that one. False if it is no longer there. */
export async function updatePaper(
	k: Kitchen,
	id: number,
	input: PaperInput,
	file: Uint8Array | null = null
) {
	const [before] = await k.run((tx) =>
		tx.select({ file: paper.file }).from(paper).where(eq(paper.id, id))
	);
	if (!before) return false;
	const values = await sealed(k, input);
	const fresh = file ? await keepFile(k, file) : null;
	const [row] = await k.run((tx) =>
		tx
			.update(paper)
			.set({ ...values, file: fresh ?? before.file })
			.where(eq(paper.id, id))
			.returning({ id: paper.id })
	);
	if (!row) {
		if (fresh) await forgetFile(k, fresh);
		return false;
	}
	if (fresh) await forgetFile(k, before.file);
	return true;
}

export async function deletePaper(k: Kitchen, id: number) {
	const [gone] = await k.run((tx) =>
		tx.delete(paper).where(eq(paper.id, id)).returning({ file: paper.file })
	);
	if (gone) await forgetFile(k, gone.file);
	return Boolean(gone);
}

/** Its file as it came, what it is and its name; null if it is not there or cannot be read. */
export async function paperFile(k: Kitchen, id: number) {
	const [row] = await k.run((tx) =>
		tx.select({ name: paper.name, file: paper.file }).from(paper).where(eq(paper.id, id))
	);
	const type = row && typeOf(row.file);
	if (!row || !type) return null;
	const kept = await readFile(k.familyId, PAPERS_AREA, row.file);
	const bytes = kept && (await openFileFor(k.familyId, kept));
	if (!bytes) return null;
	return { bytes, type, name: await openFor(k.familyId, row.name) };
}
