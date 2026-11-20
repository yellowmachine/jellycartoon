import type { Tool } from '#lib/server/openrouter.ts';
import type { WallMoment } from '#lib/plug-schedules.ts';

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

/**
 * A plug's schedules skipped for a while (#557: «que no se encienda solo el termo esta tarde»),
 * proposed in Preguntar: which plug, the while (null, its skip taken off), and in words the
 * switch-ons it leaves out, as the AI worked them out then. Done when tapped.
 */
export interface PlugSkipCard {
	kind: 'saltar-horario';
	plugId: string;
	name: string;
	from: WallMoment | null;
	to: WallMoment | null;
	/** «se salta su encendido de hoy a las 18:00». */
	skipped: string;
	done: boolean;
	result: string | null;
}

/** «Que «Termo» no se encienda solo», «Que vuelvan los horarios de «Termo»». */
export const skipTitle = (c: Pick<PlugSkipCard, 'name' | 'from'>) =>
	c.from ? `Que «${c.name}» no se encienda solo` : `Que vuelvan ya los horarios de «${c.name}»`;

export const PROPOSE_PLUG_SKIP: Tool = {
	type: 'function',
	function: {
		name: 'propose_plug_skip',
		description:
			'Enseña una tarjeta para que un enchufe de Enchufes no se encienda solo durante un rato: se saltan los encendidos de sus horarios en ese rato y vuelven después, sin apagarlo ni impedir encenderlo a mano; la persona lo confirma con un toque («no quiero que se encienda el termo esta tarde», «este fin de semana que no se encienda el termo»). El rato, calculado desde ahora con lo que diga: la mañana de 6:00 a 14:00, la tarde de 14:00 a 21:00, la noche de 21:00 a 6:00 del día siguiente, «hoy» hasta las 23:59; si no está claro cuándo acaba, pregunta. Si en ese rato sus horarios no lo encienden, te lo dice y no hay tarjeta. Con cancel, que vuelvan ya sus horarios. No es una pausa («propose_plug_pause») ni un encargo («propose_plan»).',
		parameters: {
			type: 'object',
			properties: {
				name: { type: 'string', description: 'El nombre del enchufe, como en Enchufes.' },
				from_day: { type: 'string', description: 'Desde qué día, AAAA-MM-DD.' },
				from_time: { type: 'string', description: 'Desde qué hora, HH:MM.' },
				to_day: { type: 'string', description: 'Hasta qué día, AAAA-MM-DD.' },
				to_time: { type: 'string', description: 'Hasta qué hora, HH:MM.' },
				cancel: { type: 'boolean', description: 'true para quitar el salto que tenga.' }
			},
			required: ['name'],
			additionalProperties: false
		}
	}
};

/** What the AI is told of the card later. */
export const skipLine = (c: PlugSkipCard) =>
	`[Tarjeta de saltar horario: ${skipTitle(c).toLowerCase()}${c.skipped ? `, ${c.skipped}` : ''} (${c.done ? `hecho: ${c.result ?? ''}` : 'sin confirmar'})]`;
