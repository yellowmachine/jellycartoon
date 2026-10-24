import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deviceOf } from '#lib/server/kid-login.ts';
import { askAsAdult } from '#lib/server/tv-login.ts';

/** An adult chose their drawing (#172): the QR for this device, and a notice on their phone. */
export const POST: RequestHandler = async ({ request, cookies }) => {
	const device = await deviceOf(cookies);
	if (!device) error(403, 'Este dispositivo no es de la casa');
	const { userId } = await request.json();
	if (typeof userId !== 'string') error(400, 'Petición no válida');
	const result = await askAsAdult(userId, device);
	if ('error' in result) error(429, result.error);
	return json(result);
};
