import type { Kitchen } from '../fridge.ts';
import type { Tool } from '../openrouter.ts';
import { PlugOffline } from './hub.ts';
import { kwhPriceIn, plugsOf, switchIn } from './plugs.ts';
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
	const used = (wh: number) =>
		`${energyText(wh)}${price === null ? '' : ` (${euroText((wh / 1000) * price)})`}`;
	const lines = plugs.map((p) => {
		const state = p.paused
			? 'en pausa'
			: !p.online
				? 'sin conexión'
				: `${p.output ? 'encendido' : 'apagado'}${p.power ? `, ${powerText(p.power)} ahora` : ''}`;
		return `${p.name} (${PLUG_KINDS[p.kind].label.toLowerCase()}): ${state}; hoy ${used(p.todayWh)}, este mes ${used(p.monthWh)}`;
	});
	return {
		plugs,
		line: `[Enchufes de la familia (encender y apagar con «plug_switch», también un rato; lo gastado, de aquí): ${lines.join('. ')}.${price === null ? ' Sin precio del kWh: en euros no se sabe.' : ''}]`
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
			'Enciende o apaga un enchufe de la familia por su nombre («enciende la lámpara», «apaga el termo»). Solo los de la lista de enchufes. Para un rato: for_minutes, ahora y vuelve como estaba después («enciende la estufa media hora»); in_minutes, cambia pasado ese tiempo («apaga la tele dentro de una hora»). Uno de los dos, o ninguno.',
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
			result: `Un rato es de 1 a ${MAX_TIMED_MIN} minutos, «durante» o «dentro de», uno solo. Para más, un horario en Enchufes.`,
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
		if (done === 'paused')
			return {
				result: `${p.name} está en pausa: se quita desde Enchufes, no se enciende así.`,
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
