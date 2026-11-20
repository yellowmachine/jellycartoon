import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { ownSave, saveState } from '#lib/server/own-games.ts';

/** A saved game's emulator state (#564), to load it: only the person's own. */
export const GET: RequestHandler = async ({ params, locals }) => {
	const { familyId } = await kitchenOf(locals.user!.id);
	const save = await ownSave(familyId, locals.user!.id, Number(params.id));
	const bytes = await saveState(familyId, save.id);
	if (!bytes) error(404, 'Partida no encontrada');
	return new Response(bytes, {
		headers: { 'content-type': 'application/octet-stream', 'cache-control': 'private, no-cache' }
	});
};
