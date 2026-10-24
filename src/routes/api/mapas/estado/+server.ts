import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { report } from '#lib/server/route-maps.ts';
import { isDeviceId, type RouteMapReport } from '#lib/route-maps.ts';

const STATES = new Set<RouteMapReport['state']>(['downloading', 'ready', 'failed', 'removed']);

/** How a route's map is going on the device (#164): `{ id, routeId, state, … }`. */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	if (!isDeviceId(body?.id) || !Number.isInteger(body?.routeId) || !STATES.has(body?.state))
		error(400, 'Bad request');
	const number = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
	await report(body.id, {
		routeId: body.routeId,
		state: body.state,
		progress: number(body.progress),
		bytes: number(body.bytes),
		version: typeof body.version === 'string' ? body.version.slice(0, 40) : undefined,
		problem: typeof body.problem === 'string' ? body.problem.slice(0, 200) : undefined
	});
	return json({ ok: true });
};
