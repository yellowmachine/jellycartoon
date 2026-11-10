import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseCallMessage, parseDevice } from '#lib/calls.ts';
import { calls } from '#lib/server/calls.ts';

/**
 * What one side of the call asks (#330): contestar, colgar, or a signal for the other; with
 * `aparato`, this page's id, so only the device in the call talks in it.
 */
export const POST: RequestHandler = async ({ request, params, locals }) => {
	const body: unknown = await request.json().catch(() => null);
	const message = parseCallMessage(body);
	if (!message) error(400, 'Mensaje no válido');
	const device = parseDevice((body as { aparato?: unknown }).aparato);
	const problem = await calls.message(locals.user!.id, params.id, message, device);
	return problem ? json({ problem }, { status: 409 }) : json({ ok: true });
};
