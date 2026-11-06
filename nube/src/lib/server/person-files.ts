import { eq } from 'drizzle-orm';
import { note, tripPhoto, walkPhoto } from '#lib/server/db/schema.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { removeFile } from '#lib/server/storage.ts';
import { PHOTOS, photoName } from '#lib/server/trips/photos.ts';

/** In the family's storage, as notes.ts and walks.ts keep them. */
const NOTES = 'notas';
const WALK_PHOTOS = 'paseos';

/**
 * The files of what is only a person's, which go with their rows when their account goes: the rows
 * by the database, these by whoever takes the account. Asked for before it goes.
 */
export async function personFiles(k: Kitchen, userId: string) {
	const [notes, walks, trips] = await k.run((tx) =>
		Promise.all([
			tx.select({ audio: note.audio }).from(note).where(eq(note.userId, userId)),
			tx.select({ file: walkPhoto.file }).from(walkPhoto).where(eq(walkPhoto.userId, userId)),
			tx.select({ id: tripPhoto.id }).from(tripPhoto).where(eq(tripPhoto.userId, userId))
		])
	);
	return [
		...notes.flatMap((n) => (n.audio ? [{ area: NOTES, name: n.audio }] : [])),
		...walks.map((w) => ({ area: WALK_PHOTOS, name: w.file })),
		...trips.map((t) => ({ area: PHOTOS, name: photoName(t.id) }))
	];
}

/** Those files gone; one that cannot be is said, and does not stop the rest. */
export async function removePersonFiles(k: Kitchen, files: { area: string; name: string }[]) {
	for (const { area, name } of files)
		await removeFile(k.familyId, area, name).catch((err) =>
			console.warn('[personas] No se pudo borrar un fichero', String(err))
		);
}
