import { asc, eq } from 'drizzle-orm';
import { voiceModel } from '#lib/server/app-settings.ts';
import { db } from '#lib/server/db/index.ts';
import { user } from '#lib/server/db/schema.ts';
import { KIDS_ROLE } from '#lib/server/kids.ts';
import { chatWithTools, type ToolChatMessage } from '#lib/server/openrouter.ts';
import {
	historyRules,
	historySince,
	historyTools,
	runHistoryTool,
	todayText,
	type Person
} from '#lib/server/watch-history.ts';
import type { KidQuestion } from '#lib/kid-questions.ts';

/**
 * Questions about what the children watch, in the adults' page: what was asked, to a model with
 * the read-only tools of watch-history.ts over the children's accounts, and their rules.
 */

/** A search or two, a comparison and the answer. */
const MAX_ROUNDS = 6;

function instructions(kids: Person[], since: Map<string, string>, hoursSince: string | null) {
	return [
		'Eres el asistente de la página «Infantil» de JellyCartoon, una app de vídeo para casa. Te pregunta un adulto (madre, padre…) sobre lo que ven sus hijos en sus cuentas infantiles.',
		'Cuentas infantiles:',
		...kids.map(
			(k) =>
				`- ${k.name} (id ${k.id}): ${since.has(k.id) ? `datos desde el ${since.get(k.id)}` : 'todavía no ha visto nada'}.`
		),
		'',
		'Reglas:',
		historyRules(hoursSince),
		'- Si la pregunta no dice qué niño y hay más de uno, contesta de todos, o pregunta si no tiene sentido.',
		'- Si piden cambiar algo (el horario, más tiempo…), di que eso se hace en esta misma página, más abajo: tú solo consultas.',
		'- Contesta en español, corto y natural, como hablando: se puede leer en voz alta. Sin markdown ni ids.',
		'- No juzgues ni des consejos de crianza salvo que te los pidan.'
	].join('\n');
}

/** What was asked, answered: a few sentences, to be shown and read aloud. */
export async function answerKidQuestion(question: KidQuestion): Promise<string> {
	const [kids, model] = await Promise.all([
		db
			.select({ id: user.id, name: user.name })
			.from(user)
			.where(eq(user.role, KIDS_ROLE))
			.orderBy(asc(user.name)),
		voiceModel()
	]);
	if (!kids.length) return 'No hay cuentas infantiles todavía.';
	const { since, hoursSince } = await historySince(kids);
	const whose = { kids };
	const messages: ToolChatMessage[] = [
		{
			role: 'system',
			content: [
				{
					type: 'text',
					text: instructions(kids, since, hoursSince),
					cache_control: { type: 'ephemeral' }
				}
			]
		},
		...question.history,
		{
			role: 'user',
			content: [
				{ type: 'text', text: `[${todayText()}]` },
				{ type: 'text', text: question.text }
			]
		}
	];
	const available = historyTools(whose);

	for (let round = 0; round < MAX_ROUNDS; round++) {
		const answer = await chatWithTools({
			model,
			messages,
			tools: available,
			label: `Infantil: «${question.text}»`,
			details: { round }
		});
		if (!answer.toolCalls.length) return (answer.content ?? 'No tengo respuesta.').trim();
		messages.push({ role: 'assistant', content: answer.content, tool_calls: answer.toolCalls });
		for (const call of answer.toolCalls) {
			let result: string;
			try {
				const args = JSON.parse(call.function.arguments || '{}');
				result = await runHistoryTool(call.function.name, args, whose);
			} catch (err) {
				result = `Error: ${err instanceof Error ? err.message : String(err)}`;
			}
			messages.push({ role: 'tool', tool_call_id: call.id, content: result });
		}
	}
	return 'No he sabido contestarlo. Prueba a preguntarlo de otra forma.';
}
