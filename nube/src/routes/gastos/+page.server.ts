import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { parseBillInput } from 'comun/bills.ts';
import {
	addMonths,
	isCategory,
	isEvery,
	monthOf,
	parseExpenseInput,
	whenOf
} from 'comun/expenses.ts';
import { kitchenOf, setItemsDone, today, type Kitchen } from '#lib/server/fridge.ts';
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
import { mergeInto, monthMerged, monthMerges, splitMerge } from '#lib/server/expenses/merge.ts';
import { closeCharges, comingCharges } from '#lib/server/expenses/charges.ts';
import { isNoticeDays, MAX_ACCOUNT } from '#lib/charges.ts';
import { setNoticeKind } from '#lib/server/page-notices.ts';
import { ownTags, tagLine } from '#lib/server/expenses/own-tags.ts';
import { isPageNoticeKind } from 'comun/page-notices.ts';
import {
	addDueRecurringIncome,
	monthIncomeTotal,
	NotADocument
} from '#lib/server/expenses/income.ts';
import { refused } from '#lib/server/storage.ts';
import { attachReceipt, dropReceipt } from '#lib/server/expenses/fixed-receipt.ts';

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
	const [
		expenses,
		previous,
		recurring,
		favorites,
		canRead,
		income,
		repeated,
		own,
		charges,
		merges,
		merged
	] = await Promise.all([
		monthExpenses(k, month),
		monthTotal(k, addMonths(month, -1)),
		recurringExpenses(k),
		favoriteExpenses(k),
		canReadReceipts(k),
		monthIncomeTotal(k, month),
		monthRepeated(k, month),
		ownTags(k),
		comingCharges(k, locals.user!.id, today()),
		monthMerges(k, month),
		monthMerged(k, month)
	]);
	return {
		month,
		current,
		expenses,
		/** Put in twice (#440): each newer one's id, with the one it looks the same as. */
		repeated,
		/** Those that seem to gather others, put in one by one; and what they gathered. */
		merges,
		merged,
		previous,
		recurring,
		favorites,
		canRead,
		income,
		/** The family's own tags for the lines (#459), and which text has which. */
		own,
		/** The fixed ones about to be paid, to have money for them. */
		charges,
		today: today()
	};
};

/** Some expenses' ids, sent apart. */
const idsOf = (form: FormData, key: string) =>
	form
		.getAll(key)
		.map(Number)
		.filter((n) => Number.isInteger(n) && n > 0)
		.slice(0, 20);

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
	// Every month; else, one of its months.
	const often = form.get('every');
	if (!isEvery(often)) return null;
	const inMonth = often === 'mes' ? 1 : Number(form.get('month'));
	if (!name || !isCategory(category) || !Number.isInteger(amount) || amount <= 0) return null;
	if (!Number.isInteger(day) || day < 1 || day > 28) return null;
	if (!Number.isInteger(inMonth) || inMonth < 1 || inMonth > 12) return null;
	const paidFrom =
		String(form.get('paidFrom') ?? '')
			.trim()
			.slice(0, MAX_ACCOUNT) || null;
	const said = String(form.get('notice') ?? '');
	const notice = said === '' ? null : Number(said);
	if (notice !== null && !isNoticeDays(notice)) return null;
	return {
		name,
		category,
		amount,
		day,
		...whenOf(often, inMonth),
		paidFrom,
		notice,
		noticeAll: form.get('noticeAll') === 'on'
	};
}

