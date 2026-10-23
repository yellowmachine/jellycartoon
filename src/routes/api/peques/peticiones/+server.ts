import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isKid } from '#lib/server/kids.ts';
import { pendingFor, watchRequestsFor } from '#lib/server/kid-login.ts';
import { sseResponse } from '#lib/server/sse.ts';

type Pending = Awaited<ReturnType<typeof pendingFor>>;

/** A parent's pages: its children asking to enter, live. */
export const GET: RequestHandler = async ({ request, locals }) => {
	if (isKid(locals.user)) error(404, 'No encontrado');
	const adultId = locals.user!.id;
	return sseResponse<Pending>(request, (listener) => {
		const send = () => void pendingFor(adultId).then(listener);
		send();
		return watchRequestsFor(adultId, send);
	});
};
