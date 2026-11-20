import type { Kitchen } from '../fridge.ts';
import { kwhPriceText } from '#lib/kwh-price.ts';
import type { Tool } from '../openrouter.ts';
import { PlugOffline } from './hub.ts';
import { HEAT_MS, kwhPriceIn, plugsOf, setPausedIn, switchIn } from './plugs.ts';
import {
	energyText,
	euroText,
	PLUG_KINDS,
	plugNamed,
	powerText,
	type PlugView
} from '#lib/plugs.ts';

/**
 * The plugs by voice (#396, phase 3): «enciende la lámpara», «apaga el termo», and «¿cuánto ha
 * gastado la lavadora este mes?», answered from a line about each plug that goes with the order.
 * Also for a while: «enciende la estufa media hora», «apaga la tele dentro de una hora», with the
 * plug's own timer.
 */

/** The family's plugs for one order: the line for the model, and the plugs to switch. */
export async function plugsForVoice(k: Kitchen) {
	const [plugs, price] = await Promise.all([plugsOf(k), kwhPriceIn(k)]);
	if (!plugs.length) return null;
	const used = (wh: number, euros: number | null) =>
		`${energyText(wh)}${euros === null ? '' : ` (${euroText(euros)})`}`;
	const lines = plugs.map((p) => {
		const state = `${
			p.paused
				? 'en pausa'
				: p.reconnecting
					? 'reconectando tras una actualización de Seilide, vuelve solo en unos minutos'
					: !p.online
						? 'sin conexión'
						: `${p.output ? 'encendido' : 'apagado'}${p.power ? `, ${powerText(p.power)} ahora` : ''}`
		}${p.locked ? ', con candado (no se enciende ni se apaga por voz)' : ''}`;
		return `${p.name} (${PLUG_KINDS[p.kind].label.toLowerCase()}): ${state}; hoy ${used(p.todayWh, p.todayEuros)}, este mes ${used(p.monthWh, p.monthEuros)}`;
	});
	return {
		plugs,
		line: `[Enchufes de la familia (encender y apagar con «plug_switch», también un rato; poner o quitar la pausa con «plug_pause»; lo gastado, de aquí): ${lines.join('. ')}.${price === null ? ' Sin precio del kWh: en euros no se sabe.' : ` Precio del kWh: ${kwhPriceText(price)}.`}]`
	};
}

/** At most this long, «durante» or «dentro de»: longer is a schedule, in Enchufes. */
export const MAX_TIMED_MIN = 24 * 60;

const TIME_ZONE = process.env.TZ || 'Europe/Madrid';
const clock = new Intl.DateTimeFormat('es-ES', {
	timeZone: TIME_ZONE,
	hour: '2-digit',
	minute: '2-digit'
});

export const plugSwitchTool: Tool = {
	type: 'function',
	function: {
		name: 'plug_switch',
		description:
			'Enciende o apaga un enchufe de la familia por su nombre («enciende la lámpara», «apaga el termo»). Solo los de la lista de enchufes. Para un rato: for_minutes, ahora y vuelve como estaba después («enciende la estufa media hora»); in_minutes, cambia pasado ese tiempo («apaga la tele dentro de una hora»). Uno de los dos, o ninguno. A una hora del reloj («a las 9», «mañana») o con condiciones, no: create_rule.',
		parameters: {
			type: 'object',
			properties: {
				name: { type: 'string', description: 'Su nombre, como está en la lista.' },
				on: { type: 'boolean', description: 'true para encender, false para apagar.' },
				for_minutes: {
					type: 'integer',
					description: `Encendido o apagado ya durante estos minutos, y luego al revés (máximo ${MAX_TIMED_MIN}).`
				},
				in_minutes: {
					type: 'integer',
					description: `Encender o apagar pasados estos minutos, no ya (máximo ${MAX_TIMED_MIN}).`
				}
			},
			required: ['name', 'on'],
			additionalProperties: false
		}
	}
};

/** Minutes asked for, whole and in range; null if not asked; 'bad' if not usable. */
function minutesOf(v: unknown) {
	if (v === undefined || v === null || v === 0) return null;
	const n = typeof v === 'number' ? v : Number(v);
	return Number.isFinite(n) && n >= 1 && n <= MAX_TIMED_MIN ? Math.round(n) : ('bad' as const);
}

