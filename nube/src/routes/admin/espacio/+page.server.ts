import { error, fail } from '@sveltejs/kit';
import { STORAGE_QUOTA_MB } from '$app/env/private';
import type { Actions, PageServerLoad } from './$types';
import { fileQuota } from '#lib/server/file-quota.ts';
import { isServiceAdmin } from '#lib/server/invitations.ts';

/** Only the service's administrator (ADMIN_EMAIL): to anyone else, there is no such page. */
function onlyServiceAdmin(user: App.Locals['user']) {
	if (!isServiceAdmin(user?.email)) error(404, 'Not found');
}

/** Each family's storage (#480), the fullest first, and its own quota if it has one. */
export const load: PageServerLoad = async ({ locals }) => {
	onlyServiceAdmin(locals.user);
	return { families: await fileQuota.families(), defaultMb: STORAGE_QUOTA_MB };
};

export const actions: Actions = {
	/** A family's own quota, in GB; empty, back to the default (STORAGE_QUOTA_MB). */
	limit: async ({ request, locals }) => {
		onlyServiceAdmin(locals.user);
		const form = await request.formData();
		const familyId = String(form.get('family') ?? '');
		const text = String(form.get('gb') ?? '')
			.trim()
			.replace(',', '.');
		const gb = Number(text);
		if (!familyId) return fail(400, { problem: 'Falta la familia' });
		if (text && !(gb > 0 && gb <= 10_000))
			return fail(400, { problem: 'Escribe los GB, por ejemplo 2 o 0,5' });
		await fileQuota.setLimit(familyId, text ? Math.round(gb * 1024 * 1024 * 1024) : null);
		return { saved: familyId };
	}
};
