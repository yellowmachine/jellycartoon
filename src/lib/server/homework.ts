import { and, asc, desc, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { user } from '#lib/server/db/auth.schema.ts';
import { homework } from '#lib/server/db/schema.ts';
import { KIDS_ROLE } from '#lib/server/kids.ts';
import { log } from '#lib/server/log.ts';
import { notify } from '#lib/server/push.ts';
import { homeworkModel } from '#lib/server/app-settings.ts';
import { completeJson } from '#lib/server/openrouter.ts';
import { readable, titleFor } from '#lib/server/homework-source.ts';
import {
	MAX_QUESTIONS,
	checkEdited,
	checkProposal,
	freshSteps,
	mark,
	tryAnswer,
	type HomeworkRules,
	type Step,
	type TryResult,
	type AgeBand,
	type Exercise,
	type ExerciseKind,
	type HomeworkLanguage
} from 'comun/homework.ts';

/**
 * Homework from the cartoons (#142): the AI proposes exercises from the dialogue of episodes a child
 * watched, only from it, so that it does not make up what happened. An adult reviews them before
 * the child sees anything.
 */

export interface HomeworkRequest {
	episodeIds: number[];
	band: AgeBand;
	/** How many, at most MAX_QUESTIONS. */
	count: number;
	/** Of these kinds only; all the age does, if empty. */
	kinds?: ExerciseKind[];
	/** In this language: Spanish, or English to practise it. */
	language: HomeworkLanguage;
	/** The adult's own words: «sobre la amistad», «vocabulario de animales»… */
	focus?: string;
	/** The subtitles to read, the account's language first. */
	subtitleLang?: string | null;
}

const KIND_TEXT: Record<ExerciseKind, string> = {
	choice: 'choice: a question with options, exactly one right',
	truefalse: 'truefalse: a statement that is true or false',
	open: 'open: a short question the child answers in a sentence of their own'
};

function instructions(request: HomeworkRequest) {
	const { band } = request;
	const kinds = request.kinds?.length
		? band.kinds.filter((k) => request.kinds!.includes(k))
		: [...band.kinds];
	const language =
		request.language === 'en'
			? 'English (simple, for a Spanish child learning it)'
			: 'Spanish (from Spain)';
	return [
		'You prepare homework for a child at home, about cartoons the child has just watched. A parent will review and edit it before the child sees it.',
		`The child: ${band.label}.${band.reads ? '' : ' Does not read yet: everything will be read aloud, and answered by touching, so keep each question and option very short and concrete.'}`,
		'',
		'Rules:',
		'- Use ONLY the dialogue given. Never add events, names or details that are not in it: if something is unclear from the dialogue, do not ask about it.',
		'- Ask about what matters in the story: who, what happened, why, how it ended, how a character felt. Not about trivia (exact numbers, minor words).',
		'- Mix easy and harder ones, in the order of the story.',
		`- Kinds allowed: ${kinds.map((k) => KIND_TEXT[k]).join('; ')}.`,
		`- choice: ${band.options} options, short, plausible, only one right; the wrong ones from the same story when possible.`,
		'- hint: one short sentence said after a wrong try that helps to remember, without giving the answer.',
		'- at: where in the episode it happens, as in the dialogue (mm:ss).',
		'- open: in expected, what a good answer says, for the parent.',
		`- Write questions, options and hints in ${language}. Kind, warm, never mocking.`,
		request.focus ? `- The parent asks for this focus: ${request.focus}` : ''
	]
		.filter(Boolean)
		.join('\n');
}

const SCHEMA = {
	type: 'object',
	properties: {
		exercises: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					kind: { type: 'string', enum: ['choice', 'truefalse', 'open'] },
					question: { type: 'string' },
					options: {
						type: 'array',
						items: { type: 'string' },
						description: 'choice only; empty otherwise.'
					},
					answer: {
						description: 'choice: index of the right option; truefalse: true or false; open: null.',
						type: ['integer', 'boolean', 'null']
					},
					hint: { type: ['string', 'null'] },
					expected: { type: ['string', 'null'], description: 'open only.' },
					episode: { type: 'integer', description: 'The id of the episode it is about.' },
					at: { type: ['string', 'null'], description: 'mm:ss in that episode.' }
				},
				required: ['kind', 'question', 'options', 'answer', 'hint', 'expected', 'episode', 'at'],
				additionalProperties: false
			}
		}
	},
	required: ['exercises'],
	additionalProperties: false
};

