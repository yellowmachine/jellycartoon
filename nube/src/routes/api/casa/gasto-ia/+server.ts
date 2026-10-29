import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { addAiCost } from '#lib/server/expenses/ai-costs.ts';
import { houseRequest } from '#lib/server/house-keys.ts';

/**
 * What a request of the house to the AI cost (#193): kept with the cloud's, for Gastos → IA. With
 * the house's id for it (`id`), one sent again is not counted twice; failing, the house keeps it.
 */
export const POST: RequestHandler = async ({ request }) => {
	const k = await houseRequest(request);
	const body = await request.json().catch(() => null);
	const label = typeof body?.label === 'string' ? body.label.trim() : '';
	const cost = Number(body?.cost);
	const at = typeof body?.at === 'string' ? new Date(body.at) : new Date();
	const ref = typeof body?.id === 'string' && body.id.length <= 64 ? body.id : null;
	if (!label || !(cost > 0 && cost < 1000) || Number.isNaN(at.getTime()))
		error(400, 'Coste no válido');
	await addAiCost(k.familyId, 'casa', label, cost, at, ref);
	return json({ ok: true });
};
