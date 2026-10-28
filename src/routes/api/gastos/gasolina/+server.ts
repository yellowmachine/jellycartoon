import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isKid } from '#lib/server/kids.ts';
import { addExpense, CloudProblem } from '#lib/server/kitchen.ts';
import { placeName } from '#lib/server/road/ors.ts';
import { log } from '#lib/server/log.ts';
import { today } from '#lib/server/playlist.ts';
import { parseExpenseInput } from 'comun/expenses.ts';
import type { LngLat } from '#lib/road.ts';

/** Asking where we are takes at most this: never a fuel stop waiting for a place's name. */
const PLACE_MS = 4000;

const isPoint = (value: unknown): value is LngLat =>
	Array.isArray(value) &&
	value.length === 2 &&
	value.every((n) => typeof n === 'number' && Number.isFinite(n));

/**
 * Fuel, from the road mode (#194): what was paid, today, in «Gasolina», in the family's Gastos in
 * the cloud (#253). Typed, it is named after where we are (GPS, asked here, at home), «Gasolina ·
 * Repsol (Aranjuez)»; read from a receipt (/api/gastos/leer), as the receipt says, with its lines
 * and its photo kept there.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (isKid(locals.user)) error(404, 'No encontrado');
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') error(400, 'Petición no válida');
	const receipt = typeof body.receipt === 'string' && body.receipt ? body.receipt : null;
	let store = typeof body.store === 'string' && body.store.trim() ? body.store.trim() : null;
	if (!store && isPoint(body.position)) {
		const place = await Promise.race([
			placeName(body.position).catch((err) => {
				log.warn('gastos', 'No se pudo saber dónde se echó gasolina', { error: err });
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
	try {
		const { id } = await addExpense(locals.user!.id, input, receipt ? 'ticket' : 'mano', {
			receipt
		});
		return json({ id, store: input.store, total: input.total });
	} catch (err) {
		if (err instanceof CloudProblem) error(502, err.message);
		throw err;
	}
};
