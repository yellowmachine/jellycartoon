import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { ORIGIN } from '$app/env/private';
import { addDays, isDay, localDay, mondayOf, parseEventInput } from 'comun/agenda.ts';
import {
	addEvent,
	agendaBetween,
	agendaPeople,
	deleteEvent,
	icsToken,
	personOf,
	skipDay,
	updateEvent
} from '#lib/server/agenda/agenda.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import { isKidAccount } from '#lib/server/kids.ts';

/**
 * The family's agenda (#253; jellycartoon's #200): a week (`?dia=2026-10-26`, its Monday to its
 * Sunday) or a month (`?vista=mes`), the events to write down or change. The alarms, in their
 * tab (alarmas/).
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const k = await kitchenOf(locals.user!.id);
	const today = localDay();
	const asked = url.searchParams.get('dia');
	const day = isDay(asked) ? asked : today;
	const view = url.searchParams.get('vista') === 'mes' ? 'mes' : 'semana';
	// A month: from the Monday of its first week to the Sunday of its last, as on a calendar.
	const first = view === 'mes' ? `${day.slice(0, 8)}01` : day;
	const from = mondayOf(first);
	const lastOfMonth = addDays(`${addDays(`${day.slice(0, 8)}28`, 4).slice(0, 8)}01`, -1);
	const to = view === 'mes' ? addDays(mondayOf(lastOfMonth), 6) : addDays(from, 6);
	// A child (#303): its own, only to look at (hooks.server.ts lets it write nothing here).
	const kid = await isKidAccount(locals.user!.id);
	const kidPerson = kid ? Number(await personOf(k, locals.user!.id)) || -1 : null;
	const [{ events, occurrences }, people, token] = await Promise.all([
		agendaBetween(k, from, to, kidPerson),
		agendaPeople(k),
		kid ? null : icsToken(k)
	]);
	return {
		view,
		day,
		today,
		from,
		to,
		events,
		occurrences,
		people,
		readonly: kid,
		kid,
		ics: token ? `${ORIGIN}/api/calendario/${token}.ics` : null
	};
};

const kitchen = (locals: App.Locals) => kitchenOf(locals.user!.id);

export const actions: Actions = {
	/** New or changed: `event` as JSON, as the page has it. */
	save: async ({ request, locals }) => {
		const k = await kitchen(locals);
		const form = await request.formData();
		let body: unknown;
		try {
			body = JSON.parse(String(form.get('event') ?? ''));
		} catch {
			return fail(400, { message: 'Evento no válido' });
		}
		const input = parseEventInput(body);
		if (!input) return fail(400, { message: 'Falta qué es o el día' });
		const id = Number(form.get('id'));
		if (id) {
			if (!(await updateEvent(k, id, input)))
				return fail(404, { message: 'Ese evento ya no está' });
			return { saved: id };
		}
		return { saved: await addEvent(k, input) };
	},
	/** «Esta vez no»: one repetition. */
	skip: async ({ request, locals }) => {
		const k = await kitchen(locals);
		const form = await request.formData();
		const day = form.get('day');
		if (!isDay(day)) return fail(400, { message: 'Día no válido' });
		await skipDay(k, Number(form.get('id')), day);
	},
	/** The whole of it, every repetition. */
	delete: async ({ request, locals }) => {
		const k = await kitchen(locals);
		await deleteEvent(k, Number((await request.formData()).get('id')));
	},
	/** A new .ics link: the one before stops working (it was given to someone it should not). */
	renewIcs: async ({ locals }) => {
		await icsToken(await kitchen(locals), true);
	}
};
