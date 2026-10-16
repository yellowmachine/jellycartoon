import { and, eq, inArray } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { musicStar } from '#lib/server/db/schema.ts';
import type { Stars } from './library.ts';

/** Each user's favourites in music apps (#27), by the protocol's ids. */

export async function getStars(userId: string): Promise<Stars> {
	const rows = await db
		.select({ itemId: musicStar.itemId, createdAt: musicStar.createdAt })
		.from(musicStar)
		.where(eq(musicStar.userId, userId));
	return new Map(rows.map((r) => [r.itemId, r.createdAt]));
}

export async function star(userId: string, itemIds: string[]) {
	if (!itemIds.length) return;
	await db
		.insert(musicStar)
		.values(itemIds.map((itemId) => ({ userId, itemId })))
		.onConflictDoNothing();
}

export async function unstar(userId: string, itemIds: string[]) {
	if (!itemIds.length) return;
	await db
		.delete(musicStar)
		.where(and(eq(musicStar.userId, userId), inArray(musicStar.itemId, itemIds)));
}
