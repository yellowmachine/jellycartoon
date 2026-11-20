import type { RequestHandler } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { romResponse } from '#lib/server/own-games.ts';

/** A game's file from the family's bucket (#564), or its BIOS, as the emulator asks for them. */
export const GET: RequestHandler = async ({ params, request, locals }) => {
	const { familyId } = await kitchenOf(locals.user!.id);
	return romResponse(familyId, Number(params.id), params.file, request.headers.get('range'));
};
