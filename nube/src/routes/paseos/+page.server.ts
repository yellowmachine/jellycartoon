import { access } from 'node:fs/promises';
import path from 'node:path';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { MAP_DIR } from '$app/env/private';
import { dayOf, kitchenOf, today } from '#lib/server/fridge.ts';
import { addDays } from 'comun/agenda.ts';
import { firstWeek, recentCalories, WEEKS } from '#lib/server/expenses/calories.ts';
import { deleteWalkNotes } from '#lib/server/notes.ts';
import { deleteWalk, deleteWalkPhotos, listWalks } from '#lib/server/walks/walks.ts';
import { onFootSince } from '#lib/server/walks/on-foot.ts';
import { addKcal, footWeeks, walkKcal, weightOn } from '#lib/walk-kcal.ts';
import { mondayOf, walkTotals } from '#lib/walks.ts';
import { dayStart } from '#lib/server/plugs/stats.ts';

/**
 * Paseos (#410): one's own walks, with this week's and this month's added up. `?paseo=`, that one
 * opened (from a report, #505): if it is older than the list, it is added at its end. With
 * Calorías in use (#562), the kcal bought by day and person, as a card that goes there.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const k = await kitchenOf(locals.user!.id);
	const asked = Number(url.searchParams.get('paseo')) || null;
	const now = today();
	const [walks, map, kcal, foot] = await Promise.all([
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
		}),
		// Those weeks' hold the whole month too.
		onFootSince(k, locals.user!.id, dayStart(firstWeek(now)))
	]);
	// This week's and this month's, the outings by OwnTracks (#593) added to the walks.
	const totals = walkTotals(foot.list, now);
	/** What of those totals came from OwnTracks, to say so. */
	const fromOwntracks = walkTotals(
		foot.list.filter((o) => o.owntracks),
		now
	);
	const burntSince = (from: string) =>
		addKcal(foot.list.filter((o) => o.day >= from && o.day <= now).map((o) => o.kcal));
	const weeks = footWeeks(
		Array.from({ length: WEEKS }, (_, i) => addDays(firstWeek(now), 7 * i)),
		foot.list
	);
	return {
		walks: walks.map((w) => ({
			...w,
			kcal: walkKcal(
				w.distance,
				(w.endedAt.getTime() - w.startedAt.getTime()) / 1000,
				weightOn(foot.weights, dayOf(w.startedAt))
			)
		})),
		totals,
		fromOwntracks,
		map,
		kcal,
		/** Whether they noted their weight: without it, no kcal. */
		weighed: foot.weights.length > 0,
		burnt: { week: burntSince(mondayOf(now)), month: burntSince(`${now.slice(0, 7)}-01`) },
		weeks
	};
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
