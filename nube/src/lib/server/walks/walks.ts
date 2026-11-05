import { and, asc, desc, eq } from 'drizzle-orm';
import { walk, walkPhoto } from '#lib/server/db/schema.ts';
import { keepDocument, kindOf, NotADocument } from '#lib/server/expenses/income.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { removeFile } from '#lib/server/storage.ts';
import { who } from '#lib/server/trips/trips.ts';
import { addPoints } from '#lib/trips.ts';
import { FASTEST_WALK, type parseWalk } from '#lib/walks.ts';

/** Paseos (#410): each person's, private to them; only they see or touch them. */

/** A finished walk. Sent twice (the answer got lost), it is kept once. */
export async function saveWalk(k: Kitchen, w: NonNullable<ReturnType<typeof parseWalk>>) {
	const userId = who(k);
	const { kept, distance } = addPoints(null, w.points, FASTEST_WALK);
	await k.run((tx) =>
		tx
			.insert(walk)
			.values({
				familyId: k.familyId,
				userId,
				startedAt: w.startedAt,
				endedAt: w.endedAt,
				distance,
				points: kept.length,
				line: kept,
				diagnosis: w.diagnosis
			})
			.onConflictDoNothing({ target: [walk.userId, walk.startedAt] })
	);
}

/** The walks, the latest first, without their positions. */
export function listWalks(k: Kitchen, limit = 100) {
	const userId = who(k);
	return k.run((tx) =>
		tx
			.select({
				id: walk.id,
				startedAt: walk.startedAt,
				endedAt: walk.endedAt,
				distance: walk.distance,
				points: walk.points,
				diagnosis: walk.diagnosis
			})
			.from(walk)
			.where(eq(walk.userId, userId))
			.orderBy(desc(walk.startedAt))
			.limit(limit)
	);
}

/** One walk's positions, to draw it. */
export async function walkLine(k: Kitchen, id: number) {
	const userId = who(k);
	const [row] = await k.run((tx) =>
		tx
			.select({ line: walk.line })
			.from(walk)
			.where(and(eq(walk.id, id), eq(walk.userId, userId)))
	);
	return row?.line ?? null;
}

/** Its photos go with it; its notes stay, as they are something of their own (notes.ts). */
export async function deleteWalk(k: Kitchen, id: number) {
	const userId = who(k);
	const photos = await walkPhotos(k, id);
	await k.run((tx) => tx.delete(walk).where(and(eq(walk.id, id), eq(walk.userId, userId))));
	const [still] = await k.run((tx) => tx.select({ id: walk.id }).from(walk).where(eq(walk.id, id)));
	if (still) return;
	for (const photo of photos)
		await removeFile(k.familyId, PHOTOS_AREA, photo.file).catch((err) =>
			console.warn('[paseos] No se pudo borrar una foto', String(err))
		);
}

/** Its id, by when it started: what a device knows of a walk it sent. */
export async function walkStartedAt(k: Kitchen, startedAt: Date) {
	const userId = who(k);
	const [row] = await k.run((tx) =>
		tx
			.select({ id: walk.id })
			.from(walk)
			.where(and(eq(walk.userId, userId), eq(walk.startedAt, startedAt)))
	);
	return row?.id ?? null;
}

/** In the family's storage. */
export const PHOTOS_AREA = 'paseos';

/**
 * A photo taken on a walk (#416). Sent twice, it is kept once. False if that walk is gone. Throws
 * NotADocument if it is not a picture.
 */
export async function addWalkPhoto(
	k: Kitchen,
	photo: {
		clientId: string;
		startedAt: Date;
		at: Date;
		lon: number | null;
		lat: number | null;
		file: Uint8Array;
	}
) {
	const userId = who(k);
	const [known] = await k.run((tx) =>
		tx
			.select({ id: walkPhoto.id })
			.from(walkPhoto)
			.where(and(eq(walkPhoto.userId, userId), eq(walkPhoto.clientId, photo.clientId)))
	);
	if (known) return true;
	if (!kindOf(photo.file)?.startsWith('image/')) throw new NotADocument();
	const walkId = await walkStartedAt(k, photo.startedAt);
	if (!walkId) return false;
	const file = await keepDocument(k, photo.file, PHOTOS_AREA);
	const kept = await k
		.run((tx) =>
			tx
				.insert(walkPhoto)
				.values({
					familyId: k.familyId,
					userId,
					walkId,
					clientId: photo.clientId,
					file,
					at: photo.at,
					lon: photo.lon,
					lat: photo.lat
				})
				.onConflictDoNothing()
				.returning({ id: walkPhoto.id })
		)
		.catch(async (err) => {
			await removeFile(k.familyId, PHOTOS_AREA, file).catch(() => {});
			throw err;
		});
	if (!kept.length) await removeFile(k.familyId, PHOTOS_AREA, file).catch(() => {});
	return true;
}

/** One's own walk's photos, in order. */
export function walkPhotos(k: Kitchen, walkId: number) {
	const userId = who(k);
	return k.run((tx) =>
		tx
			.select({
				id: walkPhoto.id,
				file: walkPhoto.file,
				at: walkPhoto.at,
				lon: walkPhoto.lon,
				lat: walkPhoto.lat
			})
			.from(walkPhoto)
			.where(and(eq(walkPhoto.walkId, walkId), eq(walkPhoto.userId, userId)))
			.orderBy(asc(walkPhoto.at))
	);
}

/** One's own photo's file, to show it. */
export async function walkPhotoFile(k: Kitchen, id: number) {
	const userId = who(k);
	const [row] = await k.run((tx) =>
		tx
			.select({ file: walkPhoto.file })
			.from(walkPhoto)
			.where(and(eq(walkPhoto.id, id), eq(walkPhoto.userId, userId)))
	);
	return row?.file ?? null;
}
