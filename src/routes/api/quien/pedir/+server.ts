import { error, json } from '@sveltejs/kit';
import QRCode from 'qrcode';
import { ORIGIN } from '$app/env/private';
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
	if (!('requestId' in result)) return json(result);
	// For an adult beside it, notice or not: read, it opens the answer on their phone.
	const qr = await QRCode.toString(`${ORIGIN}/peques/permiso/${result.requestId}`, {
		type: 'svg',
		margin: 1
	});
	return json({ ...result, qr });
};
