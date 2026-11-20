import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { ownSave, removeSave } from '#lib/server/own-games.ts';

/** One of the person's saved games (#564), deleted from the game's menu. */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	const { familyId } = await kitchenOf(locals.user!.id);
	const save = await ownSave(familyId, locals.user!.id, Number(params.id));
	await removeSave(familyId, save.id);
	return json({ ok: true });
};
