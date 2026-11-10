import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { TURN_HOST, TURN_SECRET } from '$app/env/private';
import { iceServers } from '#lib/server/turn.ts';

/** The way to the other side, for a call starting (#330): coturn, with a password of a day. */
export const GET: RequestHandler = ({ locals }) =>
	json(iceServers(locals.user!.id, { host: TURN_HOST, secret: TURN_SECRET }), {
		headers: { 'cache-control': 'no-store' }
	});
