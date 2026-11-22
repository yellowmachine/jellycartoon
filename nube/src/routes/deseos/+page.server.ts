import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { isKidAccount } from '#lib/server/kids.ts';
import {
	addWish,
	deleteWish,
	giveWish,
	linkOf,
	listWishes,
	readProduct,
	updateWish
} from '#lib/server/wishes.ts';

/** Lista de deseos (#586): `?persona=`, one person's; `?tienda=`, one shop's. */
export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;
	const kid = await isKidAccount(userId);
	const { people, wishes } = await listWishes(await kitchenOf(userId), userId, kid);
	return { kid, people, wishes };
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
	}
};
