import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseExpenseInput, type ExpenseSource } from 'comun/expenses.ts';
import { addExpense, favoriteExpenses } from '#lib/server/expenses/expenses.ts';
import { houseRequest } from '#lib/server/house-keys.ts';

/** The family's favourite expenses, for its house's voice («apunta el café de siempre»). */
export const GET: RequestHandler = async ({ request }) =>
	json({ favorites: await favoriteExpenses(await houseRequest(request)) });

/** What the house can put in: by voice, typed (the road mode's fuel), or from a receipt it read. */
const SOURCES: ExpenseSource[] = ['voz', 'mano', 'ticket'];

/**
 * An expense from the house (#253): said by voice, or the road mode's fuel (with a receipt read by
 * /api/casa/gastos/leer, kept with it). In the name of who spoke, if they are of the family.
 */
export const POST: RequestHandler = async ({ request }) => {
	const k = await houseRequest(request);
	const body = await request.json().catch(() => null);
	const input = parseExpenseInput(body?.expense);
	if (!input || input.total <= 0) error(400, 'Gasto no válido');
	const source = SOURCES.find((s) => s === body.source);
	if (!source) error(400, 'Origen no válido');
	const receipt = typeof body.receipt === 'string' && body.receipt ? body.receipt : null;
	return json({ id: await addExpense(k, input, source, receipt) });
};
