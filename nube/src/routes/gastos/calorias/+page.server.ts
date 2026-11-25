import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { kitchenOf, today } from '#lib/server/fridge.ts';
import { dayStart } from '#lib/server/plugs/stats.ts';
import { onFootSince } from '#lib/server/walks/on-foot.ts';
import { footWeeks } from '#lib/walk-kcal.ts';
import {
	caloriesView,
	correctEstimate,
	estimateMissing,
	estimateProblem,
	firstWeek,
	isEstimating
} from '#lib/server/expenses/calories.ts';

/**
 * Dinero → Calorías (#562), for the adults: the kcal bought by week and person, beside one's own
 * walks, by tag and by product. Opening it estimates the products still without kcal, old
 * receipts' too, in the background; the page asks again while it does.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const k = await kitchenOf(locals.user!.id);
	void estimateMissing(k.familyId);
	const now = today();
	const [view, foot] = await Promise.all([
		caloriesView(k, now),
		onFootSince(k, locals.user!.id, dayStart(firstWeek(now)))
	]);
	const walked = footWeeks(
		view.weeks.map((w) => w.week),
		foot.list
	);
	return {
		...view,
		weeks: view.weeks.map((w, i) => ({ ...w, km: walked[i]!.km, burnt: walked[i]!.kcal })),
		estimating: isEstimating(k.familyId),
		problem: estimateProblem(k.familyId)
	};
};

/** A number from the form, or null if it is not one ≥ 0. */
function number(form: FormData, name: string) {
	const value = Number(String(form.get(name) ?? '').replace(',', '.'));
	return Number.isFinite(value) && value >= 0 ? value : null;
}

export const actions: Actions = {
	correct: async ({ request, locals }) => {
		const form = await request.formData();
		const text = String(form.get('text') ?? '');
		const food = form.get('food') === 'on';
		const grams = number(form, 'grams');
		const kcal100 = number(form, 'kcal100');
		if (food && (grams === null || kcal100 === null || kcal100 > 900 || grams > 50_000))
			return fail(400, { message: 'Gramos o kcal no válidos' });
		const done = await correctEstimate(await kitchenOf(locals.user!.id), text, {
			food,
			byWeight: form.get('byWeight') === 'on',
			grams: grams ?? 0,
			kcal100: kcal100 ?? 0
		});
		if (!done) return fail(400, { message: 'Producto no válido' });
	}
};
