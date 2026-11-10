import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { PlugOffline } from '#lib/server/plugs/hub.ts';
import {
	addSchedule,
	createPlug,
	deleteSchedule,
	deletePlug,
	kwhPrice,
	listPlugs,
	LOCKED_PROBLEM,
	manualKwhPrice,
	MAX_KWH_PRICE,
	renewPlugToken,
	setKwhPrice,
	setLocked,
	setNotices,
	setPaused,
	switchPlug,
	updatePlug
} from '#lib/server/plugs/plugs.ts';
import { addFoundPlug, satellitesOf, searchPlugs } from '#lib/server/plugs/setup.ts';
import { isPlugKind, MAX_ON_HOURS, MAX_PLUG_NAME, plugAddress, TIMER_MINUTES } from '#lib/plugs.ts';

/** Enchufes (#396): the family's smart plugs, on and off, and what they use. */
export const load: PageServerLoad = async ({ locals }) => ({
	plugs: await listPlugs(locals.user!.id),
	price: await kwhPrice(locals.user!.id),
	/** Written by hand: it wins over the bill's. */
	manual: await manualKwhPrice(locals.user!.id),
	/** With any, plugs are found and set up by them (#396). */
	satellites: (await satellitesOf(locals.user!.id)).length
});

const nameAndKind = (form: FormData) => {
	const name = String(form.get('name') ?? '').trim();
	const kind = form.get('kind');
	if (!isPlugKind(kind)) return { problem: 'Elige qué hay enchufado' } as const;
	if (name.length > MAX_PLUG_NAME) return { problem: `Hasta ${MAX_PLUG_NAME} letras` } as const;
	return { name, kind } as const;
};

