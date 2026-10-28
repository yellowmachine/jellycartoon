import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { saveMapDevice } from '#lib/server/trips/route-maps.ts';
import { MAX_DEVICE_NAME, isDeviceId } from 'comun/route-maps.ts';

/** This device keeps routes' maps (#164), with this name: `{ id, name }`, its id made on it. */
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await request.json().catch(() => null);
	const name = typeof body?.name === 'string' ? body.name.trim().slice(0, MAX_DEVICE_NAME) : '';
	if (!isDeviceId(body?.id) || !name) error(400, 'Bad request');
	await saveMapDevice(await kitchenOf(locals.user!.id), body.id, name);
	return json({ ok: true });
};
