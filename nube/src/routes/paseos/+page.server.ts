import { access } from 'node:fs/promises';
import path from 'node:path';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { MAP_DIR } from '$app/env/private';
import { dayOf, kitchenOf, today } from '#lib/server/fridge.ts';
import { recentCalories } from '#lib/server/expenses/calories.ts';
import { deleteWalkNotes } from '#lib/server/notes.ts';
import { deleteWalk, deleteWalkPhotos, listWalks } from '#lib/server/walks/walks.ts';
import { mondayOf, walkTotals } from '#lib/walks.ts';
import { dayStart } from '#lib/server/plugs/stats.ts';
import { owntracksOutings } from '#lib/server/owntracks/walking.ts';

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
	// This week's and this month's outings by OwnTracks (#593), added to the walks.
	const now = today();
	const monday = mondayOf(now);
	const monthStart = `${now.slice(0, 7)}-01`;
	const outings = await owntracksOutings(
		locals.user!.id,
		dayStart(monday < monthStart ? monday : monthStart),
		new Date(),
		walks
	).catch((error) => {
		console.warn('[paseos] Sin OwnTracks', String(error));
		return [];
	});
	const row = (w: { startedAt: Date; endedAt: Date; distance: number }) => ({
		day: dayOf(w.startedAt),
		distance: w.distance,
		seconds: (w.endedAt.getTime() - w.startedAt.getTime()) / 1000
	});
	const totals = walkTotals([...walks.map(row), ...outings.map(row)], now);
	/** What of those totals came from OwnTracks, to say so. */
	const fromOwntracks = walkTotals(outings.map(row), now);
	return { walks, totals, fromOwntracks, map, kcal };
};

export const actions: Actions = {
	delete: async ({ request, locals }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (!Number.isInteger(id)) return fail(400, { message: 'Paseo no válido' });
		const k = await kitchenOf(locals.user!.id);
		// First: afterwards, which were its notes is not known.
		if (form.has('todo')) {
			await deleteWalkNotes(k, locals.user!.id, id);
			await deleteWalkPhotos(k, id);
		}
		await deleteWalk(k, id);
	}
};
