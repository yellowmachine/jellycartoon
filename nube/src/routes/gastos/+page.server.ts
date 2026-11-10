import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { parseBillInput } from 'comun/bills.ts';
import { addMonths, isCategory, monthOf, parseExpenseInput } from 'comun/expenses.ts';
import { kitchenOf, setItemsDone, today } from '#lib/server/fridge.ts';
import { tickOffBought } from '#lib/server/expenses/bought-list.ts';
import {
	addDueRecurring,
	addExpense,
	addRecurring,
	deleteExpense,
	deleteFavorite,
	deleteRecurring,
	favoriteExpenses,
	makeRecurring,
	monthExpenses,
	monthTotal,
	recurringExpenses,
	saveFavorite,
	updateExpense,
	updateRecurring
} from '#lib/server/expenses/expenses.ts';
import { canReadReceipts, receiptFrom } from '#lib/server/expenses/receipt.ts';
import {
	isFileHash,
	lookingSame,
	markNotSame,
	monthRepeated
} from '#lib/server/expenses/duplicates.ts';
import { setNoticeKind } from '#lib/server/page-notices.ts';
import { ownTags, tagLine } from '#lib/server/expenses/own-tags.ts';
import { isPageNoticeKind } from 'comun/page-notices.ts';
import {
	addDueRecurringIncome,
	monthIncomeTotal,
	NotADocument
} from '#lib/server/expenses/income.ts';

/**
 * The family's expenses (#253; jellycartoon's #194): a month's (`?mes=2026-10`), by category and one by
 * one, the fixed ones, and «📷 Ticket». The fixed ones whose day has come are added on opening.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const k = await kitchenOf(locals.user!.id);
	const current = monthOf(today());
	const asked = url.searchParams.get('mes');
	const month =
		asked && /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) && asked <= current ? asked : current;
	await Promise.all([addDueRecurring(k), addDueRecurringIncome(k, today())]);
	const [expenses, previous, recurring, favorites, canRead, income, repeated, own] =
		await Promise.all([
			monthExpenses(k, month),
			monthTotal(k, addMonths(month, -1)),
			recurringExpenses(k),
			favoriteExpenses(k),
			canReadReceipts(k),
			monthIncomeTotal(k, month),
			monthRepeated(k, month),
			ownTags(k)
		]);
	return {
		month,
		current,
		expenses,
		/** Put in twice (#440): each newer one's id, with the one it looks the same as. */
		repeated,
		previous,
		recurring,
		favorites,
		canRead,
		income,
		/** The family's own tags for the lines (#459), and which text has which. */
		own,
		today: today()
	};
};

/** The family's, of who is in. */
const kitchen = (locals: App.Locals) => kitchenOf(locals.user!.id);

/** A fixed one as the form sends it, or why not. */
function recurringFrom(form: FormData) {
	const name = String(form.get('name') ?? '')
		.trim()
		.slice(0, 120);
	const category = form.get('category');
	const amount = Number(form.get('amount'));
	const day = Number(form.get('day'));
	// Every year, in its month; else every month.
	const month = form.get('every') === 'año' ? Number(form.get('month')) : null;
	if (!name || !isCategory(category) || !Number.isInteger(amount) || amount <= 0) return null;
	if (!Number.isInteger(day) || day < 1 || day > 28) return null;
	if (month !== null && (!Number.isInteger(month) || month < 1 || month > 12)) return null;
	return { name, category, amount, day, month };
}

