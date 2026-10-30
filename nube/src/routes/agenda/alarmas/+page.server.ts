import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { parseAlarmInput } from 'comun/alarms.ts';
import {
	addAlarm,
	canTouch,
	deleteAlarm,
	listAlarms,
	setPaused,
	skipAlarm,
	startTimer,
	startTimerAt,
	stopAlarm
} from '#lib/server/alarms/alarms.ts';
import { hasHouse } from '#lib/server/house.ts';
import { agendaPeople, personOf } from '#lib/server/agenda/agenda.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import { allSatellites } from '#lib/server/satellites.ts';

/** The Agenda's alarms and timers (#241, #253): the house's and the user's. */
export const load: PageServerLoad = async ({ locals }) => {
	const k = await kitchenOf(locals.user!.id);
	const me = await personOf(k, locals.user!.id);
	const [people, alarms, satellites, house] = await Promise.all([
		agendaPeople(k),
		listAlarms(k, me),
		allSatellites(k.familyId),
		hasHouse(locals.user!.id)
	]);
	return { people, alarms, satellites, house, me, readonly: false };
};

const kitchen = (locals: App.Locals) => kitchenOf(locals.user!.id);

export const actions: Actions = {
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
	/**
	 * A timer by hand, as by voice: theirs on their phones or in the house (`startTimer`), or for
	 * anyone in a satellite's room (`startTimerAt`). Without a name, «10 minutos», «10 minutos (2)».
	 */
	addTimer: async ({ request, locals }) => {
		const k = await kitchen(locals);
		let body: unknown;
		try {
			body = JSON.parse(String((await request.formData()).get('timer') ?? ''));
		} catch {
			return fail(400, { message: 'Temporizador no válido' });
		}
		const input = parseAlarmInput(body);
		if (!input || input.kind !== 'temporizador')
			return fail(400, { message: 'Entre un minuto y 24 horas' });
		// Its own name, if it has one: the made-up one would restart another of the same time.
		const said = (body as { label?: unknown }).label;
		const label = typeof said === 'string' && said.trim() ? input.label : '';
		const seconds = input.minutes * 60;
		const me = await personOf(k, locals.user!.id);
		if (input.place.startsWith('satelite:') || (!me && input.place === 'casa'))
			return { timerSaved: await startTimerAt(k, input.place, { label, seconds }) };
		if (!me) return fail(400, { message: 'No estás en las personas de la familia' });
		return { timerSaved: await startTimer(k, me, { label, seconds, place: input.place }) };
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
	}
};
