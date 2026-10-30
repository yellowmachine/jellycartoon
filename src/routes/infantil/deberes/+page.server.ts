import { fail, redirect } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '#lib/server/db/index.ts';
import { user } from '#lib/server/db/auth.schema.ts';
import { openRouterConfig } from '#lib/server/app-settings.ts';
import { KIDS_ROLE } from '#lib/server/kids.ts';
import { log } from '#lib/server/log.ts';
import { NoDialogue, createHomework, homeworkOf } from '#lib/server/homework.ts';
import { watchedBy } from '#lib/server/homework-source.ts';
import { AGE_BANDS, MAX_QUESTIONS, ageBand, checkRules } from 'comun/homework.ts';

/** Homework (#142), for the adults: what each child has, and a new one from what they watched. */
export const load: PageServerLoad = async ({ url }) => {
	const kids = await db
		.select({ id: user.id, name: user.name })
		.from(user)
		.where(eq(user.role, KIDS_ROLE))
		.orderBy(asc(user.name));
	const chosen = kids.find((k) => k.id === url.searchParams.get('nino')) ?? kids[0] ?? null;
	const names = new Map(kids.map((k) => [k.id, k.name]));
	const list = await homeworkOf(kids.map((k) => k.id));
	return {
		kids,
		chosen: chosen?.id ?? null,
		watched: chosen ? await watchedBy(chosen.id) : [],
		ai: Boolean((await openRouterConfig()).apiKey),
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
		const form = await request.formData();
		const kidId = String(form.get('kidId') ?? '');
		const episodeIds = form
			.getAll('episode')
			.map(Number)
			.filter((n) => Number.isInteger(n));
		const band = ageBand(form.get('band'));
		const [kid] = await db
			.select({ id: user.id })
			.from(user)
			.where(and(eq(user.id, kidId), eq(user.role, KIDS_ROLE)));
		if (!kid || !band) return fail(400, { message: 'Elige un peque y su edad.' });
		if (!episodeIds.length) return fail(400, { message: 'Elige al menos un capítulo.' });
		if (episodeIds.length > 3)
			return fail(400, { message: 'Como mucho tres capítulos en unos deberes.' });
		const count = Math.min(Math.max(Number(form.get('count')) || band.questions, 1), MAX_QUESTIONS);
		const tries = String(form.get('tries') ?? '');
		let id: number;
		try {
			id = await createHomework({
				kidId,
				createdBy: locals.user!.id,
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
			});
		} catch (error) {
			if (error instanceof NoDialogue)
				return fail(400, {
					message:
						'Esos capítulos no tienen subtítulos: sin el diálogo no hay de qué preguntar. Elige otros, o genera sus subtítulos desde la serie.'
				});
			log.warn('deberes', 'No se pudieron proponer los deberes', { error });
			return fail(502, {
				message: `La IA no pudo prepararlos: ${error instanceof Error ? error.message : 'error'}. Prueba otra vez.`
			});
		}
		redirect(303, `/infantil/deberes/${id}`);
	}
};
