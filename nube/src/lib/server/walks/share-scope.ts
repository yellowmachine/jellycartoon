import { createHash, randomBytes } from 'node:crypto';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { user, walk, walkPhoto, walkShare } from '#lib/server/db/schema.ts';
import type { AnyDb } from '#lib/server/family-scope.ts';
import { sharedPieces, sharedPlace, type Piece } from '#lib/walk-share.ts';

/**
 * A walk shared by link (#434), read by whoever has the link, with no session. As a house's key
 * (house-key-scope.ts): in one transaction Postgres is told the token's hash (`app.share_hash`),
 * all that `walk_share_by_token` lets it see; only a live one says its family, and only then its
 * walk and photos are read, as little as is shown. Apart from the app's database, to be tested on
 * PGlite.
 */

/** 32 random bytes: a link that cannot be guessed. */
export const TOKEN = /^[\w-]{43}$/;

export const shareHash = (token: string) => createHash('sha256').update(token).digest('hex');

/** A new link's token: shown once, kept only as its hash. */
export function newShareToken() {
	const token = randomBytes(32).toString('base64url');
	return { token, hash: shareHash(token) };
}

/** Only these are shared, cleaned of what the camera wrote (no-exif.ts). */
const SHAREABLE = /\.(jpe?g|png)$/i;

export interface SharedWalk {
	name: string | null;
	startedAt: Date;
	seconds: number;
	distance: number;
	trimmed: boolean;
	pieces: Piece[];
	photos: { id: number; lon: number | null; lat: number | null }[];
}

export function shareReader(db: AnyDb, { role }: { role?: string } = {}) {
	/** The live share of that token, in its family: null if there is none or it was taken back. */
	async function live(tx: AnyDb, token: string) {
		if (!TOKEN.test(token)) return null;
		if (role) await tx.execute(sql`select set_config('role', ${role}, true)`);
		await tx.execute(sql`select set_config('app.share_hash', ${shareHash(token)}, true)`);
		const [share] = await tx
			.select()
			.from(walkShare)
			.where(and(eq(walkShare.tokenHash, shareHash(token)), isNull(walkShare.revokedAt)));
		if (!share) return null;
		await tx.execute(sql`select set_config('app.family_id', ${share.familyId}, true)`);
		return share;
	}

	/** Its photos still there, of those chosen, that can be shared. */
	async function photosOf(tx: AnyDb, share: typeof walkShare.$inferSelect) {
		if (!share.photoIds.length) return [];
		const rows = await tx
			.select({ id: walkPhoto.id, file: walkPhoto.file, lon: walkPhoto.lon, lat: walkPhoto.lat })
			.from(walkPhoto)
			.where(
				and(
					eq(walkPhoto.walkId, share.walkId),
					eq(walkPhoto.userId, share.userId),
					inArray(walkPhoto.id, share.photoIds)
				)
			)
			.orderBy(asc(walkPhoto.at));
		return rows.filter((p) => SHAREABLE.test(p.file));
	}

	return {
		/** What the page shows; `counted`, someone opening it, not a link's preview. */
		open(token: string, { counted }: { counted: boolean }): Promise<SharedWalk | null> {
			return db.transaction(async (tx) => {
				const share = await live(tx as unknown as AnyDb, token);
				if (!share) return null;
				const t = tx as unknown as AnyDb;
				const [w] = await t
					.select({
						startedAt: walk.startedAt,
						endedAt: walk.endedAt,
						distance: walk.distance,
						line: walk.line
					})
					.from(walk)
					.where(and(eq(walk.id, share.walkId), eq(walk.userId, share.userId)));
				if (!w) return null;
				const [owner] = await t
					.select({ name: user.name })
					.from(user)
					.where(eq(user.id, share.userId));
				const photos = await photosOf(t, share);
				if (counted)
					await t
						.update(walkShare)
						.set({ opens: sql`${walkShare.opens} + 1`, lastOpenedAt: new Date() })
						.where(eq(walkShare.id, share.id));
				return {
					name: owner?.name ?? null,
					startedAt: w.startedAt,
					seconds: (w.endedAt.getTime() - w.startedAt.getTime()) / 1000,
					distance: w.distance,
					trimmed: share.trim,
					pieces: sharedPieces(w.line, share.trim),
					photos: photos.map((p) => ({ id: p.id, ...sharedPlace(w.line, share.trim, p) }))
				};
			});
		},

		/**
		 * Who made that link, also taken back since (#434, phase 2): whoever saw it and asks to come
		 * in is noted as come from them. Null if it never was, or its walk is gone.
		 */
		sharerOf(token: string): Promise<string | null> {
			if (!TOKEN.test(token)) return Promise.resolve(null);
			return db.transaction(async (tx) => {
				const t = tx as unknown as AnyDb;
				if (role) await t.execute(sql`select set_config('role', ${role}, true)`);
				await t.execute(sql`select set_config('app.share_hash', ${shareHash(token)}, true)`);
				const [share] = await t
					.select({ userId: walkShare.userId })
					.from(walkShare)
					.where(eq(walkShare.tokenHash, shareHash(token)));
				return share?.userId ?? null;
			});
		},

		/** One of its photos' file, in its family: null if it is not one of those it shows. */
		photo(token: string, photoId: number) {
			return db.transaction(async (tx) => {
				const share = await live(tx as unknown as AnyDb, token);
				if (!share || !share.photoIds.includes(photoId)) return null;
				const photo = (await photosOf(tx as unknown as AnyDb, share)).find((p) => p.id === photoId);
				return photo ? { familyId: share.familyId, file: photo.file } : null;
			});
		}
	};
}
