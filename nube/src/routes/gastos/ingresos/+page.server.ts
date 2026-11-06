import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { addMonths, monthOf, parseEuros } from 'comun/expenses.ts';
import { parseIncomeInput, parseRecurringIncome } from 'comun/income.ts';
import { kitchenOf, today } from '#lib/server/fridge.ts';
import { addDueRecurring, monthTotal } from '#lib/server/expenses/expenses.ts';
import { canReadReceipts } from '#lib/server/expenses/receipt.ts';
import {
	addDueRecurringIncome,
	addIncome,
	addRecurringIncome,
	deleteIncome,
	deleteRecurringIncome,
	makeRecurringIncome,
	MAX_DOCUMENT_BYTES,
	monthIncome,
	NotADocument,
	recurringIncomes,
	updateIncome,
	updateRecurringIncome
} from '#lib/server/expenses/income.ts';

/**
 * Dinero → Ingresos (#384): a month's (`?mes=2026-10`), one by one with their invoice, and the
 * month's expenses beside them for the difference. And the fixed ones, added on their day: the
 * expenses' too, or the difference would leave them out until Gastos was opened.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const k = await kitchenOf(locals.user!.id);
	const current = monthOf(today());
	const asked = url.searchParams.get('mes');
	const month =
		asked && /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) && asked <= current ? asked : current;
	await Promise.all([addDueRecurring(k), addDueRecurringIncome(k, today())]);
	const [incomes, spent, canRead, recurring] = await Promise.all([
		monthIncome(k, month),
		monthTotal(k, month),
		canReadReceipts(k),
		recurringIncomes(k)
	]);
	return {
		month,
		current,
		incomes,
		spent,
		canRead,
		recurring,
		today: today(),
		previousMonth: addMonths(month, -1)
	};
};

/** Its invoice as sent, if any; or why not. */
async function documentFrom(form: FormData) {
	const file = form.get('factura');
	if (!(file instanceof File) || !file.size) return { file: null };
	if (file.size > MAX_DOCUMENT_BYTES) return { problem: 'La factura pasa de 10 MB' };
	return { file: new Uint8Array(await file.arrayBuffer()) };
}

/** A fixed one as the form sends it, or null. */
function recurringFrom(form: FormData) {
	return parseRecurringIncome({
		concept: form.get('concept'),
		category: form.get('category'),
		amount: parseEuros(String(form.get('amount') ?? '')),
		day: Number(form.get('day')),
		// Every year, in its month; else every month.
		month: form.get('every') === 'año' ? Number(form.get('month')) : null
	});
}

export const actions: Actions = {
	/** New, or corrected (with `id`): its invoice changed if one is sent, or taken away. */
	save: async ({ request, locals }) => {
		const k = await kitchenOf(locals.user!.id);
		const form = await request.formData();
		const input = parseIncomeInput({
			date: form.get('date'),
			concept: form.get('concept'),
			category: form.get('category'),
			amount: parseEuros(String(form.get('amount') ?? ''))
		});
		if (!input)
			return fail(400, { message: 'Falta algo: la fecha, qué fue, la categoría o el importe' });
		const document = await documentFrom(form);
		if ('problem' in document) return fail(400, { message: document.problem });
		const id = Number(form.get('id'));
		try {
			if (id) {
				const done = await updateIncome(k, id, input, {
					file: document.file,
					dropDocument: form.get('quitarFactura') === 'on'
				});
				if (!done) return fail(404, { message: 'Ese ingreso ya no está' });
				return { saved: id };
			}
			return { saved: await addIncome(k, input, document.file) };
		} catch (err) {
			if (err instanceof NotADocument) return fail(400, { message: err.message });
			throw err;
		}
	},
	delete: async ({ request, locals }) => {
		const k = await kitchenOf(locals.user!.id);
		await deleteIncome(k, Number((await request.formData()).get('id')));
	},
	saveRecurring: async ({ request, locals }) => {
		const k = await kitchenOf(locals.user!.id);
		const form = await request.formData();
		const r = recurringFrom(form);
		if (!r)
			return fail(400, { message: 'Falta algo: qué es, el importe, el día (1 a 28) o el mes' });
		const id = Number(form.get('id'));
		if (id) await updateRecurringIncome(k, id, r, today());
		else await addRecurringIncome(k, r, today());
	},
	/** «🔁»: an income written down, every month or every year from its day. */
	makeRecurring: async ({ request, locals }) => {
		const k = await kitchenOf(locals.user!.id);
		const form = await request.formData();
		if (
			!(await makeRecurringIncome(k, Number(form.get('id')), form.get('every') === 'año', today()))
		)
			return fail(404, { message: 'Ese ingreso ya no está' });
	},
	deleteRecurring: async ({ request, locals }) => {
		const k = await kitchenOf(locals.user!.id);
		await deleteRecurringIncome(k, Number((await request.formData()).get('id')));
	}
};
