import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { reportOffline } from '#lib/server/music-offline.ts';
import type { OfflineListReport } from '#lib/offline-music.ts';
import { isDeviceId } from 'comun/route-maps.ts';

const STATES = new Set<OfflineListReport['state']>(['downloading', 'ready', 'failed']);
const count = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 ? (v as number) : null);

/** How a list carried without coverage goes on the device (#350): `{ id, playlistId, state, … }`. */
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await request.json().catch(() => null);
	const [held, total, bytes] = [count(body?.held), count(body?.total), count(body?.bytes)];
	if (
		!isDeviceId(body?.id) ||
		!Number.isInteger(body?.playlistId) ||
		!STATES.has(body?.state) ||
		held === null ||
		total === null ||
		bytes === null
	)
		error(400, 'Bad request');
	await reportOffline(await kitchenOf(locals.user!.id), body.id, {
		playlistId: body.playlistId,
		state: body.state,
		held,
		total,
		bytes,
		problem: typeof body.problem === 'string' ? body.problem.slice(0, 200) : undefined
	});
	return json({ ok: true });
};
