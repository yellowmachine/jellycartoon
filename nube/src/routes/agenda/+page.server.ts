import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { ORIGIN } from '$app/env/private';
import { addDays, isDay, localDay, mondayOf, parseEventInput } from 'comun/agenda.ts';
import { parseAlarmInput } from 'comun/alarms.ts';
import {
	addAlarm,
	canTouch,
	deleteAlarm,
	listAlarms,
	setPaused,
	skipAlarm,
	stopAlarm
} from '#lib/server/alarms/alarms.ts';
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
import { houseSatellites } from '#lib/server/house.ts';

/**
 * The family's agenda (#253; jellycartoon's #200): a week (`?dia=2026-10-26`, its Monday to its
 * Sunday) or a month (`?vista=mes`), the events to write down or change, and the alarms.
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
	const me = await personOf(k, locals.user!.id);
	const [{ events, occurrences }, people, alarms, satellites, token] = await Promise.all([
		agendaBetween(k, from, to),
		agendaPeople(k),
		listAlarms(k, me),
		houseSatellites(k.familyId),
		icsToken(k)
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
		/** The alarms (#241): the house's and theirs. */
		alarms,
		satellites,
		readonly: false,
		ics: `${ORIGIN}/api/calendario/${token}.ics`
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
	/** An alarm (#241): `alarm` as JSON, as the page has it. */
	addAlarm: async ({ request, locals }) => {
		const k = await kitchen(locals);
		let body: unknown;
		try {
			body = JSON.parse(String((await request.formData()).get('alarm') ?? ''));
		} catch {
			return fail(400, { message: 'Alarma no válida' });
		}
		const input = parseAlarmInput(body);
		if (!input || input.kind !== 'alarma') return fail(400, { message: 'Falta la hora' });
		return { alarmSaved: await addAlarm(k, input) };
	},
	/** «Parar», «Esta vez no», «Pausar»/«Activar», «Quitar»: one the user sees. */
	alarm: async ({ request, locals }) => {
		const k = await kitchen(locals);
		const form = await request.formData();
		const id = Number(form.get('id'));
		const me = await personOf(k, locals.user!.id);
		if (!id || !(await canTouch(k, id, me))) return fail(404, { message: 'Esa alarma ya no está' });
		switch (form.get('do')) {
			case 'stop':
				return void (await stopAlarm(k, id));
			case 'skip':
				return void (await skipAlarm(k, id));
			case 'pause':
				return void (await setPaused(k, id, true));
			case 'resume':
				return void (await setPaused(k, id, false));
			case 'delete':
				return void (await deleteAlarm(k, id));
		}
		return fail(400, { message: 'Acción no válida' });
	},
	/** A new .ics link: the one before stops working (it was given to someone it should not). */
	renewIcs: async ({ locals }) => {
		await icsToken(await kitchen(locals), true);
	}
};
