import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { calls } from '#lib/server/calls.ts';

/** «Rechazar», from the call's notice (#330), without opening the app. */
export const POST: RequestHandler = async ({ params, locals }) => {
	const problem = await calls.message(locals.user!.id, params.id, { type: 'reject' }, null);
	return problem ? json({ problem }, { status: 409 }) : json({ ok: true });
};
