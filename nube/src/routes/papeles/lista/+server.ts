import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { familyPapers, papersReady } from '#lib/server/papers.ts';

/**
 * The family's papers to choose from, for an event of the agenda (#399): asked only when choosing,
 * so that looking at the agenda does not read them all. Kept in no cache.
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!papersReady()) error(503, 'Papeles no está disponible ahora');
	const papers = await familyPapers(await kitchenOf(locals.user!.id));
	return json(
		papers.flatMap((p) => (p.name === null ? [] : [{ id: p.id, name: p.name }])),
		{ headers: { 'Cache-Control': 'private, no-store' } }
	);
};
