import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deviceOf, type RequestState } from '#lib/server/kid-login.ts';
import { adultRequestState, watchAdultRequest } from '#lib/server/tv-login.ts';
import { sseResponse } from '#lib/server/sse.ts';

/** The device's page waits here for the answer from the phone: as a child's (#141). */
export const GET: RequestHandler = async ({ params, request, cookies }) => {
	const device = await deviceOf(cookies);
	if (!device) error(403, 'Este dispositivo no es de la casa');
	const now = await adultRequestState(params.id, device.id);
	if (!now) error(404, 'No encontrado');
	return sseResponse<RequestState>(request, (listener) => {
		listener(now);
		return watchAdultRequest(params.id, listener);
	});
};
