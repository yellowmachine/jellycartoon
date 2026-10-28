import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { addItems, addNote, fridgeState, tickOffByName, toBuy } from '#lib/server/fridge.ts';
import { houseRequest } from '#lib/server/house-keys.ts';
import { MAX_ITEM } from 'comun/fridge.ts';

/**
 * The family's fridge, for its house (jellycartoon): the whole of it (its TV), and what is left to
 * buy (its voice).
 */
export const GET: RequestHandler = async ({ request }) => {
	const k = await houseRequest(request);
	const [fridge, left] = await Promise.all([fridgeState(k), toBuy(k)]);
	return json({ fridge, toBuy: left });
};

/**
 * What the house's voice does on it: items onto the list (`add`), one ticked off by its name
 * (`tick`), a post-it (`note`, with its last day or none). In the name of who spoke, if known.
 */
export const POST: RequestHandler = async ({ request }) => {
	const k = await houseRequest(request);
	const body = await request.json().catch(() => null);
	switch (body?.action) {
		case 'add': {
			const items = body.items;
			if (
				!Array.isArray(items) ||
				items.length > 50 ||
				!items.every((t: unknown) => typeof t === 'string' && t.length <= MAX_ITEM * 2)
			)
				error(400, 'Petición no válida');
			return json({ added: await addItems(k, items) });
		}
		case 'tick': {
			if (typeof body.text !== 'string' || !body.text.trim()) error(400, 'Falta el texto');
			return json({ ticked: await tickOffByName(k, body.text) });
		}
		case 'note': {
			if (typeof body.text !== 'string' || !body.text.trim()) error(400, 'Falta el texto');
			const until =
				typeof body.until === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.until)
					? body.until
					: null;
			return json({ id: await addNote(k, body.text, until) });
		}
		default:
			error(400, 'Petición no válida');
	}
};
