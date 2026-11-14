import { bank, fromBunq, userOfHook } from '#lib/server/banks/bank.ts';
import type { RequestHandler } from './$types';

/**
 * bunq's call on each movement of a person's (#502). What it says is not read: only whose it is,
 * by the token, and their new payments are then asked for with their session (bunq.ts). Answered
 * at once, as bunq tries again if it waits; the looking goes on after.
 */
export const POST: RequestHandler = async ({ params, request, getClientAddress }) => {
	// Behind the VPS's proxy: the address it saw, the last one it added.
	const forwarded = request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim();
	const ip = forwarded || getClientAddress();
	if (!fromBunq(ip)) {
		console.warn('[banco] Una llamada que no viene de bunq', { ip });
		return new Response(null, { status: 403 });
	}
	const userId = await userOfHook(params.token);
	if (userId) void bank.sync(userId);
	return new Response(null, { status: 200 });
};
