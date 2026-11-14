import { fail } from '@sveltejs/kit';
import { bank, sandbox } from '#lib/server/banks/bank.ts';
import { MAX_HISTORY_MONTHS } from '#lib/server/banks/bunq.ts';
import { today } from '#lib/server/fridge.ts';
import type { Actions, PageServerLoad } from './$types';

/**
 * Dinero → Banco (#502): each adult's own bunq, whose chosen accounts bring their payments into
 * the family's Dinero. Only they see their connection; what it brings, the whole family.
 */
export const load: PageServerLoad = async ({ locals }) => ({
	status: await bank.statusOf(locals.user!.id),
	sandbox,
	maxMonths: MAX_HISTORY_MONTHS,
	month: today().slice(0, 7)
});

const monthOf = (form: FormData) => String(form.get('month') ?? '');

export const actions: Actions = {
	/** The API key is never sent back to the page: asked for again to connect again. */
	connect: async ({ request, locals }) => {
		const key = String((await request.formData()).get('key') ?? '').slice(0, 300);
		const problem = await bank.connect(locals.user!.id, key);
		return problem ? fail(400, { problem }) : { done: 'connected' };
	},
	choose: async ({ request, locals }) => {
		const ids = (await request.formData())
			.getAll('account')
			.map(Number)
			.filter((n) => Number.isSafeInteger(n));
		const problem = await bank.choose(locals.user!.id, ids);
		return problem ? fail(400, { problem }) : { done: 'chosen' };
	},
	sync: async ({ locals }) => {
		await bank.sync(locals.user!.id);
		return { done: 'synced' };
	},
	preview: async ({ request, locals }) => {
		const month = monthOf(await request.formData());
		const count = await bank.previewHistory(locals.user!.id, month);
		if (!count) return fail(400, { problem: 'Elige un mes de los que se ofrecen' });
		if (typeof count === 'string') return fail(400, { problem: count });
		return { preview: count, month };
	},
	history: async ({ request, locals }) => {
		const month = monthOf(await request.formData());
		const count = await bank.importHistory(locals.user!.id, month);
		if (!count) return fail(400, { problem: 'Elige un mes de los que se ofrecen' });
		if (typeof count === 'string') return fail(400, { problem: count });
		return { imported: count };
	},
	disconnect: async ({ locals }) => {
		await bank.disconnect(locals.user!.id);
		return { done: 'disconnected' };
	}
};
