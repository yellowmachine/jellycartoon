import { dayName } from 'comun/agenda.ts';
import type { RuleSpec } from '#lib/rules.ts';
import type { Tool } from '#lib/server/openrouter.ts';

/**
 * Errands (#557), asked in Preguntar: «mañana a las 9 pon el termo una hora y a las 3 avísame para
 * poner la lavadora». The AI proposes them in one card, each on its own line, and nothing is kept
 * until the person taps «Guardar»: a plain notice at a time goes to the Agenda as an alarm (on
 * their phone); one that switches a plug or has a condition, to Reglas as a rule of one time.
 */

/** A notice at a time, nothing else: an alarm of the Agenda, once. `savedId`, its number there. */
export interface PlanAlarm {
	kind: 'aviso';
	day: string;
	time: string;
	label: string;
	savedId: number | null;
}

/** One with a plug or a condition: a rule, as the AI understood it. `savedId`, its number. */
export interface PlanRule {
	kind: 'encargo';
	said: string;
	understood: string;
	spec: RuleSpec;
	savedId: number | null;
}

export type PlanItem = PlanAlarm | PlanRule;

export interface PlanCard {
	kind: 'encargos';
	items: PlanItem[];
}

/** At most this many in one card. */
export const MAX_PLAN_ITEMS = 6;

/** «viernes 21 a las 15:00: Poner la lavadora». */
export const alarmSaid = (a: Pick<PlanAlarm, 'day' | 'time' | 'label'>) =>
	`${dayName(a.day)} a las ${a.time}: ${a.label}`;

/** Each line as the person reads it. */
export const itemSaid = (item: PlanItem) =>
	item.kind === 'aviso' ? alarmSaid(item) : item.understood;

/** The AI's tool to propose them, in Preguntar (server/encargos.ts makes the card). */
export const PROPOSE_PLAN: Tool = {
	type: 'function',
	function: {
		name: 'propose_plan',
		description:
			'Enseña una tarjeta con lo que la persona quiere dejar programado, y lo guarda ella con un toque: avisos a una hora (van a la Agenda como alarma y suenan en su móvil) y encargos que encienden o apagan un enchufe o llevan una condición («mañana a las 9 enciende el termo una hora», «el sábado a las 8 avísame si va a llover»), que quedan en Reglas para esa sola vez. Cada cosa por separado, con su día calculado desde hoy. No guarda nada por sí sola.',
		parameters: {
			type: 'object',
			properties: {
				avisos: {
					type: 'array',
					description:
						'Avisos a una hora, sin condición ni enchufe: «a las 3 avísame para poner la lavadora».',
					items: {
						type: 'object',
						properties: {
							day: { type: 'string', description: 'El día, YYYY-MM-DD, calculado desde hoy.' },
							time: {
								type: 'string',
								description: 'La hora, HH:MM en 24 horas («a las 3 de la tarde», 15:00).'
							},
							label: {
								type: 'string',
								description: 'Qué avisar, corto, como se leerá al sonar: «Poner la lavadora».'
							}
						},
						required: ['day', 'time', 'label'],
						additionalProperties: false
					}
				},
				encargos: {
					type: 'array',
					description:
						'Encargos con enchufe o condición, cada uno en una frase completa que se entienda sola, con el día y la hora: «El viernes 21 a las 9:00 enciende el termo una hora».',
					items: { type: 'string' }
				}
			},
			required: [],
			additionalProperties: false
		}
	}
};

/** What the AI is told of a card later: what it proposed and what was kept. */
export function planLine(card: PlanCard) {
	return `[Tarjeta de encargos: ${card.items
		.map((it) => `${itemSaid(it)} (${it.savedId ? 'guardado' : 'sin guardar'})`)
		.join('; ')}]`;
}
