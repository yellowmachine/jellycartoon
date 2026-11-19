import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { parseRecipe } from 'comun/recipe.ts';
import { familyPeople } from '#lib/server/agenda/agenda.ts';
import { addItems, kitchenOf, toBuy } from '#lib/server/fridge.ts';
import { calls } from '#lib/server/calls.ts';
import { openRouterKey } from '#lib/server/family-settings.ts';
import { shoppingItems } from '#lib/server/chat.ts';
import {
	MESSAGE_SOURCE_NAME,
	messageSource,
	recipesFromMessages,
	saveWrittenRecipe
} from '#lib/server/recipes/import.ts';

/**
 * Mensajes (#551): who is who, to put a name on each message, and whom one may write to (as whom one
 * may call: the family, and the adults of linked families). The messages are the device's. Whether
 * the family has an AI (#555), for its panel; what is to buy, for a list that comes; and which
 * recipes that came are already in the family's book.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const k = await kitchenOf(locals.user!.id);
	const [people, contacts, key, buying, saved] = await Promise.all([
		familyPeople(k),
		calls.callable(locals.user!.id).catch(() => []),
		openRouterKey(k),
		toBuy(k),
		recipesFromMessages(k)
	]);
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
		saved
	};
};

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
