import type { Kitchen } from '../fridge.ts';
import { plugNamed } from '#lib/plugs.ts';
import { localDay } from 'comun/agenda.ts';
import { pauseSaid, skipTitle, type PlugPauseCard, type PlugSkipCard } from '#lib/plug-pause.ts';
import { startsBetween } from '#lib/plug-schedules.ts';
import { plugsOf } from './plugs.ts';
import { momentSaid, pausePlug, schedulesSaid, skippedSaid, skipPlug, skipWhile } from './voice.ts';

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

/**
 * `propose_plug_skip` (#557): the card for one of the family's plugs and a while, with the
 * switch-ons it leaves out; none in that while, no card, and the AI told its schedules.
 */
export async function proposePlugSkip(
	k: Kitchen,
	args: Record<string, unknown>
): Promise<{ result: string; card?: PlugSkipCard }> {
	const plugs = await plugsOf(k);
	if (!plugs.length) return { result: 'La familia no tiene enchufes en Enchufes.' };
	const said = typeof args.name === 'string' ? args.name : '';
	const p = plugNamed(plugs, said);
	if (!p)
		return {
			result: `No hay un enchufe claro con el nombre «${said}». Los hay: ${plugs.map((x) => x.name).join(', ')}.`
		};
	if (p.locked)
		return {
			result: `${p.name} tiene el candado puesto: sus horarios no se cambian así, se quita el candado desde Energía.`
		};
	const base = {
		kind: 'saltar-horario' as const,
		plugId: p.id,
		name: p.name,
		done: false,
		result: null
	};
	if (args.cancel === true) {
		if (!p.skipUntil) return { result: `${p.name} no tiene ningún horario saltado.` };
		const card: PlugSkipCard = { ...base, from: null, to: null, skipped: '' };
		return {
			result: `Tarjeta enseñada: ${skipTitle(card).toLowerCase()}. La persona lo confirma.`,
			card
		};
	}
	if (!p.schedules.length) return { result: `${p.name} no tiene horarios: no se enciende solo.` };
	const asked = skipWhile(args);
	if (typeof asked === 'string') return { result: asked };
	const starts = startsBetween(p.schedules, asked.from, asked.to);
	if (!starts.length)
		return {
			result: `En ese rato los horarios de ${p.name} no lo encienden (${schedulesSaid(p)}): no hace falta nada, díselo.`
		};
	const today = localDay();
	const card: PlugSkipCard = {
		...base,
		from: asked.from,
		to: asked.to,
		skipped: `de ${momentSaid(asked.from, today)} a ${momentSaid(asked.to, today)}; ${skippedSaid(starts, today)}`
	};
	return {
		result: `Tarjeta enseñada: ${skipTitle(card).toLowerCase()} ${card.skipped}. La persona lo confirma; no digas que está hecho.`,
		card
	};
}

/** The card done (once), with the plug's schedules as they are now: the card, or why not. */
export async function applyPlugSkip(k: Kitchen, card: PlugSkipCard) {
	if (card.done) return { card };
	const p = (await plugsOf(k)).find((x) => x.id === card.plugId);
	if (!p) return { problem: `${card.name} ya no está en Enchufes.` };
	const asked =
		card.from && card.to
			? skipWhile({
					from_day: card.from.day,
					from_time: card.from.time,
					to_day: card.to.day,
					to_time: card.to.time
				})
			: null;
	if (typeof asked === 'string') return { problem: asked };
	const { result, done } = await skipPlug(k, p, asked);
	return done ? { card: { ...card, done: true, result } } : { problem: result };
}
