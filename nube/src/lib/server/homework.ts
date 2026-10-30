import { and, asc, desc, eq, ne } from 'drizzle-orm';
import {
	MAX_QUESTIONS,
	checkEdited,
	checkProposal,
	freshSteps,
	mark,
	tryAnswer,
	type AgeBand,
	type Exercise,
	type ExerciseKind,
	type HomeworkLanguage,
	type HomeworkRules,
	type Step,
	type TryResult
} from 'comun/homework.ts';
import { familyMember, homework, user } from '#lib/server/db/schema.ts';
import { openRouterKey } from '#lib/server/family-settings.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { askHouse } from '#lib/server/house.ts';
import { completeJson } from '#lib/server/openrouter.ts';
import { tell } from '#lib/server/inbox.ts';

/**
 * Homework from the cartoons (#142), moved from jellycartoon: the family's AI proposes exercises
 * from the dialogue of episodes a child watched, only from it, so that it does not make up what
 * happened; an adult reviews them before the child sees anything. What a child watched and that
 * dialogue are the house's: asked for by its video API (api/v1/deberes), in the adult's name.
 */

/** A good model, as at home: a homework costs a few cents. */
const HOMEWORK_MODEL = 'anthropic/claude-opus-5.5';

/** Who asks the house, in whose name: the adult preparing it. */
export interface Asker {
	userId: string;
	email: string;
}

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

/** No AI key in the family: nothing to propose with (Ajustes → Familia → IA). */
export class NoAi extends Error {}

interface Readable {
	id: number;
	name: string;
	dialogue: string;
}

/**
 * The AI's proposal: exercises checked (checkProposal), for an adult to review, and the house's
 * title for them. Throws NoDialogue if none of the episodes has subtitles, NoAi without a key.
 */
export async function proposeHomework(k: Kitchen, asker: Asker, request: HomeworkRequest) {
	const apiKey = await openRouterKey(k);
	if (!apiKey) throw new NoAi('La familia no tiene clave de IA: ponla en Ajustes → Familia');
	const { titulo, capitulos: episodes } = await askHouse<{ titulo: string; capitulos: Readable[] }>(
		asker.userId,
		asker.email,
		'/deberes/dialogo',
		{
			method: 'POST',
			body: JSON.stringify({ capitulos: request.episodeIds, idioma: request.language })
		},
		30_000
	);
	if (!episodes.length) throw new NoDialogue('Ninguno de esos capítulos tiene subtítulos');
	const count = Math.min(Math.max(1, Math.round(request.count)), MAX_QUESTIONS);
	const prompt = [
		`Prepare ${count} exercises about ${episodes.length === 1 ? 'this episode' : 'these episodes'}.`,
		...episodes.map((e) => `\n## Episode id ${e.id}: ${e.name}\n\n${e.dialogue}`)
	].join('\n');
	const { exercises } = await completeJson<{ exercises: unknown }>({
		apiKey,
		system: instructions(request),
		prompt,
		name: 'homework',
		label: `Deberes: ${titulo}`,
		schema: SCHEMA,
		model: HOMEWORK_MODEL,
		maxTokens: 6000,
		timeoutMs: 120_000
	});
	return {
		title: titulo,
		names: Object.fromEntries(episodes.map((e) => [String(e.id), e.name])),
		exercises: checkProposal(exercises, {
			band: request.band,
			episodeIds: episodes.map((e) => e.id),
			language: request.language
		}).slice(0, count)
	};
}

/** An episode a child watched, to choose for homework: with or without dialogue to read. */
export interface Watched {
	id: number;
	series: string;
	season: number;
	number: number;
	title: string;
	watchedAt: string;
	completed: boolean;
	hasDialogue: boolean;
}

/** The family's children with an account (#303), as homework is for them. */
export function familyKidsNamed(k: Kitchen) {
	return k.run((tx) =>
		tx
			.select({ id: user.id, name: user.name, email: user.email })
			.from(familyMember)
			.innerJoin(user, eq(user.id, familyMember.userId))
			.where(eq(familyMember.role, 'peque'))
			.orderBy(asc(user.name))
	);
}

/** What that child watched lately, at the house, newest first. */
export async function watchedBy(asker: Asker, kid: { email: string; name: string }) {
	const { visto } = await askHouse<{ visto: Watched[] }>(
		asker.userId,
		asker.email,
		'/deberes/visto',
		{
			method: 'POST',
			body: JSON.stringify({ peque: { email: kid.email, nombre: kid.name } })
		}
	);
	return visto;
}

/** Any episode with dialogue of the house's children's series: by series or title. */
export async function searchEpisodes(asker: Asker, query: string) {
	const { capitulos } = await askHouse<{
		capitulos: { id: number; series: string; season: number; number: number; title: string }[];
	}>(asker.userId, asker.email, `/deberes/capitulos?q=${encodeURIComponent(query.slice(0, 60))}`);
	return capitulos;
}

/**
 * A new homework for `kidId`, proposed by the AI and kept as a draft for the adult to review: the
 * child sees nothing yet. Its id.
 */
export async function createHomework(
	k: Kitchen,
	asker: Asker,
	request: HomeworkRequest & { kidId: string; rules: HomeworkRules }
) {
	const { title, names, exercises } = await proposeHomework(k, asker, request);
	const [row] = await k.run((tx) =>
		tx
			.insert(homework)
			.values({
				familyId: k.familyId,
				kidId: request.kidId,
				createdBy: asker.userId,
				title,
				language: request.language,
				band: request.band.id,
				episodeIds: request.episodeIds,
				episodeNames: names,
				exercises,
				rules: request.rules
			})
			.returning({ id: homework.id })
	);
	return row!.id;
}

