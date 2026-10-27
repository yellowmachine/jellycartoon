import { getAppSetting, setAppSetting, voiceModel } from '#lib/server/app-settings.ts';
import { askWeb, type Tool } from '#lib/server/openrouter.ts';
import { localDay, localTime } from '#lib/agenda.ts';

/**
 * The voice searching the web (#243): only if the house turned it on (Ajustes → Casa), and only when
 * the AI needs something current it does not know (a match's result, news, a shop's hours). Where
 * to look, as the house wrote it, free text; nothing fixed here but how to answer.
 */

/** «Indicaciones para buscar», this long at most. */
export const MAX_WEB_HINTS = 500;

export interface WebSearchConfig {
	on: boolean;
	hints: string;
}

export async function webSearchConfig(): Promise<WebSearchConfig> {
	try {
		const saved = JSON.parse((await getAppSetting('voice_web')) ?? 'null');
		return {
			on: saved?.on === true,
			hints: typeof saved?.hints === 'string' ? saved.hints.slice(0, MAX_WEB_HINTS) : ''
		};
	} catch {
		return { on: false, hints: '' };
	}
}

export async function setWebSearch(config: WebSearchConfig) {
	await setAppSetting(
		'voice_web',
		JSON.stringify({ on: config.on, hints: config.hints.trim().slice(0, MAX_WEB_HINTS) })
	);
}

export const WEB_TOOL = 'web_search';

export const webSearchTool: Tool = {
	type: 'function',
	function: {
		name: WEB_TOOL,
		description:
			'Busca en internet algo de actualidad que no sabes: un resultado deportivo, una noticia, el horario de una tienda, un precio. Tarda unos segundos y cuesta algo: úsalo solo si hace falta, no para lo que ya sabes ni para lo que hacen las otras herramientas (el tiempo, la música…).',
		parameters: {
			type: 'object',
			properties: {
				query: {
					type: 'string',
					description:
						'La pregunta, completa y con lo que haga falta: «resultados de la NBA de anoche».'
				}
			},
			required: ['query'],
			additionalProperties: false
		}
	}
};

/** The answer found, for the voice to tell in its words; or why not. */
export async function searchWeb(query: string) {
	const { hints } = await webSearchConfig();
	const now = new Date();
	const system = [
		'Buscas en internet para el asistente de voz de una casa, en España. Contesta en español, en una o dos frases cortas, para leerlas en voz alta: solo lo que se pregunta.',
		`Hoy es ${localDay(now)} y son las ${localTime(now)}. Di de qué día es lo que encuentras si no es de hoy, y si no lo encuentras, dilo: nunca lo inventes.`,
		...(hints ? [`Indicaciones de la casa para buscar: ${hints}`] : [])
	].join('\n');
	return askWeb({
		model: await voiceModel(),
		system,
		prompt: query,
		label: `Voz, en internet: «${query}»`
	});
}
