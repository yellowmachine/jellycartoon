import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { HouseProblem } from '#lib/server/house.ts';
import { allSeries, continueWatching, dismissWatching } from '#lib/server/series.ts';

const whoOf = (locals: App.Locals) => ({ id: locals.user!.id, email: locals.user!.email });

/**
 * Series (#253), as jellycartoon's: this person's «Seguir viendo» (the same as at home) and every
 * series with something to watch. Without the house, why not.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const who = whoOf(locals);
	try {
		const [series, watching] = await Promise.all([allSeries(who), continueWatching(who)]);
		return { series, continueWatching: watching, problem: null };
	} catch (error) {
		if (!(error instanceof HouseProblem)) throw error;
		return { series: [], continueWatching: [], problem: error.message };
	}
};

export const actions: Actions = {
	/** Out of «Seguir viendo»; where it was left is kept. */
	dismiss: async ({ request, locals }) => {
		const id = Number((await request.formData()).get('id'));
		if (!Number.isInteger(id)) return fail(400, { message: 'Capítulo no válido' });
		await dismissWatching(whoOf(locals), id).catch(() => {});
	}
};
