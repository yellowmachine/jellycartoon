import { error, fail, redirect } from '@sveltejs/kit';
import { eq, inArray } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '#lib/server/db/index.ts';
import { user } from '#lib/server/db/auth.schema.ts';
import { episode, series } from '#lib/server/db/schema.ts';
import { log } from '#lib/server/log.ts';
import {
	assignHomework,
	deleteHomework,
	getHomework,
	proposeAgain,
	saveDraft
} from '#lib/server/homework.ts';
import { TRIES_OPTIONS, ageBand, checkRules, mark } from '#lib/homework.ts';

async function found(params: { id: string }) {
	const hw = await getHomework(Number(params.id));
	if (!hw) error(404, 'No encontrado');
	return hw;
}

/** One homework (#142): to review while it is a draft; what the child answered, after. */
export const load: PageServerLoad = async ({ params }) => {
	const hw = await found(params);
	const [kid] = await db.select({ name: user.name }).from(user).where(eq(user.id, hw.kidId));
	const episodes = await db
		.select({
			id: episode.id,
			series: series.title,
			season: episode.season,
			number: episode.number
		})
		.from(episode)
		.innerJoin(series, eq(series.id, episode.seriesId))
		.where(inArray(episode.id, hw.episodeIds));
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
		episodes: Object.fromEntries(
			episodes.map((e) => [e.id, `${e.series} · T${e.season} E${e.number}`])
		),
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
	save: async ({ params, request }) => {
		const form = await request.formData();
		const ok = await saveDraft(Number(params.id), {
			title: String(form.get('title') ?? ''),
			exercises: exercisesFrom(form),
			rules: rulesFrom(form)
		});
		if (!ok) return fail(409, { message: 'Ya no es un borrador.' });
		return { saved: true };
	},
	/** Saved as it is, and to the child. */
	assign: async ({ params, request }) => {
		const form = await request.formData();
		const id = Number(params.id);
		await saveDraft(id, {
			title: String(form.get('title') ?? ''),
			exercises: exercisesFrom(form),
			rules: rulesFrom(form)
		});
		if (!(await assignHomework(id)))
			return fail(409, { message: 'Sin ejercicios, o ya estaba dado.' });
		return { assigned: true };
	},
	/** The AI's proposal again, the same episodes and age: the adult's rules stay. */
	again: async ({ params }) => {
		const hw = await found(params);
		const band = ageBand(hw.band);
		if (!band || hw.status !== 'draft') return fail(409, { message: 'Ya no es un borrador.' });
		try {
			await proposeAgain(hw.id, {
				band,
				count: hw.exercises.length || band.questions,
				language: hw.language === 'en' ? 'en' : 'es'
			});
		} catch (e) {
			log.warn('deberes', 'No se pudieron proponer otra vez', { error: e });
			return fail(502, { message: 'La IA no pudo prepararlos. Prueba otra vez.' });
		}
		return { again: true };
	},
	delete: async ({ params }) => {
		await deleteHomework(Number(params.id));
		redirect(303, '/infantil/deberes');
	}
};
