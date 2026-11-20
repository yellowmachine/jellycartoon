import type { Kitchen } from '../fridge.ts';
import { plugNamed } from '#lib/plugs.ts';
import { pauseSaid, type PlugPauseCard } from '#lib/plug-pause.ts';
import { plugsOf } from './plugs.ts';
import { pausePlug } from './voice.ts';

/** `propose_plug_pause` (#557): the card for one of the family's plugs, by its name; nothing done. */
export async function proposePlugPause(
	k: Kitchen,
	args: Record<string, unknown>
): Promise<{ result: string; card?: PlugPauseCard }> {
	const plugs = await plugsOf(k);
	if (!plugs.length) return { result: 'La familia no tiene enchufes en Enchufes.' };
	const said = typeof args.name === 'string' ? args.name : '';
	const p = plugNamed(plugs, said);
	if (!p)
		return {
			result: `No hay un enchufe claro con el nombre «${said}». Los hay: ${plugs.map((x) => x.name).join(', ')}.`
		};
	const paused = args.paused === true;
	if (p.paused === paused)
		return { result: `${p.name} ya ${paused ? 'está' : 'no está'} en pausa.` };
	if (p.locked)
		return {
			result: `${p.name} tiene el candado puesto: la pausa no se cambia así, se quita el candado desde Energía.`
		};
	const card: PlugPauseCard = {
		kind: 'pausa-enchufe',
		plugId: p.id,
		name: p.name,
		paused,
		done: false,
		result: null
	};
	return {
		result: `Tarjeta enseñada: ${pauseSaid(card).toLowerCase()}. La persona lo confirma; no digas que está hecho.`,
		card
	};
}

/** The card done (once), as its card in Enchufes would: the card as it is now, or why not. */
export async function applyPlugPause(k: Kitchen, card: PlugPauseCard) {
	if (card.done) return { card };
	const { result, done } = await pausePlug(k, { id: card.plugId, name: card.name }, card.paused);
	return done ? { card: { ...card, done: true, result } } : { problem: result };
}
