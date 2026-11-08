import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { listShares, revokeShare } from '#lib/server/walks/share.ts';

/** «Mis paseos compartidos» (#434): every link one has made, live or taken back. */
export const load: PageServerLoad = async ({ locals }) => ({
	shares: await listShares(await kitchenOf(locals.user!.id))
});

export const actions: Actions = {
	revoke: async ({ request, locals }) => {
		const id = Number((await request.formData()).get('id'));
		if (!Number.isInteger(id)) return fail(400, { message: 'Enlace no válido' });
		await revokeShare(await kitchenOf(locals.user!.id), id);
	}
};
