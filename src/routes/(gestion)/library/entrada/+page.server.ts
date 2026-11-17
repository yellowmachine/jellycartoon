import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	cancelInboxCurrent,
	inboxStatus,
	retryInbox,
	setInboxPaused
} from '#lib/server/cinema/inbox.ts';

/** Gestión → Entrada: the rips left in Cine's entrada/, encoded and moved to Cine. */
export const load: PageServerLoad = async () => ({ inbox: inboxStatus() });

export const actions: Actions = {
	pause: async () => setInboxPaused(true),
	resume: async () => setInboxPaused(false),
	cancel: async () => cancelInboxCurrent(),
	retry: async ({ request }) => {
		const name = (await request.formData()).get('name');
		if (typeof name !== 'string' || !name) return fail(400, { message: 'Fichero no válido' });
		await retryInbox(name);
	}
};
