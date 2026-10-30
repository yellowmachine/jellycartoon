import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { mark } from 'comun/homework.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import { getHomework } from '#lib/server/homework.ts';

/**
 * A child doing their homework (#142), one exercise at a time. What the page gets never has the
 * right one of what is still to answer: only of what is done, if the rules show it.
 */
export const load: PageServerLoad = async ({ params, locals }) => {
	const hw = await getHomework(await kitchenOf(locals.user!.id), Number(params.id));
	if (!hw || hw.kidId !== locals.user!.id || hw.status === 'draft') error(404, 'No encontrado');
	const exercises = hw.exercises.map((e, i) => {
		const step = hw.steps[i] ?? { answer: null, tries: 0, done: false };
		const right = step.done && e.kind !== 'open' && step.answer === e.answer;
		return {
			kind: e.kind,
			question: e.question,
			options: e.options,
			step,
			right: e.kind === 'open' ? null : right,
			/** Of a closed one done: the right one, if it was right or the rules show it. */
			answer: step.done && (right || hw.rules.showAnswer) ? e.answer : null
		};
	});
	return {
		homework: { id: hw.id, title: hw.title, status: hw.status, language: hw.language },
		exercises,
		marks: mark(
			hw.exercises,
			hw.steps.map((s) => s.answer)
		)
	};
};
