import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ringingFor, watchAlarms } from '#lib/server/alarms/alarms.ts';
import { sseResponse } from '#lib/server/sse.ts';

/**
 * A voice satellite's alarms and timers (#241), live, with its key: what rings where it is (in it
 * or in the whole house), which «hola casita» stops; and what it has to say itself on its own
 * speaker (`play`), when it does not answer through Snapcast. Again on every change.
 */
export const GET: RequestHandler = async ({ request, locals }) => {
	const satellite = locals.satellite;
	if (!satellite) error(404, 'No encontrado');
	return sseResponse<Awaited<ReturnType<typeof ringingFor>>>(request, (listener) => {
		const send = () => void ringingFor(satellite.id).then(listener);
		send();
		return watchAlarms(send);
	});
};
