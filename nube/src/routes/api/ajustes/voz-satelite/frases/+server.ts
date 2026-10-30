import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openRouterKey } from '#lib/server/family-settings.ts';
import { withFamily } from '#lib/server/family.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import { phrasesState, startFillers } from '#lib/server/voice/satellite-voice.ts';

/**
 * The phrases of Ajustes → Familia → «Voz de los satélites» (#301): how they are (GET), and those
 * missing, recorded again (POST), one by one. Only its administrator, with the family's key.
 */
async function adminKitchen(userId: string) {
	const admin = await withFamily(userId, async (_, m) => m.role === 'admin');
	if (!admin) error(403, 'Solo quien administra la familia');
	return kitchenOf(userId);
}

export const GET: RequestHandler = async ({ locals }) =>
	json(await phrasesState(await adminKitchen(locals.user!.id)));

export const POST: RequestHandler = async ({ locals }) => {
	const k = await adminKitchen(locals.user!.id);
	const apiKey = await openRouterKey(k);
	if (!apiKey) error(503, 'La familia no tiene clave de inteligencia artificial');
	await startFillers(k, apiKey);
	return json(await phrasesState(k));
};
