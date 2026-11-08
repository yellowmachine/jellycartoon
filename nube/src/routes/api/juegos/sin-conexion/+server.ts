import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { offlineGamesOf } from '#lib/server/games-offline.ts';

/** How the games carried without coverage go, for the panel while one goes down: from here only. */
export const GET: RequestHandler = async ({ locals }) =>
	json(await offlineGamesOf(await kitchenOf(locals.user!.id)));
