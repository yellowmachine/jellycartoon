import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { familyShape } from '#lib/server/electric.ts';
import { isShape } from '#lib/server/electric-shape.ts';
import { houseRequest } from '#lib/server/house-keys.ts';

/** Lo que baja a la casa (#394): la familia, la de su llave; de la petición, solo qué tabla. */
export const GET: RequestHandler = async ({ params, request, url }) => {
	const { familyId } = await houseRequest(request);
	if (!isShape(params.tabla)) error(404, 'No hay');
	return familyShape(familyId, params.tabla, url.searchParams, request.signal);
};