/** Episodes without subtitles: there is nothing to ask about them (Whisper can make them). */
export class NoDialogue extends Error {}

/**
 * The AI's proposal: exercises checked (checkProposal), for an adult to review. Throws NoDialogue
 * if none of the episodes has subtitles.
 */
export async function proposeHomework(
	request: HomeworkRequest,
	label: string
): Promise<Exercise[]> {
	const episodes = await readable(request.episodeIds, request.subtitleLang ?? null);
	if (!episodes.length) throw new NoDialogue('Ninguno de esos capítulos tiene subtítulos');
	const count = Math.min(Math.max(1, Math.round(request.count)), MAX_QUESTIONS);
	const prompt = [
		`Prepare ${count} exercises about ${episodes.length === 1 ? 'this episode' : 'these episodes'}.`,
		...episodes.map((e) => `\n## Episode id ${e.id}: ${e.name}\n\n${e.dialogue}`)
	].join('\n');
	const { exercises } = await completeJson<{ exercises: unknown }>({
		system: instructions(request),
		prompt,
		name: 'homework',
		label,
		details: { episodeIds: episodes.map((e) => e.id), band: request.band.id },
		schema: SCHEMA,
		model: await homeworkModel(),
		maxTokens: 6000,
		timeoutMs: 120_000
	});
	return checkProposal(exercises, {
		band: request.band,
		episodeIds: episodes.map((e) => e.id),
		language: request.language
	}).slice(0, count);
}

/**
 * A new homework for `kidId`, proposed by the AI and kept as a draft for the adult to review: the
 * child sees nothing yet. Its id.
 */
export async function createHomework(
	request: HomeworkRequest & { kidId: string; createdBy: string; rules: HomeworkRules }
) {
	const exercises = await proposeHomework(
		request,
		`Deberes: ${await titleFor(request.episodeIds)}`
	);
	const [row] = await db
		.insert(homework)
		.values({
			kidId: request.kidId,
			createdBy: request.createdBy,
			title: await titleFor(request.episodeIds),
			language: request.language,
			band: request.band.id,
			episodeIds: request.episodeIds,
			exercises,
			rules: request.rules
		})
		.returning({ id: homework.id });
	log.info('deberes', 'Deberes propuestos', {
		homeworkId: row!.id,
		kidId: request.kidId,
		exercises: exercises.length
	});
	return row!.id;
}

export async function getHomework(id: number) {
	const [row] = await db.select().from(homework).where(eq(homework.id, id));
	return row ?? null;
}

/** A child's homework list, for the adults: newest first. */
export async function homeworkOf(kidIds: string[]) {
	if (!kidIds.length) return [];
	const rows = await db
		.select()
		.from(homework)
		.where(inArray(homework.kidId, kidIds))
		.orderBy(desc(homework.createdAt));
	return rows.map((h) => ({
		...h,
		marks: mark(
			h.exercises,
			h.steps.map((s) => s.answer)
		)
	}));
}

/** What a child has to do: given and not finished, the oldest first. */
export async function homeworkToDo(kidId: string) {
	return db
		.select({ id: homework.id, title: homework.title, exercises: homework.exercises })
		.from(homework)
		.where(and(eq(homework.kidId, kidId), eq(homework.status, 'assigned')))
		.orderBy(asc(homework.assignedAt))
		.then((rows) => rows.map(({ exercises, ...r }) => ({ ...r, count: exercises.length })));
}

/** The adult's review: their exercises, title and rules, checked. Only a draft. */
export async function saveDraft(
	id: number,
	changes: { title: string; exercises: unknown; rules: HomeworkRules }
) {
	const draft = await getHomework(id);
	if (!draft || draft.status !== 'draft') return false;
	const exercises = checkEdited(changes.exercises, {
		episodeIds: draft.episodeIds,
		language: draft.language === 'en' ? 'en' : 'es'
	});
	await db
		.update(homework)
		.set({
			title: changes.title.trim().slice(0, 120) || draft.title,
			exercises,
			rules: changes.rules
		})
		.where(eq(homework.id, id));
	return true;
}

