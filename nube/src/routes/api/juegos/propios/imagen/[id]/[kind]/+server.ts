import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { LIBRETRO_PICTURES, type LibretroPicture } from 'comun/game-systems.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import { libretroImage } from '#lib/server/own-games.ts';

/** A game's box or title screen (#564), libretro's, through Seilide: the browser asks no one else. */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!Object.hasOwn(LIBRETRO_PICTURES, params.kind)) error(404, 'Sin imagen');
	const { familyId } = await kitchenOf(locals.user!.id);
	return libretroImage(familyId, Number(params.id), params.kind as LibretroPicture);
};
