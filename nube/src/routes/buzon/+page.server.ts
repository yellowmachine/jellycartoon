import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { familyPeople } from '#lib/server/agenda/agenda.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import { leaveMessage, MAX_MESSAGE } from '#lib/server/inbox.ts';
import { answerProposal, listInbox, markRead, removeFromInbox } from '#lib/server/inbox-store.ts';
import { remember } from '#lib/server/memory.ts';

/**
 * Their «Buzón» (#331): what the app told them, newest first, and the messages left for them; and
 * one to leave for someone of the family. Only theirs (inbox.ts); children have one too (kids.ts).
 */
export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;
	const k = await kitchenOf(userId);
	const [items, people] = await Promise.all([listInbox(k, userId), familyPeople(k)]);
	return {
		items,
		/** Who a message may be left for: the others with an account. */
		people: people
			.filter((p) => p.userId && p.userId !== userId)
			.map((p) => ({ id: p.userId!, name: p.name })),
		maxMessage: MAX_MESSAGE
	};
};

const idOf = (form: FormData) => {
	const id = Number(form.get('id'));
	return Number.isInteger(id) ? id : null;
};

export const actions: Actions = {
	/** «Vale»: read. */
	read: async ({ request, locals }) => {
		const id = idOf(await request.formData());
		if (id !== null) await markRead(await kitchenOf(locals.user!.id), locals.user!.id, id);
	},
	/** «Marcar todo como leído». */
	readAll: async ({ locals }) => {
		await markRead(await kitchenOf(locals.user!.id), locals.user!.id);
	},
	remove: async ({ request, locals }) => {
		const id = idOf(await request.formData());
		if (id !== null) await removeFromInbox(await kitchenOf(locals.user!.id), locals.user!.id, id);
	},
	/** Something to remember offered (#331, phase 5): «Guardar», in their own memory, or «No». */
	proposal: async ({ request, locals }) => {
		const form = await request.formData();
		const id = idOf(form);
		if (id === null) return;
		const kept = form.get('keep') === 'true';
		const k = await kitchenOf(locals.user!.id);
		const offered = await answerProposal(k, locals.user!.id, id, kept);
		if (offered && kept)
			await remember(
				k,
				locals.user!.id,
				offered.text,
				{ untilDay: offered.untilDay },
				{ ruleId: null, because: offered.because, chain: [] }
			);
	},
	/** «Dejar un recado», to one or more of the family. */
	leave: async ({ request, locals }) => {
		const form = await request.formData();
		const text = String(form.get('text') ?? '');
		const wanted = form.getAll('to').map(String);
		const k = await kitchenOf(locals.user!.id);
		const people = (await familyPeople(k)).filter(
			(p) => p.userId && p.userId !== locals.user!.id && wanted.includes(p.userId)
		);
		if (!people.length) return fail(400, { problem: 'Elige a quién' });
		if (!text.trim()) return fail(400, { problem: 'Escribe el recado' });
		await leaveMessage(
			k,
			{ userId: locals.user!.id, name: locals.user!.name },
			people.map((p) => p.userId!),
			text
		);
		return { left: people.map((p) => p.name).join(', ') };
	}
};
