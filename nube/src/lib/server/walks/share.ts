import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import { walk, walkPhoto, walkShare } from '#lib/server/db/schema.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { who } from '#lib/server/trips/trips.ts';
import { MAX_LABEL, MAX_LIVE_SHARES } from '#lib/walk-share.ts';
import { newShareToken } from './share-scope.ts';

/**
 * Paseos shared by link (#434): made, listed and taken back by the walk's own person, in their
 * family (share-scope.ts reads them for whoever has the link).
 */

export type ShareMade =
	{ ok: true; token: string } | { ok: false; problem: string; status: 400 | 404 | 429 };

/** A new link to one's own walk, with the photos chosen among its own. */
export async function createShare(
	k: Kitchen,
	walkId: number,
	options: { label: string | null; photoIds: number[]; trim: boolean }
): Promise<ShareMade> {
	const userId = who(k);
	const label = options.label?.trim().slice(0, MAX_LABEL) || null;
	return k.run(async (tx) => {
		const [own] = await tx
			.select({ id: walk.id })
			.from(walk)
			.where(and(eq(walk.id, walkId), eq(walk.userId, userId)));
		if (!own) return { ok: false, problem: 'Paseo no encontrado', status: 404 };
		const [alive] = await tx
			.select({ n: count() })
			.from(walkShare)
			.where(and(eq(walkShare.userId, userId), isNull(walkShare.revokedAt)));
		if ((alive?.n ?? 0) >= MAX_LIVE_SHARES)
			return {
				ok: false,
				problem: `Ya tienes ${MAX_LIVE_SHARES} enlaces activos: retira alguno antes`,
				status: 429
			};
		const photos = options.photoIds.length
			? await tx
					.select({ id: walkPhoto.id })
					.from(walkPhoto)
					.where(
						and(
							eq(walkPhoto.walkId, walkId),
							eq(walkPhoto.userId, userId),
							inArray(walkPhoto.id, options.photoIds)
						)
					)
			: [];
		const { token, hash } = newShareToken();
		await tx.insert(walkShare).values({
			familyId: k.familyId,
			userId,
			walkId,
			tokenHash: hash,
			label,
			photoIds: photos.map((p) => p.id),
			trim: options.trim
		});
		return { ok: true, token };
	});
}

const listed = {
	id: walkShare.id,
	walkId: walkShare.walkId,
	label: walkShare.label,
	photos: walkShare.photoIds,
	trim: walkShare.trim,
	createdAt: walkShare.createdAt,
	opens: walkShare.opens,
	lastOpenedAt: walkShare.lastOpenedAt,
	revokedAt: walkShare.revokedAt
};

/** All one's links, the newest first, with their walk's day and km. */
export function listShares(k: Kitchen) {
	const userId = who(k);
	return k.run((tx) =>
		tx
			.select({ ...listed, startedAt: walk.startedAt, distance: walk.distance })
			.from(walkShare)
			.innerJoin(walk, eq(walk.id, walkShare.walkId))
			.where(eq(walkShare.userId, userId))
			.orderBy(desc(walkShare.createdAt))
	);
}

/** One walk's links. */
export function walkSharesOf(k: Kitchen, walkId: number) {
	const userId = who(k);
	return k.run((tx) =>
		tx
			.select(listed)
			.from(walkShare)
			.where(and(eq(walkShare.userId, userId), eq(walkShare.walkId, walkId)))
			.orderBy(desc(walkShare.createdAt))
	);
}

/** «Retirar»: the link stops working; the row stays, to say so in the list. */
export async function revokeShare(k: Kitchen, id: number) {
	const userId = who(k);
	await k.run((tx) =>
		tx
			.update(walkShare)
			.set({ revokedAt: new Date() })
			.where(and(eq(walkShare.id, id), eq(walkShare.userId, userId), isNull(walkShare.revokedAt)))
	);
}
