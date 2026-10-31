import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { HouseProblem } from '#lib/server/house.ts';
import { controlHouse, houseNow } from '#lib/server/prayer-pages.ts';

/**
 * What the whole house plays of Oración (#339), for its page, asked every few seconds while it is
 * open: `now`, or null; `problem`, the house did not answer. POST `{ do, value }`, its bar's
 * buttons (pause, resume, next, previous, stop, or seek to `value` seconds): `{ problem }`.
 */
export const GET: RequestHandler = async ({ locals }) => {
	try {
		return json({ now: await houseNow(locals), problem: null });
	} catch (err) {
		if (!(err instanceof HouseProblem)) throw err;
		return json({ now: null, problem: err.message });
	}
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await request.json().catch(() => null);
	const problem = await controlHouse(locals, String(body?.do), body?.value);
	return json({ problem }, { status: problem ? 400 : 200 });
};
