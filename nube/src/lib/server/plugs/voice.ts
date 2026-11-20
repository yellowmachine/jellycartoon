import { addDays, dayName, localDay, localTime } from 'comun/agenda.ts';
import type { Kitchen } from '../fridge.ts';
import {
	MAX_SKIP_DAYS,
	nextStart,
	scheduleText,
	startsBetween,
	type WallMoment
} from '#lib/plug-schedules.ts';
import { kwhPriceText } from '#lib/kwh-price.ts';
import type { Tool } from '../openrouter.ts';
import { PlugOffline } from './hub.ts';
import { HEAT_MS, kwhPriceIn, plugsOf, setPausedIn, setSkipIn, switchIn } from './plugs.ts';
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

const now = () => ({ day: localDay(), time: localTime() });
const wallOf = (iso: string) => ({ day: localDay(new Date(iso)), time: localTime(new Date(iso)) });
/** A wall moment, in its tenant's words: «hoy a las 18:00», «mañana a las 10:00», «el sábado 22 a las 10:00». */
export function momentSaid(m: WallMoment, today = localDay()) {
	const day =
		m.day === today ? 'hoy' : m.day === addDays(today, 1) ? 'mañana' : `el ${dayName(m.day)}`;
	return `${day} a las ${m.time}`;
}

/**
 * Its schedules for the model (#557): each, when they switch it on next, and a skip going on or to
 * come; what «que no se encienda solo esta tarde» needs to be worked out.
 */
