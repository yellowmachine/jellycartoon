import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deviceOf } from '#lib/server/kid-login.ts';
import { enterAsAdult } from '#lib/server/tv-login.ts';

/** The adult, in on this device once they said yes on their phone: the cookie comes in this answer. */
export const POST: RequestHandler = async ({ request, cookies }) => {
	const device = await deviceOf(cookies);
	if (!device) error(403, 'Este dispositivo no es de la casa');
	const { requestId } = await request.json();
	if (typeof requestId !== 'string') error(400, 'Petición no válida');
	if (!(await enterAsAdult(device, requestId, request.headers)))
		error(403, 'Ya no vale: pídelo otra vez');
	return json({ ok: true });
};
