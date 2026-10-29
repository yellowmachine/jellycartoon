import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { inviteAndSend, isServiceAdmin } from '#lib/server/invitations.ts';
import { setWaitlistStatus, waitingList, waitlistEntry } from '#lib/server/waitlist.ts';

/** Only the service's administrator (ADMIN_EMAIL): to anyone else, there is no such page. */
function onlyServiceAdmin(user: App.Locals['user']) {
	if (!isServiceAdmin(user?.email)) error(404, 'Not found');
	return user!;
}

export const load: PageServerLoad = async ({ locals }) => {
	onlyServiceAdmin(locals.user);
	return { entries: await waitingList() };
};

export const actions: Actions = {
	/** Let in: an invitation to make their own family, by email; again, a new link. */
	approve: async ({ request, locals }) => {
		const me = onlyServiceAdmin(locals.user);
		const entry = await waitlistEntry(String((await request.formData()).get('id') ?? ''));
		if (!entry) return fail(404, { problem: 'No está en la lista' });
		const done = await inviteAndSend({
			email: entry.email,
			familyId: null,
			familyName: null,
			role: 'admin',
			inviter: me
		});
		if (!done.ok) return fail(400, { problem: `${entry.email}: ${done.problem}` });
		await setWaitlistStatus(entry.id, 'approved');
		return { approved: { email: entry.email, sent: done.sent, link: done.link } };
	},
	reject: async ({ request, locals }) => {
		onlyServiceAdmin(locals.user);
		await setWaitlistStatus(String((await request.formData()).get('id') ?? ''), 'rejected');
		return { rejected: true };
	}
};
