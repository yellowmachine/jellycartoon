import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { addMonths, monthOf, parseEuros } from 'comun/expenses.ts';
import { parseIncomeInput } from 'comun/income.ts';
import { kitchenOf, today } from '#lib/server/fridge.ts';
import { monthTotal } from '#lib/server/expenses/expenses.ts';
import { canReadReceipts } from '#lib/server/expenses/receipt.ts';
import {
	addIncome,
	deleteIncome,
	MAX_DOCUMENT_BYTES,
	monthIncome,
	NotADocument,
	updateIncome
} from '#lib/server/expenses/income.ts';

/**
 * Dinero → Ingresos (#384): a month's (`?mes=2026-10`), one by one with their invoice, and the
 * month's expenses beside them for the difference.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const k = await kitchenOf(locals.user!.id);
	const current = monthOf(today());
	const asked = url.searchParams.get('mes');
	const month =
		asked && /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) && asked <= current ? asked : current;
	const [incomes, spent, canRead] = await Promise.all([
		monthIncome(k, month),
		monthTotal(k, month),
		canReadReceipts(k)
	]);
	return {
		month,
		current,
		incomes,
		spent,
		canRead,
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
	}
};
