import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { noteAiCost } from '#lib/server/expenses/ai-costs.ts';
import { houseRequest } from '#lib/server/house-keys.ts';

/** What a request of the house to the AI cost (#193): kept with the cloud's, for Gastos → IA. */
export const POST: RequestHandler = async ({ request }) => {
	const k = await houseRequest(request);
	const body = await request.json().catch(() => null);
	const label = typeof body?.label === 'string' ? body.label.trim() : '';
	const cost = Number(body?.cost);
	const at = typeof body?.at === 'string' ? new Date(body.at) : new Date();
	if (!label || !(cost > 0 && cost < 1000) || Number.isNaN(at.getTime()))
		error(400, 'Coste no válido');
	await noteAiCost(k.familyId, 'casa', label, cost, at);
	return json({ ok: true });
};