/** A receipt kept on the expense `id` (#501); why not, as the page says it. */
async function attaching(k: Kitchen, id: number, file: Uint8Array, fileHash: string | null) {
	try {
		if (!(await attachReceipt(k, id, file, fileHash)))
			return fail(404, { message: 'Ese gasto ya no está' });
	} catch (err) {
		if (err instanceof NotADocument) return fail(400, { message: err.message });
		const no = refused(err);
		if (no) return fail(no.status, { message: no.message });
		throw err;
	}
	return null;
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
		const receipt = await receiptFrom(form);
		if ('problem' in receipt) return fail(400, { message: receipt.problem });
		const hash = form.get('huella');
		const fileHash = receipt.file && isFileHash(hash) ? hash : null;
		if (id) {
			if (!(await updateExpense(k, id, input, bill)))
				return fail(404, { message: 'Ese gasto ya no está' });
			// A fixed one's receipt or bill of the month, read (#501): kept on it, not as another.
			if (receipt.file) {
				const problem = await attaching(k, id, receipt.file, fileHash);
				if (problem) return problem;
			}
			return { saved: id };
		}
		const source = bill ? 'factura' : receipt.file ? 'ticket' : 'mano';
		// Those it gathers, said yes to: they are not it put in twice.
		const gathers = idsOf(form, 'juntar');
		// Put in twice (#440)? Asked before saving, unless «Guardar igual».
		if (form.get('igual') !== 'on' && !gathers.length) {
			const repeated = await lookingSame(k, { id: null, ...input, source, fileHash, bill });
			if (repeated) return fail(409, { message: 'Parece repetido', repeated });
		}
		let saved: number;
		try {
			saved = await addExpense(k, input, source, receipt.file, null, bill, k.userId, fileHash);
		} catch (err) {
			if (err instanceof NotADocument) return fail(400, { message: err.message });
			const no = refused(err);
			if (no) return fail(no.status, { message: no.message });
			throw err;
		}
		// Saved even so if they changed meanwhile: told, as it would count twice.
		const gathered = gathers.length ? await mergeInto(k, saved, gathers) : null;
		// What it has, off the shopping list (#451); a supply's bill has nothing of it.
		const ticked = bill ? [] : await tickOffBought(k, input);
		return { saved, ticked, gathered };
	},
	/**
	 * «📎 Recibo» on a fixed one (#501) without reading it (no AI, or it could not): `fichero` kept
	 * on the expense `id` as it is, its amount as it was.
	 */
	attachReceipt: async ({ request, locals }) => {
		const k = await kitchen(locals);
		const form = await request.formData();
		const receipt = await receiptFrom(form);
		if ('problem' in receipt) return fail(400, { message: receipt.problem });
		if (!receipt.file) return fail(400, { message: 'Falta el recibo' });
		const hash = form.get('huella');
		const id = Number(form.get('id'));
		const problem = await attaching(k, id, receipt.file, isFileHash(hash) ? hash : null);
		if (problem) return problem;
		return { saved: id };
	},
	/** «Quitar el recibo» (#501): its file, not what it says. */
	dropReceipt: async ({ request, locals }) => {
		const k = await kitchen(locals);
		if (!(await dropReceipt(k, Number((await request.formData()).get('id')))))
			return fail(404, { message: 'Ese recibo ya no está' });
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
	/** «Juntarlos»: `juntar`, those an expense already saved (`id`) gathers. */
	merge: async ({ request, locals }) => {
		const form = await request.formData();
		const done = await mergeInto(
			await kitchen(locals),
			Number(form.get('id')),
			idsOf(form, 'juntar')
		);
		if (!done) return fail(409, { message: 'Esos gastos han cambiado: no se ha juntado nada' });
	},
	/** «Separarlos»: put back as they were. */
	split: async ({ request, locals }) => {
		if (!(await splitMerge(await kitchen(locals), Number((await request.formData()).get('id')))))
			return fail(404, { message: 'Ya están separados' });
	},
	/** «No, son otros»: not proposed again for that expense. */
	notMerge: async ({ request, locals }) => {
		const form = await request.formData();
		const k = await kitchen(locals);
		for (const other of idsOf(form, 'juntar')) await markNotSame(k, Number(form.get('id')), other);
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
	/** «✕» on charges that come (from the home page too): `cargo`, `<id>:<day>`, each. */
	closeCharges: async ({ request, locals }) => {
		const list = (await request.formData()).getAll('cargo').flatMap((v) => {
			const m = String(v).match(/^(\d{1,9}):(\d{4}-\d{2}-\d{2})$/);
			return m ? [{ id: Number(m[1]), day: m[2]! }] : [];
		});
		if (!list.length || list.length > 100) return fail(400, { message: 'Falta cuál' });
		await closeCharges(await kitchen(locals), locals.user!.id, list, today());
	},
	/** «🔁 Hacer fijo»: an expense written down, every month, some months or year from its day. */
	makeRecurring: async ({ request, locals }) => {
		const k = await kitchen(locals);
		const form = await request.formData();
		const every = form.get('every');
		if (!isEvery(every)) return fail(400, { message: 'Falta cada cuánto' });
		if (!(await makeRecurring(k, Number(form.get('id')), every)))
			return fail(404, { message: 'Ese gasto ya no está' });
		await addDueRecurring(k);
	},
	deleteRecurring: async ({ request, locals }) => {
		const k = await kitchen(locals);
		await deleteRecurring(k, Number((await request.formData()).get('id')));
	}
};
