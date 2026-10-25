import { gzipSync } from 'node:zlib';
import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '#lib/server/db/index.ts';
import { game } from '#lib/server/db/schema.ts';
import { fileResponse } from '#lib/server/file-response.ts';
import {
	anyCartridge,
	cartridgeFile,
	cartridgeOf,
	saveCartridge
} from '#lib/server/game-cartridges.ts';

/** Far more than any cartridge's battery (a Game Boy Advance's, 128 KB). */
const MAX_BYTES = 1024 * 1024;

async function gameId(param: string) {
	const [row] = await db
		.select({ id: game.id })
		.from(game)
		.where(eq(game.id, Number(param)));
	if (!row) error(404, 'Juego no encontrado');
	return row.id;
}

/**
 * The person's cartridge save of the game (#176), gzipped. Without one, whether nobody has any
 * (`nadie`): then the one the browser kept from before can be theirs.
 */
export const GET: RequestHandler = async ({ params, request, locals }) => {
	const id = await gameId(params.gameId);
	const own = await cartridgeOf(locals.user!.id, id);
	if (!own) return json({ nadie: !(await anyCartridge(id)) }, { status: 404 });
	return fileResponse(request, cartridgeFile(own.id), 'application/gzip', 'private, no-cache');
};

/** It, replaced, as the game saved it just now: as it is, kept gzipped. */
export const PUT: RequestHandler = async ({ params, request, locals }) => {
	const id = await gameId(params.gameId);
	const body = new Uint8Array(await request.arrayBuffer());
	if (body.length > MAX_BYTES) error(413, 'Demasiado grande');
	if (!body.length) error(400, 'Vacío');
	await saveCartridge(locals.user!.id, id, gzipSync(body));
	return new Response(null, { status: 204 });
};
