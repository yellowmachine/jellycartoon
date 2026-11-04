import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { moneyDocuments } from '#lib/server/expenses/documents.ts';
import { kitchenOf } from '#lib/server/fridge.ts';

/**
 * «También en Dinero», as Papeles searches. By POST: what is looked for among the family's papers
 * («biopsia») must not stay in an address, and so in a log. A child does not get here (kids.ts).
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await request.json().catch(() => null);
	const text = typeof body?.q === 'string' ? body.q.trim().slice(0, 100) : '';
	if (text.length < 2) error(400, 'Falta qué buscar');
	return json(await moneyDocuments(await kitchenOf(locals.user!.id), text), {
		headers: { 'Cache-Control': 'private, no-store' }
	});
};
