import { error, json } from '@sveltejs/kit';
import QRCode from 'qrcode';
import type { RequestHandler } from './$types';
import { ORIGIN } from '$app/env/private';
import { askToEnter, deviceOf } from '#lib/server/kid-login.ts';

/**
 * A child chose its drawing (#303): its adults are asked, unless it has a permission running here.
 * With the question, a QR for the device's screen: an adult beside it reads it (with Seilide's
 * «Leer el QR de un peque» or the phone's own camera) and answers there, notice or not.
 */
export const POST: RequestHandler = async ({ request, cookies }) => {
	const device = await deviceOf(cookies);
	if (!device) error(403, 'Este aparato no es de la familia');
	const { kidId } = await request.json().catch(() => ({}));
	if (typeof kidId !== 'string') error(400, 'Petición no válida');
	const result = await askToEnter(device, kidId);
	if ('error' in result) error(429, result.error);
	if (!('requestId' in result)) return json(result);
	const qr = await QRCode.toString(`${ORIGIN}/peques/permiso/${result.requestId}`, {
		type: 'svg',
		margin: 1
	});
	return json({ ...result, qr });
};
