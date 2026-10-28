import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { parseBillInput } from '#lib/bills.ts';
import { addMonths, isCategory, monthOf, parseExpenseInput } from '#lib/expenses.ts';
import { isKid } from '#lib/server/kids.ts';
import { today } from '#lib/server/playlist.ts';
import {
	addDueRecurring,
	addExpense,
	addRecurring,
	deleteExpense,
	deleteFavorite,
	deleteRecurring,
	favoriteExpenses,
	monthExpenses,
	monthTotal,
	recurringExpenses,
	saveFavorite,
	updateExpense,
	updateRecurring
} from '#lib/server/expenses/expenses.ts';
import { canReadReceipts } from '#lib/server/expenses/receipt.ts';

/**
 * The house's expenses (#194), for its adults: a month's (`?mes=2026-10`), by category and one by
 * one, the fixed ones, and «📷 Ticket». The fixed ones whose day has come are added on opening.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	if (isKid(locals.user)) redirect(303, '/');
	const current = monthOf(today());
	const asked = url.searchParams.get('mes');
	const month =
		asked && /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) && asked <= current ? asked : current;
	await addDueRecurring();
	const [expenses, previous, recurring, favorites, canRead] = await Promise.all([
		monthExpenses(month),
		monthTotal(addMonths(month, -1)),
		recurringExpenses(),
		favoriteExpenses(),
		canReadReceipts()
	]);
	return { month, current, expenses, previous, recurring, favorites, canRead, today: today() };
};

const adult = (locals: App.Locals) => {
	if (isKid(locals.user)) error(404, 'No encontrado');
	return locals.user!.id;
};

/** A fixed one as the form sends it, or why not. */
function recurringFrom(form: FormData) {
	const name = String(form.get('name') ?? '')
		.trim()
		.slice(0, 120);
	const category = form.get('category');
	const amount = Number(form.get('amount'));
	const day = Number(form.get('day'));
	if (!name || !isCategory(category) || !Number.isInteger(amount) || amount <= 0) return null;
	if (!Number.isInteger(day) || day < 1 || day > 28) return null;
	return { name, category, amount, day };
}

export const actions: Actions = {
	/** New (from a receipt read, by hand) or corrected: `expense` as JSON, as the page has it. */
	save: async ({ request, locals }) => {
		const userId = adult(locals);
		const form = await request.formData();
		let body: unknown;
		try {
			body = JSON.parse(String(form.get('expense') ?? ''));
		} catch {
			return fail(400, { message: 'Gasto no válido' });
		}
		const input = parseExpenseInput(body);
		if (!input)
			return fail(400, { message: 'Falta algo: la fecha, dónde, la categoría o el total' });
		// A bill's (#232): its supply, sent apart.
		const billBody = (body as { bill?: unknown }).bill ?? null;
		const bill = billBody === null ? null : parseBillInput(billBody);
		if (billBody !== null && !bill)
			return fail(400, { message: 'Falta algo de la factura: el periodo o el consumo' });
		const id = Number(form.get('id'));
		if (id) {
			if (!(await updateExpense(id, input, bill)))
				return fail(404, { message: 'Ese gasto ya no está' });
			return { saved: id };
		}
		const receipt = String(form.get('receipt') ?? '') || null;
		const source = bill ? 'factura' : receipt ? 'ticket' : 'mano';
		return { saved: await addExpense(userId, input, source, receipt, null, bill) };
	},
	delete: async ({ request, locals }) => {
		adult(locals);
		await deleteExpense(Number((await request.formData()).get('id')));
	},
	/** «☆ Favorito»: the form's expense as it is, without its day; the amount, if written. */
	saveFavorite: async ({ request, locals }) => {
		const userId = adult(locals);
		let body: unknown;
		try {
			body = JSON.parse(String((await request.formData()).get('favorite') ?? ''));
		} catch {
			return fail(400, { message: 'Favorito no válido' });
		}
		const typedTotal = (body as { total?: unknown })?.total;
		const input = parseExpenseInput({ ...(body as object), date: today(), total: typedTotal ?? 0 });
		if (!input) return fail(400, { message: 'Para un favorito hace falta dónde y la categoría' });
		const { store, category, lines } = input;
		await saveFavorite(userId, {
			store,
			category,
			lines,
			total: typedTotal == null ? null : input.total
		});
		return { favorite: store };
	},
	deleteFavorite: async ({ request, locals }) => {
		adult(locals);
		await deleteFavorite(Number((await request.formData()).get('id')));
	},
	saveRecurring: async ({ request, locals }) => {
		const userId = adult(locals);
		const form = await request.formData();
		const r = recurringFrom(form);
		if (!r) return fail(400, { message: 'Falta algo: el nombre, el importe o el día (1 a 28)' });
		const id = Number(form.get('id'));
		if (id) await updateRecurring(id, r);
		else await addRecurring(userId, r);
		await addDueRecurring();
	},
	deleteRecurring: async ({ request, locals }) => {
		adult(locals);
		await deleteRecurring(Number((await request.formData()).get('id')));
	}
};