export const actions: Actions = {
	/** A new plug: its address, with its token, shown once. */
	add: async ({ request, locals, url }) => {
		const got = nameAndKind(await request.formData());
		if ('problem' in got) return fail(400, { problem: got.problem });
		const { id, token } = await createPlug(locals.user!.id, got.name, got.kind);
		return { address: { id, kind: got.kind, url: plugAddress(url.origin, token) } };
	},
	/** The Shelly the family's satellites see in the home's network. */
	search: async ({ locals, url }) => ({ search: await searchPlugs(locals.user!.id, url.origin) }),
	/** One of them, added and pointed at Seilide by the satellite that saw it. */
	addFound: async ({ request, locals, url }) => {
		const form = await request.formData();
		const got = nameAndKind(form);
		if ('problem' in got) return fail(400, { problem: got.problem });
		const done = await addFoundPlug(locals.user!.id, url.origin, {
			satelliteId: String(form.get('satelliteId') ?? ''),
			deviceId: String(form.get('deviceId') ?? ''),
			ip: String(form.get('ip') ?? ''),
			...got
		});
		if ('problem' in done) return fail(409, { problem: done.problem });
		return { connecting: done.id };
	},
	/** On or off. Not connected, it says so. */
	switch: async ({ request, locals }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		try {
			const done = await switchPlug(locals.user!.id, id, form.get('on') === 'true');
			if (!done) return fail(404, { problem: 'Ese enchufe ya no está' });
			if (done === 'locked') return fail(409, { switchProblem: id, problem: LOCKED_PROBLEM });
			if (done === 'paused')
				return fail(409, { switchProblem: id, problem: 'Está en pausa: quítale la pausa antes' });
		} catch (e) {
			if (e instanceof PlugOffline)
				return fail(409, { switchProblem: id, problem: 'El enchufe no está conectado' });
			throw e;
		}
		return { switched: id };
	},
	/**
	 * Its timer (#396): on now and back off after `minutes` («Encender durante» from off, «Apagar
	 * dentro de» from on, the same order), by the plug's own timer. Without `minutes`, «Quitar»:
	 * switched as it is, which ends the timer.
	 */
	timer: async ({ request, locals }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const raw = form.get('minutes');
		const minutes = raw === null ? null : Number(raw);
		if (minutes !== null && !TIMER_MINUTES.includes(minutes as never))
			return fail(400, { switchProblem: id, problem: 'Elige uno de los botones' });
		try {
			const done = minutes
				? await switchPlug(locals.user!.id, id, true, minutes * 60)
				: await switchPlug(locals.user!.id, id, form.get('on') === 'true');
			if (!done) return fail(404, { problem: 'Ese enchufe ya no está' });
			if (done === 'locked') return fail(409, { switchProblem: id, problem: LOCKED_PROBLEM });
			if (done === 'paused')
				return fail(409, { switchProblem: id, problem: 'Está en pausa: quítale la pausa antes' });
			if (done === 'heating')
				return fail(409, {
					switchProblem: id,
					problem: 'Está calentando largo tras la pausa: ahora no lleva temporizador'
				});
		} catch (e) {
			if (e instanceof PlugOffline)
				return fail(409, { switchProblem: id, problem: 'El enchufe no está conectado' });
			throw e;
		}
		return { switched: id };
	},
	save: async ({ request, locals }) => {
		const form = await request.formData();
		const got = nameAndKind(form);
		if ('problem' in got) return fail(400, { problem: got.problem });
		await updatePlug(locals.user!.id, String(form.get('id') ?? ''), got.name, got.kind);
		return { saved: true };
	},
	/** A new address, the old one no longer valid. */
	renew: async ({ request, locals, url }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const token = await renewPlugToken(locals.user!.id, id);
		if (!token) return fail(404, { problem: 'Ese enchufe ya no está' });
		const kind = form.get('kind');
		return {
			address: { id, kind: isPlugKind(kind) ? kind : 'otro', url: plugAddress(url.origin, token) }
		};
	},
	/** A schedule more for a plug (#396): days, and from when to when. */
	schedule: async ({ request, locals }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const done = await addSchedule(locals.user!.id, id, {
			days: form.getAll('days').map(Number),
			start: String(form.get('start') ?? ''),
			end: String(form.get('end') ?? '')
		});
		if ('problem' in done) return fail(400, { scheduleProblem: id, problem: done.problem });
		return { scheduled: id };
	},
	unschedule: async ({ request, locals }) => {
		const form = await request.formData();
		await deleteSchedule(
			locals.user!.id,
			String(form.get('id') ?? ''),
			Number(form.get('scheduleId'))
		);
		return { unscheduled: true };
	},
	/** «En pausa», or back: out of a long pause a water heater heats long first. */
	pause: async ({ request, locals }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const { heats, locked } = await setPaused(locals.user!.id, id, form.get('paused') === 'true');
		if (locked) return fail(409, { switchProblem: id, problem: LOCKED_PROBLEM });
		return { pausedId: id, heats };
	},
	/** «Con candado» or without (any adult), against switching it off by a slip. */
	lock: async ({ request, locals }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		if (!(await setLocked(locals.user!.id, id, form.get('locked') === 'true')))
			return fail(404, { problem: 'Ese enchufe ya no está' });
		return { lockedId: id };
	},
	/** Its notices (#396, phase 3): which, and out loud or not. */
	notices: async ({ request, locals }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const hours = form.get('longOn') === 'on' ? Number(form.get('onHours')) : null;
		if (hours !== null && !(Number.isInteger(hours) && hours >= 1 && hours <= MAX_ON_HOURS))
			return fail(400, { noticesProblem: id, problem: `Entre 1 y ${MAX_ON_HOURS} horas` });
		await setNotices(locals.user!.id, id, {
			done: form.get('done') === 'on',
			stopped: form.get('stopped') === 'on',
			offline: form.get('offline') === 'on',
			onHours: hours,
			aloud: form.get('aloud') === 'on'
		});
		return { noticesSaved: id };
	},
	/** What a kWh costs, «0,15»; empty, unknown. */
	price: async ({ request, locals }) => {
		const raw = String((await request.formData()).get('price') ?? '')
			.trim()
			.replace(',', '.');
		const price = raw === '' ? null : Number(raw);
		if (price !== null && !(Number.isFinite(price) && price > 0 && price <= MAX_KWH_PRICE))
			return fail(400, { problem: 'Pon el precio en euros, como 0,15' });
		await setKwhPrice(locals.user!.id, price);
		return { priced: true };
	},
	remove: async ({ request, locals }) => {
		await deletePlug(locals.user!.id, String((await request.formData()).get('id') ?? ''));
		return { removed: true };
	}
};
