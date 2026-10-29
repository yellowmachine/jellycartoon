import type { SettingsEntry } from 'comun/settings-search.ts';
import { TAB_LABELS, type SettingsShown, type SettingsTab } from '#lib/settings-index.ts';
import {
	chatWithTools,
	DEFAULT_MODEL,
	type Tool,
	type ToolChatAnswer
} from '#lib/server/openrouter.ts';
import { FALLBACK_VOICE_MODEL } from '#lib/server/voice/settings.ts';

/**
 * «Preguntar a la IA» in Ajustes' search: what someone wants, in their words («que me avise el
 * móvil cuando suene la alarma»), and the sections of Ajustes that do it, chosen by the family's AI
 * among those this person sees. It only names sections of the index (`open_settings`): it cannot
 * make one up, nor change anything.
 */

type Entry = SettingsEntry<SettingsTab, SettingsShown>;

/** At most these, the best first. */
const MAX_FOUND = 3;
/** A question, not a letter. */
export const MAX_QUESTION = 300;

export interface SettingsAnswer {
	ids: string[];
	/** One sentence: why these, or how to do it, or why it cannot be done here. */
	why: string;
}

const tool = (entries: Entry[]): Tool => ({
	type: 'function',
	function: {
		name: 'open_settings',
		description:
			'Las secciones de Ajustes que hacen lo que pide, la mejor primero, y una frase para quien pregunta. Sin ninguna que sirva, ids vacío y la frase dice por qué o dónde está.',
		parameters: {
			type: 'object',
			properties: {
				ids: {
					type: 'array',
					items: { type: 'string', enum: entries.map((e) => e.id) },
					maxItems: MAX_FOUND
				},
				why: {
					type: 'string',
					description:
						'Una frase corta, en español, de tú: qué hacer en esa sección («Actívalos aquí: luego llegan con la app cerrada»), o por qué no está.'
				}
			},
			required: ['ids', 'why'],
			additionalProperties: false
		}
	}
});

const system = (entries: Entry[], admin: boolean) =>
	[
		'Eres el buscador de Ajustes de Seilide, la app de la familia (agenda, alarmas, nevera, recetas, gastos, viajes, radio, voz). Alguien escribe lo que quiere hacer y tú eliges, con «open_settings», las secciones de Ajustes que lo hacen. Nunca inventes secciones: solo las de la lista.',
		admin
			? ''
			: 'Quien pregunta no administra la familia: lo de administrar (la clave de IA, invitar, la voz de la casa, el bot de Telegram…) no está en su lista. Si pide algo de eso, ids vacío y dile que lo hace quien administra la familia.',
		'Si lo que pide no es de Ajustes sino de otra parte de la app (apuntar un gasto, poner una alarma), ids vacío y dile dónde: «Eso se hace en Agenda → Alarmas».',
		'Secciones (id: pestaña › título · palabras):',
		...entries.map((e) => `- ${e.id}: ${TAB_LABELS[e.tab]} › ${e.title} · ${e.words}`)
	]
		.filter(Boolean)
		.join('\n');

/** The model's answer, as ids of `entries` and its sentence; text instead of the tool, as its sentence. */
export function answerOf(answer: Pick<ToolChatAnswer, 'content' | 'toolCalls'>, entries: Entry[]) {
	const call = answer.toolCalls.find((c) => c.function.name === 'open_settings');
	if (!call) return { ids: [], why: answer.content?.trim() || 'No sé dónde está eso.' };
	let args: { ids?: unknown; why?: unknown } = {};
	try {
		args = JSON.parse(call.function.arguments || '{}');
	} catch {
		// Unreadable: nothing found.
	}
	const known = new Set(entries.map((e) => e.id));
	const ids = (Array.isArray(args.ids) ? args.ids : [])
		.filter((id): id is string => typeof id === 'string' && known.has(id))
		.filter((id, i, all) => all.indexOf(id) === i)
		.slice(0, MAX_FOUND);
	const why = typeof args.why === 'string' && args.why.trim() ? args.why.trim() : '';
	return { ids, why: why || (ids.length ? '' : 'No sé dónde está eso.') };
}

export async function askSettings(
	apiKey: string,
	question: string,
	entries: Entry[],
	admin: boolean
): Promise<SettingsAnswer> {
	const answer = await chatWithTools({
		apiKey,
		label: `Ajustes: «${question}»`,
		model: DEFAULT_MODEL,
		fallbackModel: FALLBACK_VOICE_MODEL,
		messages: [
			{
				role: 'system',
				content: [
					{ type: 'text', text: system(entries, admin), cache_control: { type: 'ephemeral' } }
				]
			},
			{ role: 'user', content: question }
		],
		tools: [tool(entries)],
		think: false,
		toolChoice: 'required',
		timeoutMs: 20_000
	});
	return answerOf(answer, entries);
}
