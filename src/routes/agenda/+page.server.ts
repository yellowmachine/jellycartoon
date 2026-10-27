import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { ORIGIN } from '$app/env/private';
import { addDays, isDay, localDay, mondayOf, parseEventInput } from '#lib/agenda.ts';
import { parseAlarmInput } from '#lib/alarms.ts';
import {
	addAlarm,
	canTouch,
	deleteAlarm,
	listAlarms,
	setPaused,
	skipNext,
	stopAlarm
} from '#lib/server/alarms/alarms.ts';
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
	const [{ events, occurrences }, people, alarms] = await Promise.all([
		agendaBetween(from, to, kid ? locals.user!.id : null),
		agendaPeople(),
		listAlarms(locals.user!.id)
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
		/** Alarms and timers (#241): the house's and theirs. */
		alarms,
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
	/** An alarm or a timer (#241): `alarm` as JSON, as the page has it. */
	addAlarm: async ({ request, locals }) => {
		const userId = adult(locals);
		let body: unknown;
		try {
			body = JSON.parse(String((await request.formData()).get('alarm') ?? ''));
		} catch {
			return fail(400, { message: 'Alarma no válida' });
		}
		const input = parseAlarmInput(body);
		if (!input) return fail(400, { message: 'Falta la hora o los minutos' });
		return { alarmSaved: await addAlarm(userId, input) };
	},
	/** «Parar», «Esta vez no», «Pausar»/«Activar», «Quitar»: one the user sees. */
	alarm: async ({ request, locals }) => {
		const userId = adult(locals);
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (!id || !(await canTouch(id, userId))) return fail(404, { message: 'Ese aviso ya no está' });
		switch (form.get('do')) {
			case 'stop':
				return void (await stopAlarm(id));
			case 'skip':
				return void (await skipNext(id));
			case 'pause':
				return void (await setPaused(id, true));
			case 'resume':
				return void (await setPaused(id, false));
			case 'delete':
				return void (await deleteAlarm(id));
		}
		return fail(400, { message: 'Acción no válida' });
	},
	/** A new .ics link: the one before stops working (it was given to someone it should not). */
	renewIcs: async ({ locals }) => {
		adult(locals);
		await icsToken(true);
	}
};
