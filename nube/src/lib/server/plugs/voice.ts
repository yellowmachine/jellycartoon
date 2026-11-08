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
		line: `[Enchufes de la familia (encender y apagar con «plug_switch»; lo gastado, de aquí): ${lines.join('. ')}.${price === null ? ' Sin precio del kWh: en euros no se sabe.' : ''}]`
	};
}

export const plugSwitchTool: Tool = {
	type: 'function',
	function: {
		name: 'plug_switch',
		description:
			'Enciende o apaga un enchufe de la familia por su nombre («enciende la lámpara», «apaga el termo»). Solo los de la lista de enchufes.',
		parameters: {
			type: 'object',
			properties: {
				name: { type: 'string', description: 'Su nombre, como está en la lista.' },
				on: { type: 'boolean', description: 'true para encender, false para apagar.' }
			},
			required: ['name', 'on'],
			additionalProperties: false
		}
	}
};

/** What `plug_switch` did, in words for the model. */
export async function switchByVoice(
	k: Kitchen,
	plugs: PlugView[],
	args: Record<string, unknown>
): Promise<{ result: string; done: boolean }> {
	const said = typeof args.name === 'string' ? args.name : '';
	const on = args.on === true;
	const p = plugNamed(plugs, said);
	if (!p)
		return {
			result: `No hay un enchufe claro con el nombre «${said}». Los hay: ${plugs.map((x) => x.name).join(', ')}.`,
			done: false
		};
	try {
		const done = await switchIn(k, p.id, on);
		if (done === 'paused')
			return {
				result: `${p.name} está en pausa: se quita desde Enchufes, no se enciende así.`,
				done: false
			};
		if (!done) return { result: `${p.name} ya no está.`, done: false };
		return { result: `${p.name} ${on ? 'encendido' : 'apagado'}.`, done: true };
	} catch (e) {
		if (e instanceof PlugOffline)
			return {
				result: `${p.name} no está conectado ahora: no se puede ${on ? 'encender' : 'apagar'}.`,
				done: false
			};
		throw e;
	}
}
