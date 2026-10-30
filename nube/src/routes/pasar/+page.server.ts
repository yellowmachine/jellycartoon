import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { PERMITS } from 'comun/avatars.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import { handOver, kidsOf } from '#lib/server/kid-login.ts';

/**
 * «Pasar a un peque» (#303): an adult hands their own phone to one of the children they let in,
 * for a while or the day, without asking anyone. To come back, they enter again with theirs.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const kids = await kidsOf(await kitchenOf(locals.user!.id));
	if (!kids.length) error(404, 'No tienes peques a los que dejar entrar');
	return { kids, permits: PERMITS.filter((p) => p.id !== 'once') };
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const form = await request.formData();
		const permit = PERMITS.find((p) => p.id === form.get('permit') && p.id !== 'once');
		if (!permit) return fail(400, { message: 'Elige cuánto rato' });
		const done = await handOver(
			await kitchenOf(locals.user!.id),
			String(form.get('kidId') ?? ''),
			permit.id,
			request.headers
		);
		if (!done) return fail(400, { message: 'No puedes dejar entrar a ese peque' });
		redirect(303, '/');
	}
};
