import { access } from 'node:fs/promises';
import path from 'node:path';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { MAP_DIR } from '$app/env/private';
import { dayOf, kitchenOf, today } from '#lib/server/fridge.ts';
import { recentCalories } from '#lib/server/expenses/calories.ts';
import { deleteWalk, listWalks } from '#lib/server/walks/walks.ts';
import { walkTotals } from '#lib/walks.ts';

/**
 * Paseos (#410): one's own walks, with this week's and this month's added up. `?paseo=`, that one
 * opened (from a report, #505): if it is older than the list, it is added at its end. With
 * Calorías in use (#562), the kcal bought by day and person, as a card that goes there.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const k = await kitchenOf(locals.user!.id);
	const asked = Number(url.searchParams.get('paseo')) || null;
	const [walks, map, kcal] = await Promise.all([
		listWalks(k).then(async (list) =>
			asked && !list.some((w) => w.id === asked)
				? [...list, ...(await listWalks(k, 1, asked))]
				: list
		),
		access(path.join(MAP_DIR, 'espana.pmtiles')).then(
			() => true,
			() => false
		),
		recentCalories(k, today()).catch((error) => {
			console.warn('[paseos] Sin calorías', String(error));
			return null;
		})
	]);
	const totals = walkTotals(
		walks.map((w) => ({
			day: dayOf(w.startedAt),
			distance: w.distance,
			seconds: (w.endedAt.getTime() - w.startedAt.getTime()) / 1000
		})),
		today()
	);
	return { walks, totals, map, kcal };
};

export const actions: Actions = {
	delete: async ({ request, locals }) => {
		const id = Number((await request.formData()).get('id'));
		if (!Number.isInteger(id)) return fail(400, { message: 'Paseo no válido' });
		await deleteWalk(await kitchenOf(locals.user!.id), id);
	}
};
