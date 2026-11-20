import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { addSave, gameById, savesOf } from '#lib/server/own-games.ts';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The person's saved games of a game of the family's bucket (#564), the newest first. */
export const GET: RequestHandler = async ({ params, locals }) => {
	const { familyId } = await kitchenOf(locals.user!.id);
	const game = await gameById(familyId, Number(params.gameId));
	return json(await savesOf(familyId, locals.user!.id, game.id));
};

/** A new one, from the game's menu: the emulator's state and, if there is one, a picture of it. */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { familyId } = await kitchenOf(locals.user!.id);
	const game = await gameById(familyId, Number(params.gameId));
	const form = await request.formData();
	const state = form.get('estado');
	const picture = form.get('imagen');
	if (!(state instanceof File) || !state.size) error(400, 'Falta el estado');
	// Optional: the browser may have had none to give.
	const png = picture instanceof File ? new Uint8Array(await picture.arrayBuffer()) : null;
	if (png && !PNG_SIGNATURE.every((b, i) => png[i] === b)) error(400, 'La imagen no es un PNG');
	const id = await addSave(
		familyId,
		locals.user!.id,
		game.id,
		new Uint8Array(await state.arrayBuffer()),
		png
	);
	return json({ id });
};