export const actions: Actions = {
	/**
	 * New (from a receipt read, by hand) or corrected: `expense` as JSON, as the page has it, and a
	 * new one's receipt or bill as `fichero`.
	 */
	save: async ({ request, locals }) => {
		const k = await kitchen(locals);
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
			if (!(await updateExpense(k, id, input, bill)))
				return fail(404, { message: 'Ese gasto ya no está' });
			return { saved: id };
		}
		const receipt = await receiptFrom(form);
		if ('problem' in receipt) return fail(400, { message: receipt.problem });
		const source = bill ? 'factura' : receipt.file ? 'ticket' : 'mano';
		const hash = form.get('huella');
		const fileHash = receipt.file && isFileHash(hash) ? hash : null;
		// Put in twice (#440)? Asked before saving, unless «Guardar igual».
		if (form.get('igual') !== 'on') {
			const repeated = await lookingSame(k, { id: null, ...input, source, fileHash, bill });
			if (repeated) return fail(409, { message: 'Parece repetido', repeated });
		}
		let saved: number;
		try {
			saved = await addExpense(k, input, source, receipt.file, null, bill, k.userId, fileHash);
		} catch (err) {
			if (err instanceof NotADocument) return fail(400, { message: err.message });
			throw err;
		}
		// What it has, off the shopping list (#451); a supply's bill has nothing of it.
		const ticked = bill ? [] : await tickOffBought(k, input);
		return { saved, ticked };
	},
	/** «Deshacer» (#451): what saving a purchase ticked off, back to buy. */
	untick: async ({ request, locals }) => {
		const ids = (await request.formData())
			.getAll('item')
			.map(Number)
			.filter((n) => Number.isInteger(n) && n > 0);
		await setItemsDone(await kitchen(locals), ids, false);
	},
	delete: async ({ request, locals }) => {
		const k = await kitchen(locals);
		await deleteExpense(k, Number((await request.formData()).get('id')));
	},
	/** «No es repetido» (#440): this one and the one it looked the same as. */
	notRepeated: async ({ request, locals }) => {
		const form = await request.formData();
		await markNotSame(await kitchen(locals), Number(form.get('id')), Number(form.get('other')));
	},
	/** «No me lo vuelvas a decir» (#440): that kind of notice, off for the family. */
	quietNotice: async ({ request, locals }) => {
		const kind = (await request.formData()).get('kind');
		if (!isPageNoticeKind(kind)) return fail(400, { message: 'Aviso no válido' });
		await setNoticeKind(await kitchen(locals), kind, false);
	},
	/** «☆ Favorito»: the form's expense as it is, without its day; the amount, if written. */
	saveFavorite: async ({ request, locals }) => {
		const k = await kitchen(locals);
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
		await saveFavorite(k, {
			store,
			category,
			lines,
			total: typedTotal == null ? null : input.total
		});
		return { favorite: store };
	},
	/**
	 * A line's own tag (#459), for every line with its text: `tag` a tag's id, `nueva` with `name`, or
	 * empty for none.
	 */
	tagLine: async ({ request, locals }) => {
		const form = await request.formData();
		const tag = String(form.get('tag') ?? '');
		const choice =
			tag === 'nueva'
				? { name: String(form.get('name') ?? '') }
				: tag
					? { tagId: Number(tag) }
					: null;
		if (choice && 'tagId' in choice && !Number.isInteger(choice.tagId))
			return fail(400, { message: 'Etiqueta no válida' });
		if (!(await tagLine(await kitchen(locals), String(form.get('text') ?? ''), choice)))
			return fail(400, {
				message: tag === 'nueva' ? 'Escribe el nombre de la etiqueta' : 'Esa etiqueta ya no está'
			});
		return { tagged: true };
	},
	deleteFavorite: async ({ request, locals }) => {
		const k = await kitchen(locals);
		await deleteFavorite(k, Number((await request.formData()).get('id')));
	},
	saveRecurring: async ({ request, locals }) => {
		const k = await kitchen(locals);
		const form = await request.formData();
		const r = recurringFrom(form);
		if (!r)
			return fail(400, { message: 'Falta algo: el nombre, el importe, el día (1 a 28) o el mes' });
		const id = Number(form.get('id'));
		if (id) await updateRecurring(k, id, r);
		else await addRecurring(k, r);
		await addDueRecurring(k);
	},
	/** «🔁 Hacer fijo»: an expense written down, every month or every year from its day. */
	makeRecurring: async ({ request, locals }) => {
		const k = await kitchen(locals);
		const form = await request.formData();
		if (!(await makeRecurring(k, Number(form.get('id')), form.get('every') === 'año')))
			return fail(404, { message: 'Ese gasto ya no está' });
		await addDueRecurring(k);
	},
	deleteRecurring: async ({ request, locals }) => {
		const k = await kitchen(locals);
		await deleteRecurring(k, Number((await request.formData()).get('id')));
	}
};
