import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { ORIGIN } from '$app/env/private';
import { addDays, isDay, localDay, mondayOf, parseEventInput } from '#lib/agenda.ts';
import { isKid } from '#lib/server/kids.ts';
import {
	addEvent,
	agendaBetween,
	agendaPeople,
	deleteEvent,
	icsToken,
	skipDay,
	updateEvent
} from '#lib/server/agenda/agenda.ts';

/**
 * The house's agenda (#200): a week (`?dia=2026-10-26`, its Monday to its Sunday) or a month
 * (`?vista=mes`), and the events to write down or change. A child only sees theirs, and changes
 * nothing.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const kid = isKid(locals.user);
	const today = localDay();
	const asked = url.searchParams.get('dia');
	const day = isDay(asked) ? asked : today;
	const view = url.searchParams.get('vista') === 'mes' ? 'mes' : 'semana';
	// A month: from the Monday of its first week to the Sunday of its last, as on a calendar.
	const first = view === 'mes' ? `${day.slice(0, 8)}01` : day;
	const from = mondayOf(first);
	const lastOfMonth = addDays(`${addDays(`${day.slice(0, 8)}28`, 4).slice(0, 8)}01`, -1);
	const to = view === 'mes' ? addDays(mondayOf(lastOfMonth), 6) : addDays(from, 6);
	const [{ events, occurrences }, people] = await Promise.all([
		agendaBetween(from, to, kid ? locals.user!.id : null),
		agendaPeople()
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
		ics: kid ? null : `${ORIGIN}/api/calendario/${await icsToken()}.ics`
	};
};

const adult = (locals: App.Locals) => {
	if (isKid(locals.user)) error(404, 'No encontrado');
	return locals.user!.id;
};

export const actions: Actions = {
	/** New or changed: `event` as JSON, as the page has it. */
	save: async ({ request, locals }) => {
		const userId = adult(locals);
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
			if (!(await updateEvent(id, input))) return fail(404, { message: 'Ese evento ya no está' });
			return { saved: id };
		}
		return { saved: await addEvent(userId, input) };
	},
	/** «Esta vez no»: one repetition. */
	skip: async ({ request, locals }) => {
		adult(locals);
		const form = await request.formData();
		const day = form.get('day');
		if (!isDay(day)) return fail(400, { message: 'Día no válido' });
		await skipDay(Number(form.get('id')), day);
	},
	/** The whole of it, every repetition. */
	delete: async ({ request, locals }) => {
		adult(locals);
		await deleteEvent(Number((await request.formData()).get('id')));
	},
	/** A new .ics link: the one before stops working (it was given to someone it should not). */
	renewIcs: async ({ locals }) => {
		adult(locals);
		await icsToken(true);
	}
};
