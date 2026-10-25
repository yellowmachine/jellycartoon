import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ownSave, removeSave } from '#lib/server/game-saves.ts';

/** One of the person's saved games, deleted from the game's menu. */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	const save = await ownSave(locals.user!.id, Number(params.id));
	if (!save) error(404, 'Partida no encontrada');
	await removeSave(save.id);
	return json({ ok: true });
};