export async function getHomework(k: Kitchen, id: number) {
	const [row] = await k.run((tx) => tx.select().from(homework).where(eq(homework.id, id)));
	return row ?? null;
}

/** The family's homework, for the adults: newest first. */
export async function homeworkOf(k: Kitchen) {
	const rows = await k.run((tx) => tx.select().from(homework).orderBy(desc(homework.createdAt)));
	return rows.map((h) => ({
		...h,
		marks: mark(
			h.exercises,
			h.steps.map((s) => s.answer)
		)
	}));
}

/** What a child has to do: given and not finished, the oldest first. */
export async function homeworkToDo(k: Kitchen, kidId: string) {
	const rows = await k.run((tx) =>
		tx
			.select({ id: homework.id, title: homework.title, exercises: homework.exercises })
			.from(homework)
			.where(and(eq(homework.kidId, kidId), eq(homework.status, 'assigned')))
			.orderBy(asc(homework.assignedAt))
	);
	return rows.map(({ exercises, ...r }) => ({ ...r, count: exercises.length }));
}

/** The adult's review: their exercises, title and rules, checked. Only a draft. */
export async function saveDraft(
	k: Kitchen,
	id: number,
	changes: { title: string; exercises: unknown; rules: HomeworkRules }
) {
	const draft = await getHomework(k, id);
	if (!draft || draft.status !== 'draft') return false;
	const exercises = checkEdited(changes.exercises, {
		episodeIds: draft.episodeIds,
		language: draft.language === 'en' ? 'en' : 'es'
	});
	await k.run((tx) =>
		tx
			.update(homework)
			.set({
				title: changes.title.trim().slice(0, 120) || draft.title,
				exercises,
				rules: changes.rules
			})
			.where(eq(homework.id, id))
	);
	return true;
}

/** The AI's proposal again, for a draft the adult did not like: their rules stay. */
export async function proposeAgain(
	k: Kitchen,
	asker: Asker,
	id: number,
	request: Omit<HomeworkRequest, 'episodeIds'>
) {
	const draft = await getHomework(k, id);
	if (!draft || draft.status !== 'draft') return false;
	const { exercises } = await proposeHomework(k, asker, {
		...request,
		episodeIds: draft.episodeIds
	});
	await k.run((tx) => tx.update(homework).set({ exercises }).where(eq(homework.id, id)));
	return true;
}

/** Reviewed: to the child, who sees it on their home page. */
export async function assignHomework(k: Kitchen, id: number) {
	const draft = await getHomework(k, id);
	if (!draft || draft.status !== 'draft' || !draft.exercises.length) return false;
	await k.run((tx) =>
		tx
			.update(homework)
			.set({ status: 'assigned', assignedAt: new Date(), steps: freshSteps(draft.exercises) })
			.where(eq(homework.id, id))
	);
	return true;
}

export async function deleteHomework(k: Kitchen, id: number) {
	await k.run((tx) => tx.delete(homework).where(eq(homework.id, id)));
}

/**
 * The child answers exercise `index`: a closed one is checked here (never in the page, where the
 * right one would be seen), an open one is kept for an adult. At the last, it is done, and the
 * adults are told. What the child sees: the TryResult for a closed one, null for an open one.
 */
export async function answerExercise(
	k: Kitchen,
	id: number,
	index: number,
	answer: number | string
): Promise<{ result: TryResult | null; steps: Step[]; done: boolean } | null> {
	const hw = await getHomework(k, id);
	if (!hw || hw.kidId !== k.userId || hw.status !== 'assigned') return null;
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
	await k.run((tx) =>
		tx
			.update(homework)
			.set({ steps, ...(done ? { status: 'done' as const, doneAt: new Date() } : {}) })
			.where(eq(homework.id, id))
	);
	if (done)
		void tellDone(k, hw.id, hw.title, hw.exercises, steps).catch((err) =>
			console.warn('[deberes] Sin aviso a los mayores', String(err))
		);
	return { result, steps, done };
}

/** The family's adults, told on their phones that it is done. */
async function tellDone(
	k: Kitchen,
	id: number,
	title: string,
	exercises: Exercise[],
	steps: Step[]
) {
	const [adults, [kid]] = await Promise.all([
		k.run((tx) =>
			tx
				.select({ id: familyMember.userId })
				.from(familyMember)
				.where(ne(familyMember.role, 'peque'))
		),
		k.run((tx) => tx.select({ name: user.name }).from(user).where(eq(user.id, k.userId!)))
	]);
	const marks = mark(
		exercises,
		steps.map((s) => s.answer)
	);
	const parts = [
		marks.closed ? `${marks.right} de ${marks.closed} bien` : null,
		marks.toRead ? `${marks.toRead} para leer` : null
	].filter(Boolean);
	await tell(
		k.familyId,
		adults.map((a) => a.id),
		{
			kind: 'deberes',
			title: `📚 ${kid?.name ?? 'Un peque'} ha terminado los deberes`,
			body: `${title}${parts.length ? `: ${parts.join(', ')}` : ''}`,
			tag: `deberes-${id}`,
			url: `/deberes/${id}`,
			ttl: 24 * 3600
		}
	);
}
