import { eq, inArray } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { episode, series } from '#lib/server/db/schema.ts';
import { readCues } from '#lib/server/auto-subtitle-files.ts';
import { hlsDir } from '#lib/server/library/paths.ts';
import { homeworkModel } from '#lib/server/app-settings.ts';
import { completeJson } from '#lib/server/openrouter.ts';
import { subtitleFile } from '#lib/server/opening-quote.ts';
import {
	MAX_QUESTIONS,
	checkProposal,
	transcript,
	type AgeBand,
	type Exercise,
	type ExerciseKind,
	type HomeworkLanguage
} from '#lib/homework.ts';

/**
 * Homework from the cartoons (#142): the AI proposes exercises from the dialogue of episodes a child
 * watched, only from it, so that it does not make up what happened. An adult reviews them before
 * the child sees anything.
 */

/** All the dialogue of the episodes chosen, at most: a few episodes of cartoons fit well. */
const MAX_TRANSCRIPT = 60_000;

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

/** An episode the AI can read: its dialogue, and its name to say which it is. */
interface Readable {
	id: number;
	name: string;
	dialogue: string;
}

const KIND_TEXT: Record<ExerciseKind, string> = {
	choice: 'choice: a question with options, exactly one right',
	truefalse: 'truefalse: a statement that is true or false',
	open: 'open: a short question the child answers in a sentence of their own'
};

/** The episodes' dialogue, from their subtitles; those without any are left out. */
async function readable(ids: number[], lang: string | null): Promise<Readable[]> {
	const rows = await db
		.select({
			id: episode.id,
			season: episode.season,
			number: episode.number,
			title: episode.title,
			customTitle: episode.customTitle,
			series: series.title,
			subtitles: episode.subtitles
		})
		.from(episode)
		.innerJoin(series, eq(series.id, episode.seriesId))
		.where(inArray(episode.id, ids));
	const perEpisode = Math.floor(MAX_TRANSCRIPT / Math.max(rows.length, 1));
	const read: Readable[] = [];
	for (const row of rows) {
		const file = subtitleFile(row.subtitles, lang);
		if (!file) continue;
		const cues = await readCues(hlsDir(row.id), file).catch(() => []);
		const dialogue = transcript(cues, perEpisode);
		if (!dialogue) continue;
		read.push({
			id: row.id,
			name: `«${row.series}», T${row.season} E${row.number} «${row.customTitle ?? row.title}»`,
			dialogue
		});
	}
	return read;
}

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
