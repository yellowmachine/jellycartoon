import { access } from 'node:fs/promises';
import path from 'node:path';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { MAP_DIR } from '$app/env/private';
import { dayOf, kitchenOf, today } from '#lib/server/fridge.ts';
import { deleteWalk, listWalks } from '#lib/server/walks/walks.ts';
import { walkTotals } from '#lib/walks.ts';

/** Paseos (#410): one's own walks, with this week's and this month's added up. */
export const load: PageServerLoad = async ({ locals }) => {
	const k = await kitchenOf(locals.user!.id);
	const [walks, map] = await Promise.all([
		listWalks(k),
		access(path.join(MAP_DIR, 'espana.pmtiles')).then(
			() => true,
			() => false
		)
	]);
	const totals = walkTotals(
		walks.map((w) => ({
			day: dayOf(w.startedAt),
			distance: w.distance,
			seconds: (w.endedAt.getTime() - w.startedAt.getTime()) / 1000
		})),
		today()
	);
	return { walks, totals, map };
};

export const actions: Actions = {
	delete: async ({ request, locals }) => {
		const id = Number((await request.formData()).get('id'));
		if (!Number.isInteger(id)) return fail(400, { message: 'Paseo no válido' });
		await deleteWalk(await kitchenOf(locals.user!.id), id);
	}
};
