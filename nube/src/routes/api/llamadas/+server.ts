import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseDevice } from '#lib/calls.ts';
import { calls } from '#lib/server/calls.ts';

/**
 * A call to someone of the family (#330): `{ to, aparato }`, their account and this page's id.
 * Its id, or why not.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = (await request.json().catch(() => null)) as {
		to?: unknown;
		aparato?: unknown;
	} | null;
	const device = parseDevice(body?.aparato);
	if (typeof body?.to !== 'string' || !body.to || !device) error(400, 'A quién, y desde dónde');
	const made = await calls.start(locals.user!.id, body.to, device);
	return 'problem' in made ? json(made, { status: 409 }) : json(made);
};
