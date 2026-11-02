import type { VoiceTurn } from 'comun/voice.ts';
import { completeJson } from '#lib/server/openrouter.ts';

/**
 * The questions to think about (an opinion, philosophy, a long explanation): the fast voice model
 * hands them over (its `converse` tool, command.ts) to the family's «Modelo para conversar»
 * (settings.ts, Sonnet by default), which answers them as spoken, in four to six sentences, with
 * what was said before. Slower and dearer: only those, never an order to do something.
 */

/** Spoken, not read: more than this is a lecture. */
export const CONVERSE_SENTENCES = '4 a 6';
/** The turns before, at most: enough to follow the thread. */
const HISTORY = 12;
/** A thinking model's answer, said aloud: more than this and the person gives up waiting. */
const TIMEOUT_MS = 40_000;

export const CONVERSE_SYSTEM = [
	'Eres la voz de una casa, charlando con alguien de la familia que quiere pensar en voz alta contigo:',
	'filosofía, una opinión, el porqué de algo, una explicación de fondo.',
	`Contesta en ${CONVERSE_SENTENCES} frases, en español de España, como se habla: sin listas, títulos, emojis ni formato, porque se lee en voz alta.`,
	'Ten ideas propias y dilas con matices; si hay posturas distintas, nómbralas en una frase. Nada de rodeos ni de «gran pregunta».',
	'Puedes acabar con una pregunta para seguir la conversación, pero no siempre.',
	'Si te dicen cómo hablar (el carácter de la casa o de quien habla), es solo el tono.'
].join(' ');

/** What was said before, as lines for the prompt. */
export function conversationLines(history: VoiceTurn[]) {
	return history
		.slice(-HISTORY)
		.map((t) => `${t.role === 'user' ? 'Persona' : 'Tú'}: ${t.content}`)
		.join('\n');
}

/** Its answer, spoken; an error if it could not (the fast one answers then). */
export async function converse(request: {
	apiKey: string;
	model: string;
	question: string;
	history: VoiceTurn[];
	/** «[Hoy es…]», «[Te habla: Ana…]», the house's character: as the fast one was told. */
	context: string[];
}) {
	const before = conversationLines(request.history);
	const { texto } = await completeJson<{ texto: string }>({
		apiKey: request.apiKey,
		label: 'Voz: conversar',
		system: CONVERSE_SYSTEM,
		prompt: [
			...request.context,
			...(before ? [`Lo hablado hasta ahora:\n${before}`] : []),
			`Ahora dice: ${request.question}`
		].join('\n\n'),
		name: 'conversacion',
		schema: {
			type: 'object',
			properties: { texto: { type: 'string' } },
			required: ['texto'],
			additionalProperties: false
		},
		model: request.model,
		maxTokens: 1_500,
		timeoutMs: TIMEOUT_MS
	});
	if (!texto.trim()) throw new Error('Sin respuesta');
	return texto.trim();
}
