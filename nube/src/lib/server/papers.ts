import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { isPaperCategory, type Paper, type PaperInput } from 'comun/papers.ts';
import { paper, user } from '#lib/server/db/schema.ts';
import { kindOf, MAX_DOCUMENT_BYTES, typeOf } from '#lib/server/expenses/income.ts';
import { openFileFor, openFor, sealFileFor, sealFor } from '#lib/server/family-secret.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { putFile, readFile, removeFile } from '#lib/server/storage.ts';

/**
 * The family's Papeles (#384): every adult sees and changes all of them, and a child cannot open
 * them (kids.ts lets it open only what it names). Its name, notes and file sealed with the
 * family's data key before they leave here: without the KMS, nothing can be kept or read
 * (`kmsOn`). Never to the AI, nor in the log.
 */

export const PAPERS_AREA = 'papeles';

export const MAX_PAPER_BYTES = MAX_DOCUMENT_BYTES;

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

const sealed = async (k: Kitchen, input: PaperInput) => ({
	name: await sealFor(k.familyId, input.name),
	category: input.category,
	notes: input.notes ? await sealFor(k.familyId, input.notes) : null
});

/** The family's, by name: read here, as the database cannot sort what it cannot read. */
export async function familyPapers(k: Kitchen): Promise<Paper[]> {
	const rows = await k.run((tx) =>
		tx
			.select({
				id: paper.id,
				name: paper.name,
				category: paper.category,
				notes: paper.notes,
				file: paper.file,
				by: user.name
			})
			.from(paper)
			.leftJoin(user, eq(user.id, paper.userId))
	);
	const papers = await Promise.all(
		rows.map(async (r): Promise<Paper> => ({
			id: r.id,
			name: await openFor(k.familyId, r.name),
			category: isPaperCategory(r.category) ? r.category : 'Otros',
			notes: r.notes ? await openFor(k.familyId, r.notes) : null,
			file: r.file.endsWith('.pdf') ? 'pdf' : 'image',
			by: r.by
		}))
	);
	return papers.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'es'));
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
