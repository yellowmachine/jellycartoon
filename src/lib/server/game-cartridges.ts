import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { gameCartridge } from '#lib/server/db/schema.ts';
import { dataRoot } from '#lib/server/library/paths.ts';

/** The cartridge saves of #176, gzipped, by id. */
const cartridgesDir = path.join(dataRoot, 'cartuchos');
export const cartridgeFile = (id: number) => path.join(cartridgesDir, `${id}.srm.gz`);

/** A person's cartridge save of a game, or null. */
export async function cartridgeOf(userId: string, gameId: number) {
	const [row] = await db
		.select({ id: gameCartridge.id, updatedAt: gameCartridge.updatedAt })
		.from(gameCartridge)
		.where(and(eq(gameCartridge.userId, userId), eq(gameCartridge.gameId, gameId)));
	return row ?? null;
}

/** Whether anyone has one of this game. */
export async function anyCartridge(gameId: number) {
	const [row] = await db
		.select({ id: gameCartridge.id })
		.from(gameCartridge)
		.where(eq(gameCartridge.gameId, gameId))
		.limit(1);
	return Boolean(row);
}

/** The person's cartridge save of the game, replaced. */
export async function saveCartridge(userId: string, gameId: number, gzipped: Uint8Array) {
	const [row] = await db
		.insert(gameCartridge)
		.values({ userId, gameId })
		.onConflictDoUpdate({
			target: [gameCartridge.userId, gameCartridge.gameId],
			set: { updatedAt: new Date() }
		})
		.returning({ id: gameCartridge.id });
	await mkdir(cartridgesDir, { recursive: true });
	// Never half a save: it is written apart and then put in place.
	const file = cartridgeFile(row.id);
	await writeFile(`${file}.part`, gzipped);
	await rename(`${file}.part`, file);
}
