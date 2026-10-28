import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { trip, tripPhoto } from '#lib/server/db/schema.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { putFile, removeFile } from '#lib/server/storage.ts';
import type { LngLat } from 'comun/road.ts';
import { NEW_TRIP_AFTER_MS } from '#lib/trips.ts';
import { who } from './trips.ts';

/**
 * The road mode's photos (#81): the JPEG in the family's storage (storage.ts), when and where in
 * trip_photo, with the trip being kept then. Only for whoever took them.
 */

/** In the family's storage: `fotos/<id>.jpg`. */
export const PHOTOS = 'fotos';
export const photoName = (id: number) => `${id}.jpg`;

/** Bigger than this is not one of ours (they are made ~1920 px, a few hundred KB). */
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

const isJpeg = (bytes: Uint8Array) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

/** A photo taken now: kept, on the trip it belongs to if there is one. Its id. */
export async function savePhoto(k: Kitchen, jpeg: Uint8Array, takenAt: Date, at: LngLat | null) {
	const userId = who(k);
	if (!isJpeg(jpeg)) throw new Error('No es una foto JPEG');
	if (jpeg.length > MAX_PHOTO_BYTES) throw new Error('La foto es demasiado grande');
	const id = await k.run(async (tx) => {
		// The trip around it: started before, and going on (or just ended) then.
		const [around] = await tx
			.select({ id: trip.id })
			.from(trip)
			.where(
				and(
					eq(trip.userId, userId),
					lte(trip.startedAt, new Date(takenAt.getTime() + NEW_TRIP_AFTER_MS)),
					gte(trip.endedAt, new Date(takenAt.getTime() - NEW_TRIP_AFTER_MS))
				)
			)
			.orderBy(desc(trip.startedAt))
			.limit(1);
		const [row] = await tx
			.insert(tripPhoto)
			.values({
				familyId: k.familyId,
				userId,
				tripId: around?.id ?? null,
				takenAt,
				lon: at?.[0] ?? null,
				lat: at?.[1] ?? null
			})
			.returning({ id: tripPhoto.id });
		return row!.id;
	});
	try {
		await putFile(k.familyId, PHOTOS, photoName(id), jpeg, 'image/jpeg');
	} catch (error) {
		await k.run((tx) => tx.delete(tripPhoto).where(eq(tripPhoto.id, id)));
		throw error;
	}
	return id;
}

const columns = {
	id: tripPhoto.id,
	takenAt: tripPhoto.takenAt,
	lon: tripPhoto.lon,
	lat: tripPhoto.lat,
	tripId: tripPhoto.tripId
};

/** The latest ones first; or a trip's, in order. */
export async function listPhotos(k: Kitchen, tripId?: number) {
	const userId = who(k);
	return k.run((tx) =>
		tx
			.select(columns)
			.from(tripPhoto)
			.where(
				tripId === undefined
					? eq(tripPhoto.userId, userId)
					: and(eq(tripPhoto.userId, userId), eq(tripPhoto.tripId, tripId))
			)
			.orderBy(tripId === undefined ? desc(tripPhoto.takenAt) : tripPhoto.takenAt)
			.limit(tripId === undefined ? 120 : 500)
	);
}

/** Whether it is this person's: only then is its file served. */
export async function ownsPhoto(k: Kitchen, id: number) {
	const userId = who(k);
	const [row] = await k.run((tx) =>
		tx
			.select({ id: tripPhoto.id })
			.from(tripPhoto)
			.where(and(eq(tripPhoto.id, id), eq(tripPhoto.userId, userId)))
	);
	return Boolean(row);
}

/** Gone, its file too. */
export async function deletePhoto(k: Kitchen, id: number) {
	const userId = who(k);
	const [row] = await k.run((tx) =>
		tx
			.delete(tripPhoto)
			.where(and(eq(tripPhoto.id, id), eq(tripPhoto.userId, userId)))
			.returning({ id: tripPhoto.id })
	);
	if (row) await removeFile(k.familyId, PHOTOS, photoName(row.id)).catch(() => {});
}
