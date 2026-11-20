import type { Tool } from '#lib/server/openrouter.ts';

/**
 * A plug's pause proposed in Preguntar (#557): «pon el termo en pausa, que nos vamos de
 * vacaciones». The AI only proposes; it is done when the card is tapped, as on the plug's card
 * (its padlock looked at). `result`, what happened then, in words.
 */
export interface PlugPauseCard {
	kind: 'pausa-enchufe';
	plugId: string;
	name: string;
	paused: boolean;
	done: boolean;
	result: string | null;
}

/** «Poner «Termo» en pausa», «Quitar la pausa de «Termo»». */
export const pauseSaid = (c: Pick<PlugPauseCard, 'name' | 'paused'>) =>
	c.paused ? `Poner «${c.name}» en pausa` : `Quitar la pausa de «${c.name}»`;

export const PROPOSE_PLUG_PAUSE: Tool = {
	type: 'function',
	function: {
		name: 'propose_plug_pause',
		description:
			'Enseña una tarjeta para poner o quitar la pausa de un enchufe de Enchufes por su nombre («pon el termo en pausa, que nos vamos», «quita la pausa del termo»); la persona lo confirma con un toque. En pausa se apaga y no siguen sus horarios hasta quitarla; un termo que vuelve de una pausa larga calienta unas horas seguidas, contra la legionela. Para otro día o a una hora, «propose_plan» con un encargo.',
		parameters: {
			type: 'object',
			properties: {
				name: { type: 'string', description: 'El nombre del enchufe, como en Enchufes.' },
				paused: { type: 'boolean', description: 'true para ponerla, false para quitarla.' }
			},
			required: ['name', 'paused'],
			additionalProperties: false
		}
	}
};

/** What the AI is told of the card later. */
export const pauseLine = (c: PlugPauseCard) =>
	`[Tarjeta de pausa: ${pauseSaid(c).toLowerCase()} (${c.done ? `hecho: ${c.result ?? ''}` : 'sin confirmar'})]`;
