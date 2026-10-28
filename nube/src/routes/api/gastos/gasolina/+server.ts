import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseExpenseInput } from 'comun/expenses.ts';
import { isLngLat } from 'comun/road.ts';
import { addExpense } from '#lib/server/expenses/expenses.ts';
import { kitchenOf, today } from '#lib/server/fridge.ts';
import { orsFor } from '#lib/server/road/ors.ts';

/** Asking where we are takes at most this: never a fuel stop waiting for a place's name. */
const PLACE_MS = 4000;

/**
 * Fuel, from the road mode (#253; jellycartoon's #194): what was paid, today, in «Gasolina». Typed,
 * it is named after where we are (GPS, asked with the family's openrouteservice key), «Gasolina ·
 * Repsol (Aranjuez)»; read from a receipt (/gastos/leer), as the receipt says, with its lines and
 * its photo kept.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const k = await kitchenOf(locals.user!.id);
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') error(400, 'Petición no válida');
	const receipt = typeof body.receipt === 'string' && body.receipt ? body.receipt : null;
	let store = typeof body.store === 'string' && body.store.trim() ? body.store.trim() : null;
	if (!store && isLngLat(body.position)) {
		const place = await Promise.race([
			orsFor(k)
				.placeName(body.position)
				.catch((err) => {
					console.warn('[gastos] No se pudo saber dónde se echó gasolina', String(err));
					return null;
				}),
			new Promise<null>((resolve) => setTimeout(() => resolve(null), PLACE_MS))
		]);
		if (place) store = `Gasolina · ${place}`;
	}
	const input = parseExpenseInput({
		date: today(),
		store: store ?? 'Gasolina',
		category: 'Gasolina',
		total: body.total,
		lines: Array.isArray(body.lines) ? body.lines : []
	});
	if (!input || input.total <= 0) error(400, 'Falta cuánto, en euros');
	const id = await addExpense(k, input, receipt ? 'ticket' : 'mano', receipt);
	return json({ id, store: input.store, total: input.total });
};
