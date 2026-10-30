import { error, fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { TRIES_OPTIONS, ageBand, checkRules, mark } from 'comun/homework.ts';
import { user } from '#lib/server/db/schema.ts';
import { kitchenOf, type Kitchen } from '#lib/server/fridge.ts';
import {
	assignHomework,
	deleteHomework,
	getHomework,
	proposeAgain,
	saveDraft
} from '#lib/server/homework.ts';
import { isKidAccount } from '#lib/server/kids.ts';

/** The adults' only: a child goes to do it (hacer/). */
async function adultKitchen(userId: string, id: string) {
	if (await isKidAccount(userId)) redirect(303, `/deberes/hacer/${id}`);
	return kitchenOf(userId);
}

async function found(k: Kitchen, params: { id: string }) {
	const hw = await getHomework(k, Number(params.id));
	if (!hw) error(404, 'No encontrado');
	return hw;
}

/** One homework (#142): to review while it is a draft; what the child answered, after. */
export const load: PageServerLoad = async ({ params, locals }) => {
	const k = await adultKitchen(locals.user!.id, params.id);
	const hw = await found(k, params);
	const [kid] = await k.run((tx) =>
		tx.select({ name: user.name }).from(user).where(eq(user.id, hw.kidId))
	);
	return {
		homework: {
			id: hw.id,
			title: hw.title,
			status: hw.status,
			language: hw.language,
			band: ageBand(hw.band)?.label ?? hw.band,
			exercises: hw.exercises,
			rules: hw.rules,
			steps: hw.steps,
			marks: mark(
				hw.exercises,
				hw.steps.map((s) => s.answer)
			)
		},
		kid: kid?.name ?? '',
		/** As the house named them when it was made. */
		episodes: hw.episodeNames as Record<number, string>,
		triesOptions: TRIES_OPTIONS
	};
};

/** The rules as the review form sends them. */
function rulesFrom(form: FormData) {
	const tries = String(form.get('tries') ?? '');
	return checkRules({
		tries: tries === 'sin' ? null : Number(tries),
		hints: form.get('hints') === 'on',
		showAnswer: form.get('showAnswer') === 'on'
	});
}

/** The exercises as the page sends them: JSON, checked again on saving. */
function exercisesFrom(form: FormData) {
	try {
		return JSON.parse(String(form.get('exercises') ?? '[]')) as unknown;
	} catch {
		return [];
	}
}

export const actions: Actions = {
	save: async ({ params, request, locals }) => {
		const k = await adultKitchen(locals.user!.id, params.id);
		const form = await request.formData();
		const ok = await saveDraft(k, Number(params.id), {
			title: String(form.get('title') ?? ''),
			exercises: exercisesFrom(form),
			rules: rulesFrom(form)
		});
		if (!ok) return fail(409, { message: 'Ya no es un borrador.' });
		return { saved: true };
	},
	/** Saved as it is, and to the child. */
	assign: async ({ params, request, locals }) => {
		const k = await adultKitchen(locals.user!.id, params.id);
		const form = await request.formData();
		const id = Number(params.id);
		await saveDraft(k, id, {
			title: String(form.get('title') ?? ''),
			exercises: exercisesFrom(form),
			rules: rulesFrom(form)
		});
		if (!(await assignHomework(k, id)))
			return fail(409, { message: 'Sin ejercicios, o ya estaba dado.' });
		return { assigned: true };
	},
	/** The AI's proposal again, the same episodes and age: the adult's rules stay. */
	again: async ({ params, locals }) => {
		const k = await adultKitchen(locals.user!.id, params.id);
		const hw = await found(k, params);
		const band = ageBand(hw.band);
		if (!band || hw.status !== 'draft') return fail(409, { message: 'Ya no es un borrador.' });
		try {
			await proposeAgain(k, { userId: locals.user!.id, email: locals.user!.email }, hw.id, {
				band,
				count: hw.exercises.length || band.questions,
				language: hw.language === 'en' ? 'en' : 'es'
			});
		} catch (e) {
			console.warn('[deberes] No se pudieron proponer otra vez', String(e));
			return fail(502, { message: 'La IA no pudo prepararlos. Prueba otra vez.' });
		}
		return { again: true };
	},
	delete: async ({ params, locals }) => {
		const k = await adultKitchen(locals.user!.id, params.id);
		await deleteHomework(k, Number(params.id));
		redirect(303, '/deberes');
	}
};
