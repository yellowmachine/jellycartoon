import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { isCategory, isDay, MAX_CENTS, parseEuros, type ExpenseInput } from 'comun/expenses.ts';
import { lookingSame } from '#lib/server/expenses/duplicates.ts';
import { addExpense } from '#lib/server/expenses/expenses.ts';
import { kitchenOf, today } from '#lib/server/fridge.ts';
import {
	extraFromText,
	isWishPriority,
	priceChangeText,
	priceFromText,
	sameCurrency,
	shippingFromText,
	togetherLines
} from '#lib/wishes.ts';
import { isKidAccount } from '#lib/server/kids.ts';
import {
	addWish,
	boughtDayOf,
	boughtMonths,
	buyableWish,
	buyWish,
	deleteWish,
	expenseTotals,
	giveWish,
	linkOf,
	listWishes,
	readProduct,
	setWishExpense,
	setWishPriority,
	unbuyWish,
	updateWish
} from '#lib/server/wishes.ts';

/** «2026» or «2026-10». */
const isPeriod = (v: string | null): v is string => !!v && /^\d{4}(-(0[1-9]|1[0-2]))?$/.test(v);
const monthEnd = (month: string) => {
	const [y, m] = month.split('-').map(Number) as [number, number];
	return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

/**
 * Lista de deseos (#586): `?persona=`, one person's; `?tienda=`, one shop's. Of the bought (#631),
 * `?comprados=` a year or a month (this year, by default) or `?buscar=` words in any year; `?ya=`
 * one bought, its month.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const userId = locals.user!.id;
	const kid = await isKidAccount(userId);
	const k = await kitchenOf(userId);
	const search = (url.searchParams.get('buscar') ?? '').trim().slice(0, 100) || null;
	const asked = url.searchParams.get('comprados');
	const ya = Number(url.searchParams.get('ya'));
	const yaDay =
		!search && !asked && Number.isInteger(ya) && ya > 0
			? await boughtDayOf(k, userId, kid, ya)
			: null;
	const period = isPeriod(asked) ? asked : yaDay ? yaDay.slice(0, 7) : today().slice(0, 4);
	const [from, to] = search
		? [null, null]
		: period.length === 4
			? [`${period}-01-01`, `${period}-12-31`]
			: [`${period}-01`, monthEnd(period)];
	const [{ people, wishes }, months] = await Promise.all([
		listWishes(k, userId, kid, { from, to, text: search }),
		boughtMonths(k, userId, kid)
	]);
	// What was spent: not for a child, who has no Dinero.
	const totals = kid
		? {}
		: await expenseTotals(k, [
				...new Set(wishes.flatMap((w) => (w.bought?.expenseId ? [w.bought.expenseId] : [])))
			]);
	return {
		kid,
		people,
		wishes,
		today: today(),
		bought: { period: search ? null : period, search, months, totals }
	};
};

/** Wishes in one «Seleccionar», at most. */
const MAX_BULK = 200;

const idOf = (form: FormData, key = 'id') => {
	const n = Number(form.get(key));
	return Number.isInteger(n) && n > 0 ? n : null;
};

/** `ids`, «1,2,3». */
const idList = (form: FormData) =>
	[
		...new Set(
			String(form.get('ids') ?? '')
				.split(',')
				.map(Number)
		)
	].filter((n) => Number.isInteger(n) && n > 0);

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
			return fail(409, {
				message: 'Ya está en esa lista',
				already: done.already,
				change: done.change && priceChangeText(done.change)
			});
		return { added: done.added };
	},
	update: async ({ request, locals }) => {
		const userId = locals.user!.id;
		const form = await request.formData();
		const id = idOf(form);
		const title = text(form, 'title') ?? '';
		if (!id || !title.trim()) return fail(400, { message: 'Falta el nombre' });
		const said = text(form, 'price');
		const read = priceFromText(said);
		if (said?.trim() && !read) return fail(400, { message: 'Ese precio no se entiende: 12,30' });
		const currency = text(form, 'currency') || 'EUR';
		const price =
			said === null
				? undefined
				: read && {
						cents: read.cents,
						// Its own, unless another is written with it.
						currency: /[€$£]/.test(said) || !/^[A-Z]{3}$/.test(currency) ? read.currency : currency
					};
		const sent = text(form, 'shipping');
		const shipping = shippingFromText(sent);
		if (sent?.trim() && !shipping)
			return fail(400, { message: 'Ese envío no se entiende: 4,99 o gratis' });
		if (shipping?.currency && !sameCurrency(shipping.currency, price?.currency ?? currency))
			return fail(400, { message: 'El envío, en la misma moneda que el precio' });
		const added = text(form, 'extra');
		const base = read ? read.cents + (shipping?.cents ?? 0) : null;
		const extra = extraFromText(added, base);
		if (!extra)
			return fail(400, {
				message:
					base === null && added?.includes('%')
						? 'Un porcentaje de IVA necesita el precio'
						: 'Ese IVA no se entiende: 1,34 o 4 %'
			});
		if (extra.currency && !sameCurrency(extra.currency, price?.currency ?? currency))
			return fail(400, { message: 'El IVA y otros, en la misma moneda que el precio' });
		const done = await updateWish(await kitchenOf(userId), userId, await isKidAccount(userId), id, {
			title,
			note: text(form, 'note'),
			price,
			shipping: sent === null ? undefined : (shipping?.cents ?? null),
			extra: added === null ? undefined : extra.cents
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
		// In cents, as the page worked it out: kept with the wish, not added to the price again.
		const added = text(form, 'extra');
		const extra = added !== null && /^\d{1,8}$/.test(added) ? Number(added) : undefined;
		const k = await kitchenOf(userId);
		const kid = await isKidAccount(userId);
		const gone = () => fail(409, { message: 'Ese deseo ya no está, o ya lo ha comprado otro' });
		const found = await buyableWish(k, userId, kid, id);
		if (!found) return gone();
		if (form.get('solo') === '1')
			return (await buyWish(k, userId, kid, id, date, extra))
				? { bought: id, expense: null }
				: gone();

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
		if (!(await buyWish(k, userId, kid, id, date, extra))) return gone();
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
	/**
	 * «Seleccionar» → bought together (`ids`): one expense in Dinero for each shop, with what was paid
	 * there (`shop`, `store` and `price`, one of each); or only marked (`solo`). All or none.
	 */
	buyTogether: async ({ request, locals }) => {
		const userId = locals.user!.id;
		const form = await request.formData();
		const ids = idList(form);
		const date = text(form, 'date');
		if (!ids.length || ids.length > MAX_BULK) return fail(400, { message: 'Falta cuáles' });
		if (!isDay(date)) return fail(400, { message: 'Falta la fecha' });
		const k = await kitchenOf(userId);
		const kid = await isKidAccount(userId);
		const gone = () =>
			fail(409, { message: 'Alguno ya no está, o ya lo ha comprado otro: no se ha marcado nada' });
		const found: { id: number; w: NonNullable<Awaited<ReturnType<typeof buyableWish>>> }[] = [];
		for (const id of ids) {
			const w = await buyableWish(k, userId, kid, id);
			if (!w) return gone();
			found.push({ id, w });
		}

		const solo = form.get('solo') === '1';
		const category = form.get('category');
		const paid: { ids: number[]; input: ExpenseInput }[] = [];
		if (!solo) {
			if (!isCategory(category)) return fail(400, { message: 'Falta la categoría' });
			const all = (key: string) => form.getAll(key).map(String);
			const [shops, stores, prices] = [all('shop'), all('store'), all('price')];
			for (const shop of new Set(found.map((f) => f.w.shop))) {
				const at = shops.indexOf(shop);
				const total = parseEuros(prices[at] ?? '');
				if (total === null || total <= 0 || total > MAX_CENTS)
					return fail(400, { message: `Falta lo pagado en ${shop}, en euros: 12,30` });
				const store = (stores[at] ?? '').trim().slice(0, 120);
				if (!store) return fail(400, { message: 'Falta la tienda' });
				const theirs = found.filter((f) => f.w.shop === shop);
				paid.push({
					ids: theirs.map((f) => f.id),
					input: {
						date,
						store,
						category,
						total,
						// With another adult's gift among them: without names, as they see Dinero too.
						lines: theirs.some((f) => f.w.secret)
							? []
							: togetherLines(
									theirs.map((f) => f.w),
									total
								).map((l) => ({
									text: l.text.slice(0, 200),
									quantity: null,
									amount: l.amount,
									tag: 'Otros' as const
								}))
					}
				});
			}
			if (form.get('igual') !== '1')
				for (const { input } of paid) {
					const repeated = await lookingSame(k, {
						id: null,
						...input,
						source: 'mano',
						fileHash: null,
						bill: null
					});
					if (repeated) return fail(409, { message: 'Parece repetido', repeated });
				}
		}

		// First, so two pages at once put it in Dinero once.
		const done: number[] = [];
		const undo = async (those: number[]) => {
			for (const id of those) await unbuyWish(k, userId, id);
		};
		for (const { id } of found) {
			if (!(await buyWish(k, userId, kid, id, date))) {
				await undo(done);
				return gone();
			}
			done.push(id);
		}
		const expenses: number[] = [];
		const left = [...paid];
		try {
			while (left.length) {
				const { ids: theirs, input } = left[0]!;
				const expense = await addExpense(k, input, 'mano');
				expenses.push(expense);
				left.shift();
				for (const id of theirs) await setWishExpense(k, userId, id, expense);
			}
		} catch (err) {
			// Those of the shops not put in, back; those put in, bought.
			await undo(left.flatMap((p) => p.ids));
			throw err;
		}
		return { bought: done.length, expenses };
	},
	/**
	 * «Seleccionar»: one thing done to several (`ids`, `op`): for when, given or removed. Each as alone: what cannot be is left, and said.
	 */
	bulk: async ({ request, locals }) => {
		const userId = locals.user!.id;
		const form = await request.formData();
		const ids = idList(form);
		if (!ids.length || ids.length > MAX_BULK) return fail(400, { message: 'Falta cuáles' });
		const k = await kitchenOf(userId);
		const kid = await isKidAccount(userId);
		const op = form.get('op');
		const each =
			op === 'quitar'
				? (id: number) => deleteWish(k, userId, kid, id)
				: op === 'regalar'
					? (id: number) => giveWish(k, userId, kid, id, true)
					: isWishPriority(op)
						? (id: number) => setWishPriority(k, userId, kid, id, op)
						: null;
		if (!each) return fail(400, { message: 'Falta qué hacer' });
		let done = 0;
		for (const id of ids) if (await each(id)) done++;
		if (done < ids.length)
			return fail(409, {
				message: `Hecho en ${done} de ${ids.length}: los demás han cambiado o ya no están`
			});
	},
	unbuy: async ({ request, locals }) => {
		const userId = locals.user!.id;
		const id = idOf(await request.formData());
		if (!id) return fail(400, { message: 'Falta cuál' });
		if (!(await unbuyWish(await kitchenOf(userId), userId, id)))
			return fail(404, { message: 'Ese deseo ya no está' });
	}
};
