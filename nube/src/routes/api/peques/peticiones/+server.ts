import type { RequestHandler } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { pendingFor, watchRequestsFor } from '#lib/server/kid-login.ts';
import { sseResponse } from '#lib/server/sse.ts';

type Pending = Awaited<ReturnType<typeof pendingFor>>;

/** An adult's pages (#303): their children asking to enter, live. A child is not let here. */
export const GET: RequestHandler = async ({ request, locals }) => {
	const k = await kitchenOf(locals.user!.id);
	return sseResponse<Pending>(request, (listener) => {
		const send = () => void pendingFor(k).then(listener);
		send();
		return watchRequestsFor(k.userId!, send);
	});
};