export function schedulesSaid(p: PlugView, at: WallMoment = now()) {
	if (!p.schedules.length) return 'sin horarios';
	const skip =
		p.skipFrom && p.skipUntil
			? `; sus horarios no lo encienden ${momentSaid(wallOf(p.skipFrom), at.day)} hasta ${momentSaid(wallOf(p.skipUntil), at.day)} (saltados)`
			: '';
	const next = p.paused ? null : nextStart(p.schedules, at);
	return `horarios: ${p.schedules.map(scheduleText).join('; ')}${next ? `; se enciende solo ${momentSaid(next, at.day)}` : ''}${skip}`;
}

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
		return `${p.name} (${PLUG_KINDS[p.kind].label.toLowerCase()}): ${state}; ${schedulesSaid(p)}; hoy ${used(p.todayWh, p.todayEuros)}, este mes ${used(p.monthWh, p.monthEuros)}`;
	});
	return {
		plugs,
		line: `[Enchufes de la familia (encender y apagar con «plug_switch», también un rato; poner o quitar la pausa con «plug_pause»; que no se encienda solo un rato con «plug_skip»; lo gastado, de aquí): ${lines.join('. ')}.${price === null ? ' Sin precio del kWh: en euros no se sabe.' : ` Precio del kWh: ${kwhPriceText(price)}.`}]`
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

export const plugSkipTool: Tool = {
	type: 'function',
	function: {
		name: 'plug_skip',
		description:
			'Que un enchufe no se encienda solo durante un rato: se saltan los encendidos de sus horarios en ese rato y vuelven después, sin apagarlo ni impedir encenderlo a mano; sus apagados siguen («no quiero que se encienda el termo esta tarde», «este fin de semana que no se encienda el termo», «hoy sáltate el horario de la lámpara»). El rato, calculado desde ahora con lo que diga: la mañana de 6:00 a 14:00, la tarde de 14:00 a 21:00, la noche de 21:00 a 6:00 del día siguiente, «hoy» hasta las 23:59; si no está claro cuándo acaba, pregunta. Mira sus horarios en la lista de enchufes: si en ese rato no lo encienden, dilo y no la llames. Con cancel, vuelven ya sus horarios. No es una pausa («plug_pause»: apagado y sin horarios hasta quitarla) ni un encargo («create_rule»).',
		parameters: {
			type: 'object',
			properties: {
				name: { type: 'string', description: 'Su nombre, como está en la lista.' },
				from_day: { type: 'string', description: 'Desde qué día, AAAA-MM-DD.' },
				from_time: { type: 'string', description: 'Desde qué hora, HH:MM.' },
				to_day: { type: 'string', description: 'Hasta qué día, AAAA-MM-DD.' },
				to_time: { type: 'string', description: 'Hasta qué hora, HH:MM.' },
				cancel: {
					type: 'boolean',
					description: 'true para quitar el salto que tenga y que vuelvan ya sus horarios.'
				}
			},
			required: ['name'],
			additionalProperties: false
		}
	}
};

const isDayText = (v: unknown): v is string =>
	typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const isTimeText = (v: unknown): v is string =>
	typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

/**
 * A while asked for, checked (#557): from now at the earliest, ending after it starts, within
 * `MAX_SKIP_DAYS`; or why not.
 */
export function skipWhile(
	args: Record<string, unknown>,
	at: WallMoment = now()
): { from: WallMoment; to: WallMoment } | string {
	if (
		![args.from_day, args.to_day].every(isDayText) ||
		![args.from_time, args.to_time].every(isTimeText)
	)
		return 'Falta desde cuándo y hasta cuándo: días AAAA-MM-DD y horas HH:MM.';
	const asked = { day: args.from_day as string, time: args.from_time as string };
	const to = { day: args.to_day as string, time: args.to_time as string };
	const from = `${asked.day} ${asked.time}` < `${at.day} ${at.time}` ? at : asked;
	if (`${to.day} ${to.time}` <= `${from.day} ${from.time}`)
		return 'Ese rato ya ha pasado o acaba antes de empezar.';
	if (to.day > addDays(from.day, MAX_SKIP_DAYS))
		return `Como mucho ${MAX_SKIP_DAYS} días: para más, ponlo en pausa o cambia sus horarios en Enchufes.`;
	return { from, to };
}

/** What a skip leaves out, in words: «se salta su encendido de hoy a las 18:00», «se saltan 2: …». */
export function skippedSaid(starts: WallMoment[], today = localDay()) {
	const said = starts.map((m) => momentSaid(m, today));
	return starts.length === 1
		? `se salta su encendido de ${said[0]}`
		: `se saltan ${starts.length} encendidos: ${said.slice(0, -1).join(', ')} y ${said.at(-1)}`;
}

/**
 * A plug's schedules skipped in a while, or its skip taken off (#557: by voice, in Preguntar), with
 * its padlock looked at as for its schedules; in words, and whether it was done. Nothing to skip in
 * that while, nothing done.
 */
export async function skipPlug(
	k: Kitchen,
	p: Pick<PlugView, 'id' | 'name' | 'schedules'>,
	asked: { from: WallMoment; to: WallMoment } | null,
	at: WallMoment = now()
): Promise<{ result: string; done: boolean }> {
	const starts = asked ? startsBetween(p.schedules, asked.from, asked.to) : [];
	if (asked && !starts.length)
		return {
			result: `En ese rato los horarios de ${p.name} no lo encienden: no hace falta nada.`,
			done: false
		};
	const done = await setSkipIn(
		k,
		p.id,
		asked && new Date(`${asked.from.day}T${asked.from.time}`),
		asked && new Date(`${asked.to.day}T${asked.to.time}`)
	);
	if (done.gone) return { result: `${p.name} ya no está en Enchufes.`, done: false };
	if (done.locked)
		return {
			result: `${p.name} tiene el candado puesto: sus horarios no se cambian así, se quita el candado desde Energía.`,
			done: false
		};
	if (!asked) return { result: `${p.name}: vuelven ya sus horarios.`, done: true };
	return {
		result: `${p.name}: no se enciende solo de ${momentSaid(asked.from, at.day)} a ${momentSaid(asked.to, at.day)}; ${skippedSaid(starts, at.day)}. Luego vuelven sus horarios.`,
		done: true
	};
}

/** What `plug_skip` did, in words for the model. */
export async function skipByVoice(k: Kitchen, plugs: PlugView[], args: Record<string, unknown>) {
	const said = typeof args.name === 'string' ? args.name : '';
	const p = plugNamed(plugs, said);
	if (!p)
		return {
			result: `No hay un enchufe claro con el nombre «${said}». Los hay: ${plugs.map((x) => x.name).join(', ')}.`,
			done: false
		};
	if (args.cancel === true) {
		if (!p.skipUntil) return { result: `${p.name} no tiene ningún horario saltado.`, done: false };
		return skipPlug(k, p, null);
	}
	if (!p.schedules.length)
		return { result: `${p.name} no tiene horarios: no se enciende solo.`, done: false };
	const asked = skipWhile(args);
	if (typeof asked === 'string') return { result: asked, done: false };
	return skipPlug(k, p, asked);
}
