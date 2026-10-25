import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '#lib/server/db/index.ts';
import { game } from '#lib/server/db/schema.ts';
import { fileResponse } from '#lib/server/file-response.ts';
import { gameBackdropFile, saveGameBackdrop } from '#lib/server/games.ts';

/** A capture of a console's screen is under 100 KB, even at the TV's size; this is far more. */
const MAX_BYTES = 4 * 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The image behind the top of a game's page (#176). Revalidated every time, like the others. */
export const GET: RequestHandler = async ({ params, request }) =>
	fileResponse(request, gameBackdropFile(Number(params.id)), 'image/png', 'private, no-cache');

/** From the game, while playing (static/juegos/emulador.html): this capture from now on. */
export const POST: RequestHandler = async ({ params, request }) => {
	const id = Number(params.id);
	const [row] = await db.select({ id: game.id }).from(game).where(eq(game.id, id));
	if (!row) error(404, 'Juego no encontrado');
	const png = new Uint8Array(await request.arrayBuffer());
	if (png.length > MAX_BYTES || !PNG_SIGNATURE.every((b, i) => png[i] === b))
		error(400, 'No es una captura');
	await saveGameBackdrop(id, png);
	return json({ ok: true });
};
