import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { isCategory, isDay, MAX_CENTS, parseEuros } from 'comun/expenses.ts';
import { lookingSame } from '#lib/server/expenses/duplicates.ts';
import { addExpense } from '#lib/server/expenses/expenses.ts';
import { kitchenOf, today } from '#lib/server/fridge.ts';
import { isWishPriority } from '#lib/wishes.ts';
import { isKidAccount } from '#lib/server/kids.ts';
import {
	addWish,
	buyableWish,
	buyWish,
	deleteWish,
	giveWish,
	linkOf,
	listWishes,
	readProduct,
	setWishExpense,
	setWishPriority,
	unbuyWish,
	updateWish
} from '#lib/server/wishes.ts';

/** Lista de deseos (#586): `?persona=`, one person's; `?tienda=`, one shop's. */
export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;
	const kid = await isKidAccount(userId);
	const { people, wishes } = await listWishes(await kitchenOf(userId), userId, kid);
	return { kid, people, wishes, today: today() };
};

const idOf = (form: FormData, key = 'id') => {
	const n = Number(form.get(key));
	return Number.isInteger(n) && n > 0 ? n : null;
};

const text = (form: FormData, key: string) => {
	const v = form.get(key);
	return typeof v === 'string' ? v : null;
};

export const actions: Actions = {
	/** A link pasted (or shared, from /compartido), into that person's list. */
	add: async ({ request, locals }) => {
		const userId = locals.user!.id;
		const form = await request.formData();
		const url = linkOf(text(form, 'url'));
		if (!url) return fail(400, { message: 'Eso no es un enlace' });
		const personId = idOf(form, 'persona');
		if (!personId) return fail(400, { message: 'Falta para quién es' });
		const product = await readProduct(url, text(form, 'texto'));
		const kid = await isKidAccount(userId);
		const done = await addWish(
			await kitchenOf(userId),
			userId,
			kid,
			personId,
			product,
			text(form, 'note')
		);
		if ('refused' in done) return fail(403, { message: 'En esa lista no puedes añadir' });
		if ('already' in done)
			return fail(409, { message: 'Ya está en esa lista', already: done.already });
		return { added: done.added };
	},
	update: async ({ request, locals }) => {
		const userId = locals.user!.id;
		const form = await request.formData();
		const id = idOf(form);
		const title = text(form, 'title') ?? '';
		if (!id || !title.trim()) return fail(400, { message: 'Falta el nombre' });
		const done = await updateWish(await kitchenOf(userId), userId, await isKidAccount(userId), id, {
			title,
			note: text(form, 'note')
		});
		if (!done) return fail(404, { message: 'Ese deseo ya no está' });
	},
	/** «Lo primero», «Pronto» or «Más adelante». */
	priority: async ({ request, locals }) => {
		const userId = locals.user!.id;
		const form = await request.formData();
		const id = idOf(form);
		const priority = form.get('priority');
		if (!id || !isWishPriority(priority)) return fail(400, { message: 'Falta cuál' });
		const done = await setWishPriority(
			await kitchenOf(userId),
			userId,
			await isKidAccount(userId),
			id,
			priority
		);
		if (!done) return fail(404, { message: 'Ese deseo ya no está' });
	},
	delete: async ({ request, locals }) => {
		const userId = locals.user!.id;
		const id = idOf(await request.formData());
		if (!id) return fail(400, { message: 'Falta cuál' });
		await deleteWish(await kitchenOf(userId), userId, await isKidAccount(userId), id);
	},
	/** «Lo regalo yo», or no longer (`on` empty). */
	give: async ({ request, locals }) => {
		const userId = locals.user!.id;
		const form = await request.formData();
		const id = idOf(form);
		if (!id) return fail(400, { message: 'Falta cuál' });
		const done = await giveWish(
			await kitchenOf(userId),
			userId,
			await isKidAccount(userId),
			id,
			form.get('on') === '1'
		);
		if (!done) return fail(409, { message: 'Alguien se ha adelantado: ya lo regala otro' });
	},
	/** «Comprado»: into Dinero too, unless `solo`. Put in twice (#440), asked first, unless `igual`. */
	buy: async ({ request, locals }) => {
		const userId = locals.user!.id;
		const form = await request.formData();
		const id = idOf(form);
		const date = text(form, 'date');
		if (!id) return fail(400, { message: 'Falta cuál' });
		if (!isDay(date)) return fail(400, { message: 'Falta la fecha' });
		const k = await kitchenOf(userId);
		const kid = await isKidAccount(userId);
		const gone = () => fail(409, { message: 'Ese deseo ya no está, o ya lo ha comprado otro' });
		const found = await buyableWish(k, userId, kid, id);
		if (!found) return gone();
		if (form.get('solo') === '1')
			return (await buyWish(k, userId, kid, id, date)) ? { bought: id, expense: null } : gone();

		const total = parseEuros(text(form, 'price') ?? '');
		if (total === null || total <= 0 || total > MAX_CENTS)
			return fail(400, { message: 'Falta el precio, en euros: 12,30' });
		const store = (text(form, 'store') ?? '').trim().slice(0, 120);
		const category = form.get('category');
		if (!store || !isCategory(category))
			return fail(400, { message: 'Falta la tienda o la categoría' });
		const input = {
			date,
			store,
			category,
			total,
			// Another adult's gift: without its name, as they see Dinero too.
			lines: found.secret
				? []
				: [
						{
							text: found.title.slice(0, 200),
							quantity: null,
							amount: total,
							tag: 'Otros' as const
						}
					]
		};
		if (form.get('igual') !== '1') {
			const repeated = await lookingSame(k, {
				id: null,
				...input,
				source: 'mano',
				fileHash: null,
				bill: null
			});
			if (repeated) return fail(409, { message: 'Parece repetido', repeated });
		}
		// First, so two pages at once put it in Dinero once.
		if (!(await buyWish(k, userId, kid, id, date))) return gone();
		let expense: number;
		try {
			expense = await addExpense(k, input, 'mano');
		} catch (err) {
			await unbuyWish(k, userId, id);
			throw err;
		}
		await setWishExpense(k, userId, id, expense);
		return { bought: id, expense };
	},
	unbuy: async ({ request, locals }) => {
		const userId = locals.user!.id;
		const id = idOf(await request.formData());
		if (!id) return fail(400, { message: 'Falta cuál' });
		if (!(await unbuyWish(await kitchenOf(userId), userId, id)))
			return fail(404, { message: 'Ese deseo ya no está' });
	}
};
