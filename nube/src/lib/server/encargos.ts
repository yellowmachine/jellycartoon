import { isTime, localDay, localTime } from 'comun/agenda.ts';
import { isDay } from 'comun/expenses.ts';
import { MAX_ALARM_LABEL, parseAlarmInput } from 'comun/alarms.ts';
import { personOf } from '#lib/server/agenda/agenda.ts';
import { addAlarm } from '#lib/server/alarms/alarms.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import {
	deleteRule,
	describeErrands,
	listErrands,
	moveErrand,
	saveRule,
	translateRule
} from '#lib/server/rules.ts';
import { ruleSaid } from '#lib/rules.ts';
import {
	changeSaid,
	type ErrandChangeCard,
	alarmSaid,
	MAX_PLAN_ITEMS,
	type PlanAlarm,
	type PlanCard,
	type PlanItem
} from '#lib/encargos.ts';

/**
 * Errands in Preguntar (#557, lib/encargos.ts): the card the AI proposes, each rule understood
 * already (what the person reads is what will be kept), and what «Guardar» keeps of it.
 */

/** A notice the AI asked for, checked: null with why if it cannot be. */
function alarmOf(v: unknown, now: { day: string; time: string }): PlanAlarm | string {
	const a = (v ?? {}) as Record<string, unknown>;
	const label = typeof a.label === 'string' ? a.label.trim().slice(0, MAX_ALARM_LABEL) : '';
	if (!label) return 'un aviso sin qué avisar';
	if (!isDay(a.day) || !isTime(a.time))
		return `«${label}»: falta el día (YYYY-MM-DD) o la hora (HH:MM)`;
	if (`${a.day} ${a.time}` <= `${now.day} ${now.time}`) return `«${label}»: esa hora ya ha pasado`;
	return { kind: 'aviso', day: a.day, time: a.time, label, savedId: null };
}

/**
 * `propose_plan`: the card, with each errand understood now by the AI that understands rules (as
 * by voice); what could not be, said to the AI so it tells the person.
 */
export async function proposePlan(
	k: Kitchen,
	who: string | null,
	args: Record<string, unknown>
): Promise<{ result: string; card?: PlanCard }> {
	const now = { day: localDay(), time: localTime() };
	const problems: string[] = [];
	const items: PlanItem[] = [];
	for (const v of Array.isArray(args.avisos) ? args.avisos : []) {
		const a = alarmOf(v, now);
		if (typeof a === 'string') problems.push(a);
		else items.push(a);
	}
	const said = (Array.isArray(args.encargos) ? args.encargos : [])
		.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
		.slice(0, MAX_PLAN_ITEMS);
	const made = await Promise.all(said.map((text) => translateRule(k, text, who)));
	made.forEach((m, i) => {
		const text = said[i]!.trim();
		if ('problem' in m) problems.push(`«${text}»: ${m.problem}`);
		else
			items.push({
				kind: 'encargo',
				said: text,
				understood: m.understood,
				spec: m.spec,
				savedId: null
			});
	});
	const shown = items.slice(0, MAX_PLAN_ITEMS);
	const notDone = problems.length ? ` No se ha podido: ${problems.join('; ')}. Díselo.` : '';
	if (!shown.length)
		return { result: `No se enseña la tarjeta: no queda nada que programar.${notDone}` };
	return {
		result: `Tarjeta enseñada con ${shown.length}: ${shown.map((it, i) => `${i + 1}) ${it.kind === 'aviso' ? `aviso en la Agenda, ${alarmSaid(it)}` : `regla de una vez, «${it.understood}»`}`).join('; ')}. La persona marca y guarda; no digas que está guardado.${notDone}`,
		card: { kind: 'encargos', items: shown }
	};
}

/**
 * «Guardar»: the ticked ones not kept yet, kept as their person's (a notice, an alarm of theirs on
 * their phone; an errand, a rule only theirs). The card as it is now, and what could not be kept.
 */
export async function savePlan(
	k: Kitchen,
	userId: string,
	card: PlanCard,
	ticked: number[]
): Promise<{ card: PlanCard; problems: string[] }> {
	const now = `${localDay()} ${localTime()}`;
	const problems: string[] = [];
	const me = await personOf(k, userId);
	const items = [...card.items];
	for (const i of new Set(ticked)) {
		const item = items[i];
		if (!item || item.savedId) continue;
		if (item.kind === 'aviso') {
			if (`${item.day} ${item.time}` <= now) {
				problems.push(`«${item.label}»: esa hora ya ha pasado`);
				continue;
			}
			const input = parseAlarmInput({
				kind: 'alarma',
				day: item.day,
				time: item.time,
				days: [],
				label: item.label,
				people: me ? [me] : [],
				place: 'movil'
			});
			if (input?.kind !== 'alarma') continue;
			items[i] = { ...item, savedId: await addAlarm(k, input) };
			continue;
		}
		const { when } = item.spec;
		if (when.kind === 'en_fecha' && `${when.day} ${when.time}` < now) {
			problems.push(`«${item.understood}»: esa hora ya ha pasado`);
			continue;
		}
		const id = await saveRule(k, userId, item.said, item.understood, item.spec);
		if (!id) problems.push('la familia ya tiene demasiadas reglas (se borran en Reglas)');
		else items[i] = { ...item, savedId: id };
	}
	return { card: { ...card, items }, problems };
}

/** `read_errands` (#557, phase 3): theirs and the house's, in words. */
export const readErrands = (k: Kitchen, userId: string) => describeErrands(k, userId);

/**
 * `propose_errand_change`: a card to move or cancel one of the errands they see, still to come;
 * nothing done yet.
 */
export async function proposeErrandChange(
	k: Kitchen,
	userId: string,
	args: Record<string, unknown>
): Promise<{ result: string; card?: ErrandChangeCard }> {
	const id = Number(args.id);
	const r = (await listErrands(k, userId)).coming.find((x) => x.id === id);
	if (!r)
		return { result: `No hay un encargo pendiente con el número ${args.id}: mira «read_errands».` };
	const cancel = args.cancel === true;
	const day = cancel ? null : String(args.day ?? '');
	const time = cancel ? null : String(args.time ?? '');
	if (!cancel) {
		if (!isDay(day) || !isTime(time))
			return { result: 'Falta el día (YYYY-MM-DD) o la hora (HH:MM).' };
		if (`${day} ${time}` < `${localDay()} ${localTime()}`)
			return { result: 'Esa hora ya ha pasado.' };
	}
	const card: ErrandChangeCard = {
		kind: 'cambio-encargo',
		ruleId: id,
		said: ruleSaid(r),
		cancel,
		day,
		time,
		done: false
	};
	return {
		result: `Tarjeta enseñada: «${card.said}» → ${changeSaid(card).toLowerCase()}. La persona lo confirma; no digas que está hecho.`,
		card
	};
}

/** The card's change, done as theirs: why not, or null. Done twice, nothing more. */
export async function applyErrandChange(k: Kitchen, userId: string, card: ErrandChangeCard) {
	if (card.done) return null;
	if (card.cancel)
		return (await deleteRule(k, userId, card.ruleId)) ? null : 'Ese encargo ya no está.';
	return moveErrand(k, userId, card.ruleId, card.day ?? '', card.time ?? '');
}
