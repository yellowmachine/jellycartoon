import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { offlineListsOf } from '#lib/server/music-offline.ts';

/**
 * How the lists carried without coverage go (#350), for the panel while one goes down: from here
 * only, without asking the house (whose key has a limit of its own).
 */
export const GET: RequestHandler = async ({ locals }) =>
	json(await offlineListsOf(await kitchenOf(locals.user!.id)));
