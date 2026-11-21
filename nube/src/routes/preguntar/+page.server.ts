import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	addFromCard,
	askChat,
	chatHistory,
	ChatError,
	applyChangeFromCard,
	applyPauseFromCard,
	applySkipFromCard,
	clearChat,
	savePlanFromCard,
	saveRecipeFromCard
} from '#lib/server/chat.ts';
import { openRouterKey } from '#lib/server/family-settings.ts';
import { kitchenOf, toBuy } from '#lib/server/fridge.ts';
import { sectionOfPath } from '#lib/nav.ts';

/**
 * «Preguntar» (#470): this person's chat with the family's AI. Children never get here: kids.ts
 * does not let them in (neither the page nor its actions). The side panel (#504) posts here too,
 * from any page: each action answers what changed, so the panel updates without loading this page.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const k = await kitchenOf(locals.user!.id);
	const [messages, buying, apiKey] = await Promise.all([
		chatHistory(k, locals.user!.id),
		toBuy(k),
		openRouterKey(k)
	]);
	return { messages, toBuy: buying, hasAi: Boolean(apiKey) };
};

const numberOf = (form: FormData, name: string) => {
	const n = Number(form.get(name));
	return Number.isInteger(n) && n >= 0 ? n : null;
};

export const actions: Actions = {
	ask: async ({ request, locals }) => {
		const form = await request.formData();
		const question = String(form.get('question') ?? '');
		// From the panel: the page it is beside, told to the AI by its section's name.
		const path = String(form.get('path') ?? '').slice(0, 300);
		const section = sectionOfPath(path.split('?')[0]!);
		const user = locals.user!;
		try {
			const k = await kitchenOf(user.id);
			const messages = await askChat(
				k,
				{ id: user.id, name: user.name },
				question,
				section && section.path !== '/preguntar' ? section.label : null,
				path
			);
			return { messages };
		} catch (err) {
			if (err instanceof ChatError) return fail(503, { question, message: err.message });
			throw err;
		}
	},
	/** The ticked items of a shopping card, onto the family's list. */
	add: async ({ request, locals }) => {
		const form = await request.formData();
		const message = numberOf(form, 'message');
		const card = numberOf(form, 'card');
		if (message === null || card === null) return fail(400, { message: 'Falta la tarjeta' });
		const ticked = form.getAll('item').map(String);
		if (!ticked.length) return fail(400, { message: 'Marca algo para añadir' });
		const k = await kitchenOf(locals.user!.id);
		const added = await addFromCard(k, locals.user!.id, message, card, ticked);
		if (added === null) return fail(404, { message: 'Esa tarjeta ya no está' });
		return { added };
	},
	/** A recipe card, into the family's recipe book. */
	save: async ({ request, locals }) => {
		const form = await request.formData();
		const message = numberOf(form, 'message');
		const card = numberOf(form, 'card');
		if (message === null || card === null) return fail(400, { message: 'Falta la tarjeta' });
		const k = await kitchenOf(locals.user!.id);
		const id = await saveRecipeFromCard(k, locals.user!.id, message, card);
		if (id === null) return fail(404, { message: 'Esa tarjeta ya no está' });
		return { savedId: id };
	},
	/** The ticked lines of an errands card (#557): alarms in the Agenda, rules in Reglas. */
	plan: async ({ request, locals }) => {
		const form = await request.formData();
		const message = numberOf(form, 'message');
		const card = numberOf(form, 'card');
		if (message === null || card === null) return fail(400, { message: 'Falta la tarjeta' });
		const ticked = form
			.getAll('item')
			.map(Number)
			.filter((n) => Number.isInteger(n) && n >= 0);
		if (!ticked.length) return fail(400, { message: 'Marca algo para guardar' });
		const k = await kitchenOf(locals.user!.id);
		const saved = await savePlanFromCard(k, locals.user!.id, message, card, ticked);
		if (saved === null) return fail(404, { message: 'Esa tarjeta ya no está' });
		return { plan: saved.card, problems: saved.problems };
	},
	/** An errand change card (#557, phase 3): moved or cancelled. */
	change: async ({ request, locals }) => {
		const form = await request.formData();
		const message = numberOf(form, 'message');
		const card = numberOf(form, 'card');
		if (message === null || card === null) return fail(400, { message: 'Falta la tarjeta' });
		const k = await kitchenOf(locals.user!.id);
		const done = await applyChangeFromCard(k, locals.user!.id, message, card);
		if (done === null) return fail(404, { message: 'Esa tarjeta ya no está' });
		if ('problem' in done) return fail(400, { message: done.problem });
		return { change: done.card };
	},
	/** A plug pause card (#557): its pause put or taken off. */
	pause: async ({ request, locals }) => {
		const form = await request.formData();
		const message = numberOf(form, 'message');
		const card = numberOf(form, 'card');
		if (message === null || card === null) return fail(400, { message: 'Falta la tarjeta' });
		const k = await kitchenOf(locals.user!.id);
		const done = await applyPauseFromCard(k, locals.user!.id, message, card);
		if (done === null) return fail(404, { message: 'Esa tarjeta ya no está' });
		if ('problem' in done) return fail(400, { message: done.problem });
		return { pause: done.card };
	},
	/** A skip card (#557): a plug's schedules skipped for a while, or back. */
	skip: async ({ request, locals }) => {
		const form = await request.formData();
		const message = numberOf(form, 'message');
		const card = numberOf(form, 'card');
		if (message === null || card === null) return fail(400, { message: 'Falta la tarjeta' });
		const k = await kitchenOf(locals.user!.id);
		const done = await applySkipFromCard(k, locals.user!.id, message, card);
		if (done === null) return fail(404, { message: 'Esa tarjeta ya no está' });
		if ('problem' in done) return fail(400, { message: done.problem });
		return { skip: done.card };
	},
	/** «Empezar de nuevo». */
	clear: async ({ locals }) => {
		await clearChat(await kitchenOf(locals.user!.id), locals.user!.id);
	}
};
