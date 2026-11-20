import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { gameById, startSession } from '#lib/server/own-games.ts';

/** The emulator started (#564): a session of the person in that game. Null if nothing is kept. */
export const POST: RequestHandler = async ({ request, locals }) => {
	const { gameId } = await request.json().catch(() => ({}));
	const { familyId } = await kitchenOf(locals.user!.id);
	const game = await gameById(familyId, Number(gameId));
	return json({ id: await startSession(familyId, locals.user!.id, game.id) });
};
