import { gzipSync } from 'node:zlib';
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { cartridgeOf, gameById, saveCartridge } from '#lib/server/own-games.ts';

/** Far more than any cartridge's battery (a Game Boy Advance's, 128 KB). */
const MAX_BYTES = 1024 * 1024;

/**
 * The person's cartridge save of a game of the family's bucket (#564), gzipped, as the house's.
 * Without one, whether nobody has any (`nadie`): then the one the browser kept can be theirs.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	const { familyId } = await kitchenOf(locals.user!.id);
	const game = await gameById(familyId, Number(params.gameId));
	const { bytes, nobody } = await cartridgeOf(familyId, locals.user!.id, game.id);
	if (!bytes) return json({ nadie: nobody }, { status: 404 });
	return new Response(bytes, {
		headers: { 'content-type': 'application/gzip', 'cache-control': 'private, no-cache' }
	});
};

/** It, replaced, as the game saved it just now: kept gzipped. */
export const PUT: RequestHandler = async ({ params, request, locals }) => {
	const { familyId } = await kitchenOf(locals.user!.id);
	const game = await gameById(familyId, Number(params.gameId));
	const body = new Uint8Array(await request.arrayBuffer());
	if (body.length > MAX_BYTES) error(413, 'Demasiado grande');
	if (!body.length) error(400, 'Vacío');
	await saveCartridge(familyId, locals.user!.id, game.id, gzipSync(body));
	return new Response(null, { status: 204 });
};
