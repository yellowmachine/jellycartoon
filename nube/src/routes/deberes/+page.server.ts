import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { AGE_BANDS, MAX_QUESTIONS, ageBand, checkRules } from 'comun/homework.ts';
import { openRouterKey } from '#lib/server/family-settings.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import {
	NoAi,
	NoDialogue,
	createHomework,
	familyKidsNamed,
	homeworkOf,
	watchedBy,
	type Watched
} from '#lib/server/homework.ts';
import { HouseProblem } from '#lib/server/house.ts';
import { isKidAccount } from '#lib/server/kids.ts';

/**
 * Homework (#142, moved from jellycartoon's Infantil → Deberes), for the adults: what each child
 * has, and a new one from what they watched at the house, or any episode of the children's series.
 * A child, to its own (hacer/).
 */
export const load: PageServerLoad = async ({ url, locals }) => {
	if (await isKidAccount(locals.user!.id)) redirect(303, '/deberes/hacer');
	const k = await kitchenOf(locals.user!.id);
	const asker = { userId: locals.user!.id, email: locals.user!.email };
	const kids = await familyKidsNamed(k);
	const chosen = kids.find((kid) => kid.id === url.searchParams.get('nino')) ?? kids[0] ?? null;
	const names = new Map(kids.map((kid) => [kid.id, kid.name]));
	let watched: Watched[] = [];
	let houseProblem: string | null = null;
	if (chosen)
		try {
			watched = await watchedBy(asker, chosen);
		} catch (err) {
			if (!(err instanceof HouseProblem)) throw err;
			houseProblem = err.message;
		}
	const list = await homeworkOf(k);
	return {
		kids: kids.map(({ id, name }) => ({ id, name })),
		chosen: chosen?.id ?? null,
		watched,
		houseProblem,
		ai: Boolean(await openRouterKey(k)),
		bands: AGE_BANDS.map((b) => ({ id: b.id, label: b.label, questions: b.questions })),
		homework: list.map((h) => ({
			id: h.id,
			kid: names.get(h.kidId) ?? '',
			title: h.title,
			status: h.status,
			count: h.exercises.length,
			marks: h.marks,
			createdAt: h.createdAt,
			doneAt: h.doneAt
		}))
	};
};

export const actions: Actions = {
	/** The AI proposes; the adult reviews it next, on its own page. */
	propose: async ({ request, locals }) => {
		if (await isKidAccount(locals.user!.id)) return fail(403, { message: 'Solo los mayores.' });
		const k = await kitchenOf(locals.user!.id);
		const form = await request.formData();
		const kidId = String(form.get('kidId') ?? '');
		const episodeIds = [
			...new Set(
				form
					.getAll('episode')
					.map(Number)
					.filter((n) => Number.isInteger(n))
			)
		];
		const band = ageBand(form.get('band'));
		const kid = (await familyKidsNamed(k)).find((kid) => kid.id === kidId);
		if (!kid || !band) return fail(400, { message: 'Elige un peque y su edad.' });
		if (!episodeIds.length) return fail(400, { message: 'Elige al menos un capítulo.' });
		if (episodeIds.length > 3)
			return fail(400, { message: 'Como mucho tres capítulos en unos deberes.' });
		const count = Math.min(Math.max(Number(form.get('count')) || band.questions, 1), MAX_QUESTIONS);
		const tries = String(form.get('tries') ?? '');
		let id: number;
		try {
			id = await createHomework(
				k,
				{ userId: locals.user!.id, email: locals.user!.email },
				{
					kidId,
					episodeIds,
					band,
					count,
					language: form.get('language') === 'en' ? 'en' : 'es',
					focus:
						String(form.get('focus') ?? '')
							.trim()
							.slice(0, 300) || undefined,
					rules: checkRules({
						tries: tries === 'sin' ? null : Number(tries),
						hints: form.get('hints') === 'on',
						showAnswer: form.get('showAnswer') === 'on'
					})
				}
			);
		} catch (error) {
			if (error instanceof NoDialogue)
				return fail(400, {
					message:
						'Esos capítulos no tienen subtítulos: sin el diálogo no hay de qué preguntar. Elige otros, o genera sus subtítulos en la serie, en casa.'
				});
			if (error instanceof NoAi || error instanceof HouseProblem)
				return fail(400, { message: error.message });
			console.warn('[deberes] No se pudieron proponer', String(error));
			return fail(502, {
				message: `La IA no pudo prepararlos: ${error instanceof Error ? error.message : 'error'}. Prueba otra vez.`
			});
		}
		redirect(303, `/deberes/${id}`);
	}
};
