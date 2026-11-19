import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { parseRecipe } from 'comun/recipe.ts';
import { addDays, localDay } from 'comun/agenda.ts';
import { addEvent, agendaBetween, familyPeople } from '#lib/server/agenda/agenda.ts';
import { citaKey, parseCita } from '#lib/cita.ts';
import { listSavedPlaces, savePlace } from '#lib/server/trips/places.ts';
import { addItems, kitchenOf, toBuy } from '#lib/server/fridge.ts';
import { calls } from '#lib/server/calls.ts';
import { openRouterKey } from '#lib/server/family-settings.ts';
import { shoppingItems } from '#lib/server/chat.ts';
import {
	getRecipe,
	MESSAGE_SOURCE_NAME,
	messageSource,
	recipesFromMessages,
	saveWrittenRecipe
} from '#lib/server/recipes/import.ts';

/**
 * Mensajes (#551): who is who, to put a name on each message, and whom one may write to (as whom one
 * may call: the family, and the adults of linked families). The messages are the device's. Whether
 * the family has an AI (#555), for its panel; what is to buy, for a list that comes; and which
 * recipes that came are already in the family's book; and a recipe of the book to send.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	const k = await kitchenOf(locals.user!.id);
	const asked = Number(url.searchParams.get('receta'));
	const [people, contacts, key, buying, saved, inAgenda, places, sharing] = await Promise.all([
		familyPeople(k),
		calls.callable(locals.user!.id).catch(() => []),
		openRouterKey(k),
		toBuy(k),
		recipesFromMessages(k),
		agendaKeys(k),
		listSavedPlaces(k),
		Number.isInteger(asked) && asked > 0 ? getRecipe(k, asked) : null
	]);
	const recipe = sharing ? parseRecipe(sharing) : null;
	return {
		userId: locals.user!.id,
		names: {
			...Object.fromEntries(contacts.map((c) => [c.userId, c.name])),
			...Object.fromEntries(people.filter((p) => p.userId).map((p) => [p.userId!, p.name]))
		} as Record<string, string>,
		contacts: contacts.map((c) => ({ userId: c.userId, name: c.name, family: c.family ?? null })),
		hasAi: Boolean(key),
		toBuy: buying,
		/** In the same family, sharing is referring: saved by one, saved for all. */
		saved,
		inAgenda,
		/** This person's kept places (#151): to send one, and to know one that came is kept. */
		myPlaces: places,
		/** A recipe of the book to send, from Recetas' «Mandar» (#555). */
		sharing: sharing && recipe && typeof recipe !== 'string' ? { id: sharing.id, recipe } : null
	};
};

/** How far plans are looked for in the Agenda: from a while ago, to a year and a bit ahead. */
const AGENDA_BACK = 30;
const AGENDA_AHEAD = 400;

/** What is in the family's Agenda, as plans are compared (citaKey): noted by one, noted for all. */
async function agendaKeys(k: Awaited<ReturnType<typeof kitchenOf>>) {
	const today = localDay();
	const { occurrences } = await agendaBetween(
		k,
		addDays(today, -AGENDA_BACK),
		addDays(today, AGENDA_AHEAD)
	);
	return [...new Set(occurrences.map((o) => citaKey({ ...o, time: o.startTime })))];
}

/**
 * What came in a card (#555), taken by whoever got it, into their own family: it was decrypted in
 * their device, so the device sends it as it is (checked again here).
 */
export const actions: Actions = {
	/** A list's ticked things, onto the family's shopping list. */
	add: async ({ request, locals }) => {
		const form = await request.formData();
		const items = shoppingItems(form.getAll('item').map(String));
		if (!items.length) return fail(400, { message: 'Marca algo para añadir' });
		return { added: await addItems(await kitchenOf(locals.user!.id), items) };
	},
	/**
	 * A plan, into the family's Agenda: for everyone, nothing repeated, no notice; only once (if it
	 * is already there, by day, time and title, it stays as it is).
	 */
	addEvent: async ({ request, locals }) => {
		const form = await request.formData();
		let raw: unknown = null;
		try {
			raw = JSON.parse(String(form.get('cita') ?? ''));
		} catch {
			// Said below.
		}
		const cita = parseCita(raw);
		if (!cita) return fail(400, { message: 'Ese plan no vale' });
		const k = await kitchenOf(locals.user!.id);
		const { occurrences } = await agendaBetween(k, cita.day, cita.day);
		if (occurrences.some((o) => citaKey({ ...o, time: o.startTime }) === citaKey(cita)))
			return { noted: true };
		await addEvent(k, {
			title: cita.title,
			notes: cita.notes,
			startDay: cita.day,
			startTime: cita.time,
			endDay: null,
			endTime: cita.endTime,
			repeat: { every: null },
			remind: null,
			people: []
		});
		return { noted: true };
	},
	/** A place that came, among this person's own (#151): a copy, as places are each one's. */
	savePlace: async ({ request, locals }) => {
		const form = await request.formData();
		let raw: Record<string, unknown> = {};
		try {
			raw = JSON.parse(String(form.get('sitio') ?? '{}')) ?? {};
		} catch {
			// Said below.
		}
		const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 100) : '';
		const lat = Number(raw.lat);
		const lon = Number(raw.lon);
		if (
			!name ||
			!Number.isFinite(lat) ||
			!Number.isFinite(lon) ||
			Math.abs(lat) > 90 ||
			Math.abs(lon) > 180
		)
			return fail(400, { message: 'Ese sitio no vale' });
		const address =
			typeof raw.address === 'string' && raw.address.trim()
				? raw.address.trim().slice(0, 200)
				: null;
		await savePlace(await kitchenOf(locals.user!.id), { id: null, name, at: [lon, lat], address });
		return { kept: true };
	},
	/** A recipe, into the family's book: once per message (`from`), however many times it is tapped. */
	save: async ({ request, locals }) => {
		const form = await request.formData();
		let raw: unknown = null;
		try {
			raw = JSON.parse(String(form.get('recipe') ?? ''));
		} catch {
			// Said below.
		}
		const recipe = parseRecipe(raw);
		const from = String(form.get('from') ?? '').slice(0, 200);
		if (typeof recipe === 'string' || !from) return fail(400, { message: 'Esa receta no vale' });
		const id = await saveWrittenRecipe(
			await kitchenOf(locals.user!.id),
			recipe,
			messageSource(from),
			MESSAGE_SOURCE_NAME
		);
		return { savedId: id };
	}
};
