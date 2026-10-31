import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { unblock } from '#lib/server/ai-block.ts';
import { keepBlock, openRouterKey } from '#lib/server/family-settings.ts';
import { withFamily } from '#lib/server/family.ts';
import { kitchenOf } from '#lib/server/fridge.ts';

/** The banner's «Ya he recargado», for who runs the family: its AI goes on (ai-block.ts). */
export const POST: RequestHandler = async ({ locals }) => {
	const admin = await withFamily(locals.user!.id, async (_, m) => m.role === 'admin');
	if (!admin) error(403, 'Solo quien administra la familia');
	const k = await kitchenOf(locals.user!.id);
	const apiKey = await openRouterKey(k);
	if (apiKey) unblock(apiKey);
	// Also if this process did not have it stopped: the banner goes.
	await keepBlock(k, null);
	return new Response(null, { status: 204 });
};
