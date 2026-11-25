import { askWeb, type Tool } from '#lib/server/openrouter.ts';
import type { VoiceSettings } from './settings.ts';
import { localDay, localTime } from 'comun/agenda.ts';

/**
 * The voice searching the web (#243): only if the family turned it on (Ajustes → La voz), and only when
 * the AI needs something current it does not know (a match's result, news, a shop's hours). Where
 * to look, as the house wrote it, free text; nothing fixed here but how to answer.
 */

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
export async function searchWeb(apiKey: string, settings: VoiceSettings, query: string) {
	const { hints } = settings.web;
	const now = new Date();
	const system = [
		'Buscas en internet para el asistente de voz de una casa, en España. Contesta en español, en una o dos frases cortas, para leerlas en voz alta: solo lo que se pregunta.',
		`Hoy es ${localDay(now)} y son las ${localTime(now)}. Di de qué día es lo que encuentras si no es de hoy, y si no lo encuentras, dilo: nunca lo inventes.`,
		...(hints ? [`Indicaciones de la familia para buscar: ${hints}`] : [])
	].join('\n');
	const { text } = await askWeb({
		apiKey,
		model: settings.model,
		system,
		prompt: query,
		label: `Voz, en internet: «${query}»`
	});
	return text;
}

/** The same in Preguntar, with the same permission: longer, to read, and with its sources. */
export const chatWebTool: Tool = {
	type: 'function',
	function: {
		name: WEB_TOOL,
		description:
			'Busca en internet lo que no sabes o puede haber cambiado: una opinión reciente, si algo es compatible, un precio, un horario, una noticia. Tarda unos segundos y cuesta algo: solo si hace falta. La persona ve lo que has buscado y las fuentes.',
		parameters: {
			type: 'object',
			properties: {
				query: {
					type: 'string',
					description:
						'La pregunta, completa; varias cosas parecidas, juntas en una («compatibilidad con Linux y Proton de los juegos A, B y C»). Nunca nombres de la familia, direcciones, importes, salud ni nada de sus notas, su agenda o sus papeles: sale de Seilide.'
				}
			},
			required: ['query'],
			additionalProperties: false
		}
	}
};

export async function searchWebForChat(apiKey: string, settings: VoiceSettings, query: string) {
	const { hints } = settings.web;
	const now = new Date();
	const system = [
		'Buscas en internet para el asistente por escrito de una casa, en España. Contesta en español con lo que encuentres para lo que se pregunta, concreto y breve: si son varias cosas, unas líneas de cada una.',
		`Hoy es ${localDay(now)}. Di de cuándo es cada dato y de qué web; lo que no encuentres, dilo: nunca lo inventes ni lo completes de memoria. Cita las páginas.`,
		...(hints ? [`Indicaciones de la familia para buscar: ${hints}`] : [])
	].join('\n');
	return askWeb({
		apiKey,
		model: settings.model,
		system,
		prompt: query,
		label: `Preguntar, en internet: «${query}»`
	});
}
