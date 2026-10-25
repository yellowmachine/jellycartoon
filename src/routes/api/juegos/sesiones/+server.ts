import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '#lib/server/db/index.ts';
import { game } from '#lib/server/db/schema.ts';
import { startSession } from '#lib/server/game-sessions.ts';

/** The emulator started (#176): a session of the person in that game. Null if nothing is kept. */
export const POST: RequestHandler = async ({ request, locals }) => {
	const { gameId } = await request.json().catch(() => ({}));
	const [row] = await db
		.select({ id: game.id })
		.from(game)
		.where(eq(game.id, Number(gameId)));
	if (!row) error(404, 'Juego no encontrado');
	return json({ id: await startSession(locals.user!.id, row.id) });
};
