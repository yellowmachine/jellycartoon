import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { askToEnter, deviceOf } from '#lib/server/kid-login.ts';

/** A child chose its avatar: its parents are asked, unless it has a permission running here. */
export const POST: RequestHandler = async ({ request, cookies }) => {
	const device = await deviceOf(cookies);
	if (!device) error(403, 'Este dispositivo no es de la casa');
	const { kidId } = await request.json();
	if (typeof kidId !== 'string') error(400, 'Petición no válida');
	const result = await askToEnter(kidId, device);
	if ('error' in result) error(429, result.error);
	return json(result);
};
