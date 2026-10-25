import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { gameSave } from '#lib/server/db/schema.ts';
import { dataRoot } from '#lib/server/library/paths.ts';

/** The saved games of #176: their emulator states (gzipped by the browser) and pictures, by id. */
const savesDir = path.join(dataRoot, 'partidas');
export const saveStateFile = (saveId: number) => path.join(savesDir, `${saveId}.state`);
export const savePictureFile = (saveId: number) => path.join(savesDir, `${saveId}.png`);

/** A person's saved games of a game, the newest first. */
export async function savesOf(userId: string, gameId: number) {
	const rows = await db
		.select({ id: gameSave.id, createdAt: gameSave.createdAt })
		.from(gameSave)
		.where(and(eq(gameSave.userId, userId), eq(gameSave.gameId, gameId)))
		.orderBy(desc(gameSave.createdAt));
	return Promise.all(
		rows.map(async (r) => ({
			id: r.id,
			createdAt: r.createdAt.toISOString(),
			picture: (await stat(savePictureFile(r.id)).catch(() => null))
				? `/api/juegos/partida/${r.id}/imagen`
				: null
		}))
	);
}

/** One of the person's saved games; null if it is not theirs. */
export async function ownSave(userId: string, saveId: number) {
	const [row] = await db
		.select({ id: gameSave.id })
		.from(gameSave)
		.where(and(eq(gameSave.id, saveId), eq(gameSave.userId, userId)));
	return row ?? null;
}

export async function addSave(
	userId: string,
	gameId: number,
	state: Uint8Array,
	png: Uint8Array | null
) {
	const [row] = await db.insert(gameSave).values({ userId, gameId }).returning();
	await mkdir(savesDir, { recursive: true });
	await Promise.all([
		writeFile(saveStateFile(row.id), state),
		png && writeFile(savePictureFile(row.id), png)
	]);
	return row.id;
}

export async function removeSave(saveId: number) {
	await db.delete(gameSave).where(eq(gameSave.id, saveId));
	await Promise.all([
		rm(saveStateFile(saveId), { force: true }),
		rm(savePictureFile(saveId), { force: true })
	]);
}