/** What `plug_switch` did, in words for the model. */
export async function switchByVoice(
	k: Kitchen,
	plugs: PlugView[],
	args: Record<string, unknown>,
	now = Date.now()
): Promise<{ result: string; done: boolean }> {
	const said = typeof args.name === 'string' ? args.name : '';
	const on = args.on === true;
	const p = plugNamed(plugs, said);
	if (!p)
		return {
			result: `No hay un enchufe claro con el nombre «${said}». Los hay: ${plugs.map((x) => x.name).join(', ')}.`,
			done: false
		};
	const during = minutesOf(args.for_minutes);
	const within = minutesOf(args.in_minutes);
	if (during === 'bad' || within === 'bad' || (during && within))
		return {
			result: `Un rato es de 1 a ${MAX_TIMED_MIN} minutos, «durante» o «dentro de», uno solo. Para más, un horario en Energía.`,
			done: false
		};
	const verb = (v: boolean) => (v ? 'encender' : 'apagar');
	const word = (v: boolean) => (v ? 'encendido' : 'apagado');
	// «Dentro de»: the other way now (as it is), and the plug's timer brings what was asked.
	if (within && p.output === on) return { result: `${p.name} ya está ${word(on)}.`, done: false };
	const minutes = during ?? within;
	const at = minutes ? clock.format(new Date(now + minutes * 60_000)) : '';
	try {
		const done = await switchIn(k, p.id, within ? !on : on, minutes ? minutes * 60 : undefined);
		if (done === 'locked')
			return {
				result: `${p.name} tiene el candado puesto para no apagarlo sin querer: se quita desde Energía, por voz no se enciende ni se apaga.`,
				done: false
			};
		if (done === 'paused')
			return {
				result: `${p.name} está en pausa: se quita desde Energía, no se enciende así.`,
				done: false
			};
		if (done === 'heating')
			return {
				result: `${p.name} está calentando largo tras la pausa: ahora no se programa un rato, solo se puede apagar del todo.`,
				done: false
			};
		if (!done) return { result: `${p.name} ya no está.`, done: false };
		if (during)
			return {
				result: `${p.name} ${word(on)} durante ${during} min: se ${on ? 'apaga' : 'enciende'} a las ${at}.`,
				done: true
			};
		if (within)
			return {
				result: `${p.name} se ${on ? 'enciende' : 'apaga'} a las ${at}, dentro de ${within} min.`,
				done: true
			};
		return { result: `${p.name} ${word(on)}.`, done: true };
	} catch (e) {
		if (e instanceof PlugOffline)
			return {
				result: `${p.name} no está conectado ahora: no se puede ${verb(on)}.`,
				done: false
			};
		throw e;
	}
}

export const plugPauseTool: Tool = {
	type: 'function',
	function: {
		name: 'plug_pause',
		description:
			'Pone o quita la pausa de un enchufe de la familia por su nombre: «pon el termo en pausa» (en verano, de vacaciones), «quita la pausa del termo». En pausa se apaga y no siguen sus horarios hasta quitarla; un termo que vuelve de una pausa larga calienta unas horas seguidas, contra la legionela. No para apagar un rato: eso es «plug_switch».',
		parameters: {
			type: 'object',
			properties: {
				name: { type: 'string', description: 'Su nombre, como está en la lista.' },
				paused: { type: 'boolean', description: 'true para ponerla, false para quitarla.' }
			},
			required: ['name', 'paused'],
			additionalProperties: false
		}
	}
};

/**
 * A plug paused or not (#557: by voice, in Preguntar, by an errand), with its padlock looked at as
 * on its card; what happened, in words, and whether it was done.
 */
export async function pausePlug(
	k: Kitchen,
	p: Pick<PlugView, 'id' | 'name'>,
	paused: boolean
): Promise<{ result: string; done: boolean }> {
	const done = await setPausedIn(k, p.id, paused);
	if (done.gone) return { result: `${p.name} ya no está en Enchufes.`, done: false };
	if (done.locked)
		return {
			result: `${p.name} tiene el candado puesto: la pausa no se cambia así, se quita el candado desde Energía.`,
			done: false
		};
	if (paused)
		return {
			result: `${p.name} en pausa: apagado y sin sus horarios hasta que se quite.`,
			done: true
		};
	return {
		result: done.heats
			? `${p.name} sin pausa: calienta ${HEAT_MS / 3_600_000} horas seguidas, contra la legionela, y luego vuelven sus horarios.`
			: `${p.name} sin pausa: vuelven sus horarios.`,
		done: true
	};
}

/** What `plug_pause` did, in words for the model. */
export async function pauseByVoice(k: Kitchen, plugs: PlugView[], args: Record<string, unknown>) {
	const said = typeof args.name === 'string' ? args.name : '';
	const p = plugNamed(plugs, said);
	if (!p)
		return {
			result: `No hay un enchufe claro con el nombre «${said}». Los hay: ${plugs.map((x) => x.name).join(', ')}.`,
			done: false
		};
	const paused = args.paused === true;
	if (p.paused === paused)
		return { result: `${p.name} ya ${paused ? 'está' : 'no está'} en pausa.`, done: false };
	return pausePlug(k, p, paused);
}
