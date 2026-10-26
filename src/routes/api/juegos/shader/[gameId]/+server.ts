import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '#lib/server/db/index.ts';
import { game } from '#lib/server/db/schema.ts';
import { gameScope, isShader } from '#lib/game-shaders.ts';
import { setShader } from '#lib/server/game-shaders.ts';

/**
 * The game's own shader for the whole house, chosen from its menu while playing (#176), as in
 * /juegos/shaders; null, its console's again.
 */
export const PUT: RequestHandler = async ({ params, request }) => {
	const { shader } = await request.json().catch(() => ({}));
	if (shader !== null && !isShader(shader)) error(400, 'Ese shader no existe');
	const [row] = await db
		.select({ id: game.id })
		.from(game)
		.where(eq(game.id, Number(params.gameId)));
	if (!row) error(404, 'Juego no encontrado');
	await setShader(gameScope(row.id), shader);
	return json({ ok: true });
};
