import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { saveWalk } from '#lib/server/walks/walks.ts';
import { parseWalk } from '#lib/walks.ts';

/** A finished walk (#410), whole, from the phone that kept it. */
export const POST: RequestHandler = async ({ request, locals }) => {
	const walk = parseWalk(await request.json().catch(() => null));
	if (!walk) error(400, 'Paseo no válido');
	await saveWalk(await kitchenOf(locals.user!.id), walk);
	return json({ kept: true });
};