/** The AI's proposal again, for a draft the adult did not like: their rules stay. */
export async function proposeAgain(id: number, request: Omit<HomeworkRequest, 'episodeIds'>) {
	const draft = await getHomework(id);
	if (!draft || draft.status !== 'draft') return false;
	const exercises = await proposeHomework(
		{ ...request, episodeIds: draft.episodeIds },
		`Deberes otra vez: ${draft.title}`
	);
	await db.update(homework).set({ exercises }).where(eq(homework.id, id));
	return true;
}

/** Reviewed: to the child, who sees it on their home page. */
export async function assignHomework(id: number) {
	const draft = await getHomework(id);
	if (!draft || draft.status !== 'draft' || !draft.exercises.length) return false;
	await db
		.update(homework)
		.set({ status: 'assigned', assignedAt: new Date(), steps: freshSteps(draft.exercises) })
		.where(eq(homework.id, id));
	log.info('deberes', 'Deberes dados', { homeworkId: id, kidId: draft.kidId });
	return true;
}

export async function deleteHomework(id: number) {
	await db.delete(homework).where(eq(homework.id, id));
}

/** The adults of the house: told when a child finishes. */
async function adults() {
	const rows = await db
		.select({ id: user.id })
		.from(user)
		.where(or(isNull(user.role), ne(user.role, KIDS_ROLE)));
	return rows.map((r) => r.id);
}

/**
 * The child answers exercise `index`: a closed one is checked here (never in the page, where the
 * right one would be seen), an open one is kept for an adult. At the last, it is done, and the
 * adults are told. What the child sees: the TryResult for a closed one, null for an open one.
 */
export async function answerExercise(
	id: number,
	kidId: string,
	index: number,
	answer: number | string
): Promise<{ result: TryResult | null; steps: Step[]; done: boolean } | null> {
	const hw = await getHomework(id);
	if (!hw || hw.kidId !== kidId || hw.status !== 'assigned') return null;
	const exercise = hw.exercises[index];
	const steps = hw.steps.length === hw.exercises.length ? [...hw.steps] : freshSteps(hw.exercises);
	const step = steps[index];
	if (!exercise || !step || step.done) return null;

	let result: TryResult | null = null;
	if (exercise.kind === 'open') {
		if (typeof answer !== 'string' || !answer.trim()) return null;
		steps[index] = { answer: answer.trim().slice(0, 1000), tries: step.tries + 1, done: true };
	} else {
		if (typeof answer !== 'number' || !Number.isInteger(answer)) return null;
		if (answer < 0 || answer >= exercise.options.length) return null;
		const tried = step.tries + 1;
		result = tryAnswer(exercise, answer, tried, hw.rules);
		steps[index] = { answer, tries: tried, done: result.result !== 'again' };
	}

	const done = steps.every((s) => s.done);
	await db
		.update(homework)
		.set({ steps, ...(done ? { status: 'done' as const, doneAt: new Date() } : {}) })
		.where(eq(homework.id, id));
	if (done) void tellDone(hw.id, hw.kidId, hw.title, hw.exercises, steps);
	return { result, steps, done };
}

async function tellDone(
	id: number,
	kidId: string,
	title: string,
	exercises: Exercise[],
	steps: Step[]
) {
	const [kid] = await db.select({ name: user.name }).from(user).where(eq(user.id, kidId));
	const marks = mark(
		exercises,
		steps.map((s) => s.answer)
	);
	const parts = [
		marks.closed ? `${marks.right} de ${marks.closed} bien` : null,
		marks.toRead ? `${marks.toRead} para leer` : null
	].filter(Boolean);
	log.info('deberes', 'Deberes hechos', { homeworkId: id, kidId, ...marks });
	await notify(await adults(), {
		title: `📚 ${kid?.name ?? 'Un peque'} ha terminado los deberes`,
		body: `${title}${parts.length ? `: ${parts.join(', ')}` : ''}`,
		tag: `deberes-${id}`,
		url: `/infantil/deberes/${id}`,
		ttl: 24 * 3600
	});
}
