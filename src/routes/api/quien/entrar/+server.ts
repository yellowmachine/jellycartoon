import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deviceOf, enter } from '#lib/server/kid-login.ts';

/**
 * The child, in: with its approved request, or with a permission running on this device. The
 * session's cookie comes in this answer.
 */
export const POST: RequestHandler = async ({ request, cookies }) => {
	const device = await deviceOf(cookies);
	if (!device) error(403, 'Este dispositivo no es de la casa');
	const { requestId, kidId } = await request.json();
	const by =
		typeof requestId === 'string' ? { requestId } : typeof kidId === 'string' ? { kidId } : null;
	if (!by) error(400, 'Petición no válida');
	const entered = await enter(device, by);
	if (!entered) error(403, 'Ya no tiene permiso: pídelo otra vez');
	return json({ ok: true });
};
