import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '#lib/server/db/index.ts';
import { game } from '#lib/server/db/schema.ts';
import { addSave, savesOf } from '#lib/server/game-saves.ts';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

async function gameId(param: string) {
	const [row] = await db
		.select({ id: game.id })
		.from(game)
		.where(eq(game.id, Number(param)));
	if (!row) error(404, 'Juego no encontrado');
	return row.id;
}

/** The person's saved games of this game (#176), the newest first. */
export const GET: RequestHandler = async ({ params, locals }) =>
	json(await savesOf(locals.user!.id, await gameId(params.gameId)));

/** A new one, from the game's menu: the emulator's state and, if there is one, a picture of it. */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const id = await gameId(params.gameId);
	const form = await request.formData();
	const state = form.get('estado');
	const picture = form.get('imagen');
	if (!(state instanceof File) || !state.size) error(400, 'Falta el estado');
	// Optional: the browser may have had none to give.
	const png = picture instanceof File ? new Uint8Array(await picture.arrayBuffer()) : null;
	if (png && !PNG_SIGNATURE.every((b, i) => png[i] === b)) error(400, 'La imagen no es un PNG');
	const saveId = await addSave(locals.user!.id, id, new Uint8Array(await state.arrayBuffer()), png);
	return json({ id: saveId });
};
