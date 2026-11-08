import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { reportOfflineGame } from '#lib/server/games-offline.ts';
import type { OfflineGameReport } from '#lib/offline-games.ts';
import { isDeviceId } from 'comun/route-maps.ts';

const STATES = new Set<OfflineGameReport['state']>(['downloading', 'ready', 'failed']);
const text = (v: unknown) => (typeof v === 'string' && v && v.length <= 500 ? v : null);

/** How a game carried without coverage goes on the device: `{ id, system, file, state, bytes }`. */
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await request.json().catch(() => null);
	const [system, file] = [text(body?.system), text(body?.file)];
	if (
		!isDeviceId(body?.id) ||
		!system ||
		!file ||
		!STATES.has(body?.state) ||
		!Number.isInteger(body?.bytes) ||
		body.bytes < 0
	)
		error(400, 'Bad request');
	await reportOfflineGame(await kitchenOf(locals.user!.id), body.id, {
		system,
		file,
		state: body.state,
		bytes: body.bytes,
		problem: typeof body.problem === 'string' ? body.problem.slice(0, 200) : undefined
	});
	return json({ ok: true });
};
