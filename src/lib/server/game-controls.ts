import { and, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { gameControls } from '#lib/server/db/schema.ts';
import { controlsFor, type Controls } from '#lib/game-controls.ts';
import { SYSTEMS } from '#lib/server/games.ts';

/** A person's buttons for a console: the saved ones, or EmulatorJS' own. */
export async function controlsOf(userId: string, system: string) {
	const [row] = await db
		.select({ controls: gameControls.controls })
		.from(gameControls)
		.where(and(eq(gameControls.userId, userId), eq(gameControls.system, system)));
	return controlsFor(SYSTEMS[system].core, row?.controls);
}

export async function saveControls(userId: string, system: string, controls: Controls) {
	await db
		.insert(gameControls)
		.values({ userId, system, controls })
		.onConflictDoUpdate({
			target: [gameControls.userId, gameControls.system],
			set: { controls }
		});
}

/** Back to EmulatorJS' own. */
export async function resetControls(userId: string, system: string) {
	await db
		.delete(gameControls)
		.where(and(eq(gameControls.userId, userId), eq(gameControls.system, system)));
}
