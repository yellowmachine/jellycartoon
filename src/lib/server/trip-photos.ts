import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { trip, tripPhoto } from '#lib/server/db/schema.ts';
import { photoFile } from '#lib/server/library/paths.ts';
import type { LngLat } from '#lib/road.ts';
import { NEW_TRIP_AFTER_MS } from '#lib/trips.ts';

/**
 * The road mode's photos (#81): the JPEG in DATA_DIR/fotos, when and where in trip_photo, with the
 * trip being kept then. Only for whoever took them.
 */

/** Bigger than this is not one of ours (they are made ~1920 px, a few hundred KB). */
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

const isJpeg = (bytes: Uint8Array) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

/** A photo taken now: kept, on the trip it belongs to if there is one. Its id. */
export async function savePhoto(
	userId: string,
	jpeg: Uint8Array,
	takenAt: Date,
	at: LngLat | null
) {
	if (!isJpeg(jpeg)) throw new Error('No es una foto JPEG');
	if (jpeg.length > MAX_PHOTO_BYTES) throw new Error('La foto es demasiado grande');
	// The trip around it: started before, and going on (or just ended) then.
	const [around] = await db
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
	const [row] = await db
		.insert(tripPhoto)
		.values({
			userId,
			tripId: around?.id ?? null,
			takenAt,
			lon: at?.[0] ?? null,
			lat: at?.[1] ?? null
		})
		.returning({ id: tripPhoto.id });
	const file = photoFile(row!.id);
	const partial = `${file}.part`;
	try {
		await mkdir(path.dirname(file), { recursive: true });
		await writeFile(partial, jpeg);
		await rename(partial, file);
	} catch (error) {
		await rm(partial, { force: true });
		await db.delete(tripPhoto).where(eq(tripPhoto.id, row!.id));
		throw error;
	}
	return row!.id;
}

const columns = {
	id: tripPhoto.id,
	takenAt: tripPhoto.takenAt,
	lon: tripPhoto.lon,
	lat: tripPhoto.lat,
	tripId: tripPhoto.tripId
};

/** The latest ones first; or a trip's, in order. */
export async function listPhotos(userId: string, tripId?: number) {
	return db
		.select(columns)
		.from(tripPhoto)
		.where(
			tripId === undefined
				? eq(tripPhoto.userId, userId)
				: and(eq(tripPhoto.userId, userId), eq(tripPhoto.tripId, tripId))
		)
		.orderBy(tripId === undefined ? desc(tripPhoto.takenAt) : tripPhoto.takenAt)
		.limit(tripId === undefined ? 120 : 500);
}

/** Whether it is this user's: only then is its file served. */
export async function ownsPhoto(userId: string, id: number) {
	const [row] = await db
		.select({ id: tripPhoto.id })
		.from(tripPhoto)
		.where(and(eq(tripPhoto.id, id), eq(tripPhoto.userId, userId)));
	return Boolean(row);
}

/** Gone, its file too. */
export async function deletePhoto(userId: string, id: number) {
	const [row] = await db
		.delete(tripPhoto)
		.where(and(eq(tripPhoto.id, id), eq(tripPhoto.userId, userId)))
		.returning({ id: tripPhoto.id });
	if (row) await rm(photoFile(row.id), { force: true });
}
